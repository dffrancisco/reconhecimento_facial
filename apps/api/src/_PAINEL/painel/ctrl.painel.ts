import fs from "node:fs/promises";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { config } from "../../services/config";
import { ErroTratado } from "../../services/erro";
import { criarFila } from "../../services/fila";
import { DadosProcessarFoto, NOME_FILA } from "../../jobs/processarFoto";
import { ultimaSincronizacao } from "../../services/sincronizacaoEstacao";
import { montarSinal } from "../../jobs/sinal";
import { caminhoParcial } from "../../_FOTOGRAFO/upload/ctrl.upload";
import {
    contarEmProcessamento,
    encerrar,
    errosDoEvento,
    eventoAberto,
    eventoEmAndamento,
    filaDoEvento,
    fotoComErro,
    fotografosDoEvento,
    fotosComErroDoEvento,
    LinhaErro,
    limparErro,
} from "./sql.painel";

interface Gpu {
    utilizacao: number;
    vram_usada_mb: number;
    vram_total_mb: number;
}

function lerGpu(bruto: unknown): Gpu | null {
    const g = bruto as Partial<Gpu> | null;
    if (!g || typeof g.utilizacao !== "number" || typeof g.vram_usada_mb !== "number" || typeof g.vram_total_mb !== "number") return null;
    return { utilizacao: g.utilizacao, vram_usada_mb: g.vram_usada_mb, vram_total_mb: g.vram_total_mb };
}

const existe = (caminho: string) =>
    fs.access(caminho).then(
        () => true,
        () => false
    );

// Reprocessar só faz sentido com o arquivo em disco: o original copiado, ou o arquivo recebido
// quando a falha foi antes de ele ser movido para os originais.
export async function arquivoDoErro(erro: Pick<LinhaErro, "caminho_original" | "id_upload">): Promise<string | null> {
    if (erro.caminho_original && (await existe(erro.caminho_original))) return erro.caminho_original;
    if (erro.id_upload && (await existe(caminhoParcial(erro.id_upload)))) return caminhoParcial(erro.id_upload);
    return null;
}

export default class PainelCtrl {
    constructor(private conexao: ConexaoPostgres) {}

    async getPainel() {
        const [evento, sinal, sincronizou] = await Promise.all([
            eventoEmAndamento(this.conexao),
            montarSinal(this.conexao),
            ultimaSincronizacao(),
        ]);

        const metricas = sinal as {
            fotos_min: Record<string, number>;
            latencia_ms: { p50: number; p95: number };
            taxa_erro: number;
            gpu: unknown;
        };
        const base = {
            metricas: {
                fotos_min: metricas.fotos_min["5"] ?? 0,
                latencia_p50_ms: metricas.latencia_ms.p50,
                latencia_p95_ms: metricas.latencia_ms.p95,
                taxa_erro: metricas.taxa_erro,
                gpu: lerGpu(metricas.gpu),
            },
            vps: { ultima_sincronizacao: sincronizou },
            enderecos: { lan: config.enderecoLan, tunel: config.enderecoTunel },
        };

        if (!evento)
            return {
                ...base,
                evento: null,
                fila: { recebidas: 0, rostos: 0, derivados: 0, esperando_publicar: 0 },
                fotografos: [],
                erros: [],
                em_processamento: 0,
            };

        const [fila, fotografos, erros] = await Promise.all([
            filaDoEvento(this.conexao, evento.id_evento),
            fotografosDoEvento(this.conexao, evento.id_evento),
            errosDoEvento(this.conexao, evento.id_evento),
        ]);

        return {
            ...base,
            evento: { id_evento: evento.id_evento, nome: evento.nome, desde: evento.criado_em },
            fila,
            fotografos,
            erros: await Promise.all(
                erros.map(async (e) => ({
                    id_foto: e.id_foto,
                    nome_arquivo: e.nome_arquivo,
                    fotografo: e.fotografo,
                    etapa: e.etapa,
                    erro: e.erro,
                    tem_arquivo: (await arquivoDoErro(e)) !== null,
                }))
            ),
            em_processamento: fila.recebidas + fila.rostos + fila.derivados + fila.esperando_publicar,
        };
    }

    async reprocessar(idFoto: number | null): Promise<{ reenfileiradas: number; sem_arquivo: number }> {
        let fotos;
        if (idFoto !== null) fotos = await fotoComErro(this.conexao, idFoto);
        else {
            const evento = await eventoEmAndamento(this.conexao);
            fotos = evento ? await fotosComErroDoEvento(this.conexao, evento.id_evento) : [];
        }

        const fila = criarFila<DadosProcessarFoto>(NOME_FILA);
        let reenfileiradas = 0;
        let semArquivo = 0;
        for (const foto of fotos) {
            const arquivo = await arquivoDoErro(foto);
            if (!arquivo) {
                semArquivo++;
                continue;
            }

            // O job que falhou continua na fila com o mesmo id; sem removê-lo, o `add` abaixo
            // devolveria o job velho e nada seria reprocessado.
            const jobId = `${foto.id_evento}_${foto.hash_arquivo}`;
            await (await fila.getJob(jobId))?.remove();
            await limparErro(this.conexao, foto.id_foto);
            await fila.add(
                NOME_FILA,
                {
                    id_evento: foto.id_evento,
                    id_evento_fotografo: foto.id_evento_fotografo,
                    hash_arquivo: foto.hash_arquivo,
                    nome_arquivo: foto.nome_arquivo,
                    origem: arquivo,
                    // O original fica onde está; só o arquivo recebido (falha antes da etapa
                    // original) é movido, como no envio normal.
                    copiar: arquivo === foto.caminho_original,
                },
                { jobId, attempts: 5, backoff: { type: "exponential", delay: 1000 } }
            );
            reenfileiradas++;
        }
        return { reenfileiradas, sem_arquivo: semArquivo };
    }

    async encerrarEvento(idEvento: number): Promise<{ encerrado: true }> {
        await this.conexao.openTransaction();
        if (!(await eventoAberto(this.conexao, idEvento))) throw new ErroTratado("Este evento já foi encerrado.");
        if ((await contarEmProcessamento(this.conexao, idEvento)) > 0)
            throw new ErroTratado("Ainda há fotos em processamento. Espere a fila esvaziar para encerrar.", "em_processamento");
        await encerrar(this.conexao, idEvento);
        return { encerrado: true };
    }
}
