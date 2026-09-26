import fs from "node:fs/promises";
import path from "node:path";
import { Request, RequestHandler } from "express";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { config } from "../../services/config";
import { ErroTratado } from "../../services/erro";
import { criarFila } from "../../services/fila";
import { calcularHashArquivo } from "../../services/hashArquivo";
import { DadosProcessarFoto, NOME_FILA } from "../../jobs/processarFoto";
import { caminhoParcial, exigirVinculo, tamanhoEmDisco } from "./ctrl.upload";
import { decidirPedaco, ehJpeg } from "./regras";
import { atualizarRecebidos, marcarStatusUpload, uploadPorId } from "./sql.upload";

export interface Escrita {
    escrever(dados: Buffer): Promise<void>;
    fechar(): Promise<void>;
}

interface Dependencias {
    limitePedaco?: number;
    // Injetável para o teste simular o disco cheio sem encher um disco.
    abrirEscrita?: (caminho: string) => Promise<Escrita>;
}

async function abrirEmAnexo(caminho: string): Promise<Escrita> {
    const arquivo = await fs.open(caminho, "a");
    return {
        escrever: async (dados) => {
            await arquivo.write(dados);
        },
        fechar: () => arquivo.close(),
    };
}

// Resposta que não é erro inesperado: sai com o status e o corpo dados.
class Resposta extends Error {
    constructor(
        public status: number,
        public corpo: object
    ) {
        super("resposta");
    }
}

const MAIOR_QUE_DECLARADO = "A foto ficou maior que o tamanho informado.";

// Lê o corpo sem destruir a requisição: destruí-la derrubaria o socket antes de a resposta
// sair, e o navegador veria "sem conexão" em vez do motivo. Depois de uma recusa, o resto
// é só descartado — o Content-Length já foi conferido, então o descarte tem tamanho limitado.
async function gravarCorpo(
    req: Request,
    escrita: Escrita,
    o: { limite: number; restante: number; conferirJpeg: boolean }
): Promise<{ escritos: number; recusa: Resposta | ErroTratado | null }> {
    let lidos = 0;
    let escritos = 0;
    let recusa: Resposta | ErroTratado | null = null;
    let inicio = Buffer.alloc(0);
    let jpegConferido = !o.conferirJpeg;

    for await (const pedaco of req as AsyncIterable<Buffer>) {
        lidos += pedaco.length;
        if (recusa) {
            if (lidos > o.limite * 2) req.destroy();
            continue;
        }
        if (lidos > o.limite) {
            recusa = new Resposta(413, { msg: "Pedaço maior que o permitido." });
            continue;
        }
        if (lidos > o.restante) {
            recusa = new ErroTratado(MAIOR_QUE_DECLARADO);
            continue;
        }

        let dados = pedaco;
        if (!jpegConferido) {
            inicio = Buffer.concat([inicio, pedaco]);
            if (inicio.length < 3) continue;
            if (!ehJpeg(inicio)) {
                recusa = new ErroTratado("Não é JPEG — exporte em JPEG para enviar.", "nao_e_jpeg");
                continue;
            }
            jpegConferido = true;
            dados = inicio;
        }
        await escrita.escrever(dados);
        escritos += dados.length;
    }
    return { escritos, recusa };
}

export function criarRotaPedaco(deps: Dependencias = {}): RequestHandler {
    // Um pedaço por vez por envio: dois ao mesmo tempo (duas abas) embaralhariam o arquivo.
    const emCurso = new Set<number>();
    const abrirEscrita = deps.abrirEscrita ?? abrirEmAnexo;

    return async (req, res) => {
        const idUpload = Number(req.params.id_upload);
        const offset = Number(req.header("upload-offset"));
        if (!Number.isInteger(idUpload) || idUpload <= 0 || !Number.isInteger(offset) || offset < 0) {
            req.resume();
            res.status(400).send({ msg: "Pedido de envio inválido." });
            return;
        }

        const limite = deps.limitePedaco ?? config.uploadPedacoBytes;
        const caminho = caminhoParcial(idUpload);
        const conexao = new ConexaoPostgres();
        let travado = false;
        try {
            await conexao.open();
            const vinculo = await exigirVinculo(conexao, req.header("x-token-upload"));
            const upload = await uploadPorId(conexao, idUpload);
            if (!upload || upload.id_evento_fotografo !== vinculo.id_evento_fotografo)
                throw new ErroTratado("Este link não aceita mais fotos. Fale com o operador da estação.", "link_invalido");
            if (upload.status !== "recebendo")
                throw new ErroTratado("Este envio foi encerrado. A foto vai recomeçar.", "upload_encerrado");
            if (emCurso.has(idUpload)) throw new Resposta(409, { bytes_recebidos: await tamanhoEmDisco(idUpload) });
            emCurso.add(idUpload);
            travado = true;

            const tamanhoAtual = await tamanhoEmDisco(idUpload);
            const declarado = Number(req.header("content-length"));
            const decisao = decidirPedaco({
                offset,
                tamanhoAtual,
                tamanhoDeclarado: Number(upload.tamanho),
                bytesPedaco: Number.isFinite(declarado) ? declarado : 0,
                limitePedaco: limite,
            });
            if (decisao === "fora_de_ordem") throw new Resposta(409, { bytes_recebidos: tamanhoAtual });
            if (decisao === "grande_demais") throw new Resposta(413, { msg: "Pedaço maior que o permitido." });
            if (decisao === "passa_do_tamanho") throw new ErroTratado(MAIOR_QUE_DECLARADO);

            await fs.mkdir(path.dirname(caminho), { recursive: true });
            const escrita = await abrirEscrita(caminho);
            let resultado: Awaited<ReturnType<typeof gravarCorpo>>;
            try {
                resultado = await gravarCorpo(req, escrita, {
                    limite,
                    restante: Number(upload.tamanho) - tamanhoAtual,
                    conferirJpeg: tamanhoAtual === 0,
                });
            } finally {
                await escrita.fechar();
            }

            if (resultado.recusa) {
                // Nada da recusa fica no disco: o arquivo volta ao tamanho de antes do pedaço.
                if (tamanhoAtual === 0) await fs.rm(caminho, { force: true });
                else await fs.truncate(caminho, tamanhoAtual);
                throw resultado.recusa;
            }

            const recebidos = tamanhoAtual + resultado.escritos;
            await atualizarRecebidos(conexao, idUpload, recebidos);
            if (recebidos < Number(upload.tamanho)) {
                res.send({ bytes_recebidos: recebidos, completo: false });
                return;
            }

            const hash = await calcularHashArquivo(caminho);
            if (hash !== upload.hash_arquivo) {
                await fs.rm(caminho, { force: true });
                await marcarStatusUpload(conexao, idUpload, "cancelado");
                throw new ErroTratado("A foto chegou diferente do original.", "hash_diferente");
            }

            // Enfileira antes de marcar completo: se a marcação falhar, o reenvio cai aqui de
            // novo e acha o job; o contrário deixaria um upload "completo" sem processamento.
            const fila = criarFila<DadosProcessarFoto>(NOME_FILA);
            const jobId = `${vinculo.id_evento}_${hash}`;
            const existente = await fila.getJob(jobId);
            if (!existente) {
                await fila.add(
                    NOME_FILA,
                    {
                        id_evento: vinculo.id_evento,
                        id_evento_fotografo: vinculo.id_evento_fotografo,
                        hash_arquivo: hash,
                        nome_arquivo: upload.nome_arquivo,
                        origem: caminho,
                        copiar: false,
                    },
                    { jobId, attempts: 5, backoff: { type: "exponential", delay: 1000 } }
                );
            } else if (existente.data.origem !== caminho) {
                // Outro fotógrafo (ou outra aba) entregou a mesma foto antes: esta cópia sobra.
                await fs.rm(caminho, { force: true });
            }
            await marcarStatusUpload(conexao, idUpload, "completo");
            res.send({ bytes_recebidos: recebidos, completo: true });
        } catch (erro) {
            if (!req.complete) req.resume();
            if (erro instanceof Resposta) {
                res.status(erro.status).send(erro.corpo);
            } else if (erro instanceof ErroTratado) {
                res.status(422).send(erro.codigo ? { msg: erro.message, codigo: erro.codigo } : { msg: erro.message });
            } else if ((erro as { code?: unknown }).code === "ENOSPC") {
                res.status(507).send({ msg: "A estação está sem espaço em disco. Avise o operador.", codigo: "sem_espaco" });
            } else {
                console.error("[Upload] Erro ao receber pedaço:", erro instanceof Error ? { name: erro.name, message: erro.message } : String(erro));
                res.status(500).send({ msg: "Erro ao processar sua solicitação" });
            }
        } finally {
            if (travado) emCurso.delete(idUpload);
            await conexao.close();
        }
    };
}
