import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { Job, UnrecoverableError } from "bullmq";
import ConexaoPostgres from "../db/conexaoPostgres";
import { config } from "../services/config";
import { caminhoMarcaDagua, caminhoOriginal, caminhoPublicar } from "../services/caminhos";
import { combinarDataExif, lerExif } from "../services/exifFoto";
import { detectarRostos } from "../services/vision";
import { criarFila, criarWorker } from "../services/fila";

const FUSO_PADRAO = "America/Sao_Paulo";
export const NOME_FILA = "processar-foto";
const NOME_FILA_PUBLICAR = "publicar-foto";

export interface DadosProcessarFoto {
    id_evento: number;
    id_evento_fotografo: number | null;
    hash_arquivo: string;
    nome_arquivo: string;
    origem: string;
    copiar: boolean;
}

interface LinhaFotoEstacao {
    id_foto: number;
    etapa: string;
    caminho_original: string | null;
}

async function garantirRegistro(conexao: ConexaoPostgres, dados: DadosProcessarFoto): Promise<LinhaFotoEstacao> {
    await conexao.executeParamCount(
        `INSERT INTO foto (id_evento, id_evento_fotografo, hash_arquivo, nome_arquivo, etapa)
         VALUES (?, ?, ?, ?, 'registrada') ON CONFLICT (id_evento, hash_arquivo) DO NOTHING`,
        [dados.id_evento, dados.id_evento_fotografo, dados.hash_arquivo, dados.nome_arquivo]
    );
    const [linha] = await conexao.queryParam<LinhaFotoEstacao>(
        "SELECT id_foto, etapa, caminho_original FROM foto WHERE id_evento = ? AND hash_arquivo = ?",
        [dados.id_evento, dados.hash_arquivo]
    );
    return linha;
}

async function tamanhoImagem(caminho: string): Promise<{ largura: number; altura: number; bytes: number }> {
    const [meta, stat] = await Promise.all([sharp(caminho).metadata(), fs.stat(caminho)]);
    return { largura: meta.width ?? 0, altura: meta.height ?? 0, bytes: stat.size };
}

async function etapaOriginal(conexao: ConexaoPostgres, idFoto: number, dados: DadosProcessarFoto): Promise<string> {
    const [evento] = await conexao.queryParam<{ slug: string }>("SELECT slug FROM evento WHERE id_evento = ?", [dados.id_evento]);
    const exif = await lerExif(dados.origem).catch(() => ({}) as Awaited<ReturnType<typeof lerExif>>);
    const capturadaEm = combinarDataExif(exif.dataOriginal, exif.offsetOriginal, FUSO_PADRAO) ?? new Date();
    const dataFoto = capturadaEm.toISOString().slice(0, 10);
    const destino = caminhoOriginal(config.raizOriginais, evento.slug, dataFoto, dados.hash_arquivo);

    await fs.mkdir(path.dirname(destino), { recursive: true });
    try {
        if (dados.copiar) await fs.copyFile(dados.origem, destino);
        else await fs.rename(dados.origem, destino);
    } catch (erro) {
        throw new UnrecoverableError(`[ProcessarFoto] não foi possível ler o arquivo de origem: ${(erro as Error).message}`);
    }

    const { largura, altura, bytes } = await tamanhoImagem(destino);
    const camera = exif.make || exif.model ? [exif.make, exif.model].filter(Boolean).join(" ") : null;
    await conexao.executeParamCount(
        `UPDATE foto SET caminho_original = ?, largura = ?, altura = ?, bytes_original = ?, camera = ?, capturada_em = ?, etapa = 'original'
         WHERE id_foto = ?`,
        [destino, largura, altura, bytes, camera, capturadaEm.toISOString(), idFoto]
    );
    return destino;
}

async function etapaRostos(idFoto: number, idEvento: number, caminhoArquivo: string): Promise<void> {
    const [resultado] = await detectarRostos([caminhoArquivo]);
    if (resultado.erro) throw new UnrecoverableError(`[ProcessarFoto] vision recusou a imagem: ${resultado.erro}`);

    const transacao = new ConexaoPostgres();
    await transacao.openTransaction();
    try {
        await transacao.executeParamCount("DELETE FROM rosto WHERE id_foto = ?", [idFoto]);
        for (const rosto of resultado.rostos)
            await transacao.executeParamCount(
                "INSERT INTO rosto (id_foto, id_evento, embedding, bbox, det_score, area_px) VALUES (?, ?, ?::vector, ?, ?, ?)",
                [idFoto, idEvento, `[${rosto.embedding.join(",")}]`, JSON.stringify(rosto.bbox), rosto.det_score, rosto.area_px]
            );
        await transacao.executeParamCount("UPDATE foto SET qtd_rostos = ?, etapa = 'rostos' WHERE id_foto = ?", [resultado.rostos.length, idFoto]);
    } catch (erro) {
        transacao.marcarErro();
        throw erro;
    } finally {
        await transacao.close();
    }
}

async function etapaDerivados(conexao: ConexaoPostgres, idFoto: number, idEvento: number, hash: string, caminhoArquivo: string): Promise<void> {
    const [evento] = await conexao.queryParam<{ config: { marca_dagua?: boolean } }>("SELECT config FROM evento WHERE id_evento = ?", [idEvento]);
    const caminhoMarca = evento?.config?.marca_dagua ? caminhoMarcaDagua(config.raizMarcas, idEvento) : null;
    const temMarca = caminhoMarca
        ? await fs
              .access(caminhoMarca)
              .then(() => true)
              .catch(() => false)
        : false;

    const pasta = path.dirname(caminhoPublicar(config.raizPublicar, idEvento, hash, "web"));
    await fs.mkdir(pasta, { recursive: true });

    async function gerar(largura: number, qualidade: number, tipo: "web" | "thumb" | "previa", blur?: number): Promise<number> {
        let pipeline = sharp(caminhoArquivo).rotate().resize({ width: largura, fit: "inside", withoutEnlargement: true });
        if (blur) pipeline = pipeline.blur(blur);
        if (temMarca && caminhoMarca && tipo !== "previa") pipeline = pipeline.composite([{ input: caminhoMarca, gravity: "southeast" }]);
        const buffer = await pipeline.jpeg({ quality: qualidade, progressive: true, mozjpeg: true }).toBuffer();
        await fs.writeFile(caminhoPublicar(config.raizPublicar, idEvento, hash, tipo), buffer);
        return buffer.length;
    }

    const bytesWeb = await gerar(2048, 82, "web");
    await gerar(400, 70, "thumb");
    await gerar(32, 50, "previa", 20);

    await conexao.executeParamCount("UPDATE foto SET bytes_web = ?, etapa = 'derivados', processada_em = now() WHERE id_foto = ?", [bytesWeb, idFoto]);
}

async function enfileirarPublicacao(idEvento: number, hash: string): Promise<void> {
    const fila = criarFila(NOME_FILA_PUBLICAR);
    // O jobId deduplica a publicação da mesma foto. Separador `_` porque o BullMQ recusa `:`
    // em id customizado (ele usa `:` nas próprias chaves do Redis).
    await fila.add(NOME_FILA_PUBLICAR, { id_evento: idEvento, hash_arquivo: hash }, { jobId: `${idEvento}_${hash}`, attempts: 1000, backoff: { type: "custom" } });
}

export async function processarFoto(dados: DadosProcessarFoto): Promise<void> {
    const conexao = new ConexaoPostgres();
    await conexao.open();
    try {
        const registro = await garantirRegistro(conexao, dados);

        let caminhoAtual = registro.caminho_original;
        let etapa = registro.etapa;

        if (etapa === "registrada") {
            caminhoAtual = await etapaOriginal(conexao, registro.id_foto, dados);
            etapa = "original";
        }
        if (!caminhoAtual) throw new Error("[ProcessarFoto] etapa original sem caminho_original gravado");

        if (etapa === "original") {
            await etapaRostos(registro.id_foto, dados.id_evento, caminhoAtual);
            etapa = "rostos";
        }
        if (etapa === "rostos") {
            await etapaDerivados(conexao, registro.id_foto, dados.id_evento, dados.hash_arquivo, caminhoAtual);
        }

        await enfileirarPublicacao(dados.id_evento, dados.hash_arquivo);
    } finally {
        await conexao.close();
    }
}

// Falha definitiva (UnrecoverableError) grava na hora; falha passageira só grava quando a
// última tentativa também falhou — as anteriores apenas alimentam o backoff da fila.
async function registrarFalha(dados: DadosProcessarFoto, erro: Error): Promise<void> {
    const conexao = new ConexaoPostgres();
    await conexao.open();
    try {
        const [atual] = await conexao.queryParam<{ etapa: string }>("SELECT etapa FROM foto WHERE id_evento = ? AND hash_arquivo = ?", [
            dados.id_evento,
            dados.hash_arquivo,
        ]);
        await conexao.executeParamCount("UPDATE foto SET erro = ?, erro_etapa = ? WHERE id_evento = ? AND hash_arquivo = ?", [
            erro.message,
            atual?.etapa ?? null,
            dados.id_evento,
            dados.hash_arquivo,
        ]);
    } finally {
        await conexao.close();
    }
}

export function iniciarWorkerProcessarFoto(concorrencia: number): void {
    const worker = criarWorker<DadosProcessarFoto>(NOME_FILA, (job: Job<DadosProcessarFoto>) => processarFoto(job.data), concorrencia);
    worker.on("failed", (job, erro) => {
        if (!job) return;
        const esgotouTentativas = job.attemptsMade >= (job.opts.attempts ?? 1);
        if (erro instanceof UnrecoverableError || esgotouTentativas) {
            registrarFalha(job.data, erro).catch((erroAoGravar) =>
                console.error(`[ProcessarFoto] falha ao gravar o erro de ${job.data.id_evento}:${job.data.hash_arquivo}:`, erroAoGravar)
            );
        }
    });
}
