import fs from "node:fs/promises";
import { Job, UnrecoverableError } from "bullmq";
import ConexaoPostgres from "../db/conexaoPostgres";
import { config } from "../services/config";
import { caminhoPublicar } from "../services/caminhos";
import { chamarVpsMultipart } from "../services/vpsHttp";
import { criarWorker } from "../services/fila";

export const NOME_FILA = "publicar-foto";
export const CONCORRENCIA_PADRAO = 4;

export interface DadosPublicarFotoJob {
    id_evento: number;
    hash_arquivo: string;
}

interface LinhaFotoLocal {
    id_foto: number;
    id_evento_fotografo: number | null;
    largura: number;
    altura: number;
    bytes_web: number;
    capturada_em: string | null;
    camera: string | null;
}

interface LinhaRostoLocal {
    embedding: string;
    bbox: unknown;
    det_score: number;
    area_px: number;
}

function parseVetor(bruto: string): number[] {
    return bruto.slice(1, -1).split(",").map(Number);
}

export async function publicarFoto(dados: DadosPublicarFotoJob): Promise<void> {
    const conexao = new ConexaoPostgres();
    await conexao.open();
    try {
        const [foto] = await conexao.queryParam<LinhaFotoLocal>(
            "SELECT id_foto, id_evento_fotografo, largura, altura, bytes_web, capturada_em, camera FROM foto WHERE id_evento = ? AND hash_arquivo = ?",
            [dados.id_evento, dados.hash_arquivo]
        );
        if (!foto) throw new Error(`[PublicarFoto] foto não encontrada localmente: ${dados.id_evento}:${dados.hash_arquivo}`);

        const rostos = await conexao.queryParam<LinhaRostoLocal>("SELECT embedding, bbox, det_score, area_px FROM rosto WHERE id_foto = ?", [foto.id_foto]);

        const corpo = new FormData();
        corpo.append("call", "publicarFoto");
        corpo.append(
            "dados",
            JSON.stringify({
                id_evento: dados.id_evento,
                id_evento_fotografo: foto.id_evento_fotografo,
                hash_arquivo: dados.hash_arquivo,
                largura: foto.largura,
                altura: foto.altura,
                bytes_web: foto.bytes_web,
                capturada_em: foto.capturada_em,
                camera: foto.camera,
                rostos: rostos.map((r) => ({ embedding: parseVetor(r.embedding), bbox: r.bbox, det_score: r.det_score, area_px: r.area_px })),
            })
        );

        for (const tipo of ["web", "thumb", "previa"] as const) {
            const caminho = caminhoPublicar(config.raizPublicar, dados.id_evento, dados.hash_arquivo, tipo);
            try {
                corpo.append(tipo, new Blob([await fs.readFile(caminho)]), `${tipo}.jpg`);
            } catch (erro) {
                // Derivado que não existe não volta a existir tentando de novo por 3 dias:
                // a foto precisa ser reprocessada, então a falha é definitiva.
                if ((erro as { code?: string }).code === "ENOENT")
                    throw new UnrecoverableError(`[PublicarFoto] derivado ausente: ${caminho}`);
                throw erro;
            }
        }

        await chamarVpsMultipart("/api/estacao/foto", corpo);

        await conexao.executeParamCount("UPDATE foto SET etapa = 'publicada', publicada_em = now() WHERE id_foto = ?", [foto.id_foto]);
        await Promise.all(
            (["web", "thumb", "previa"] as const).map((tipo) =>
                fs.unlink(caminhoPublicar(config.raizPublicar, dados.id_evento, dados.hash_arquivo, tipo)).catch(() => {})
            )
        );
    } finally {
        await conexao.close();
    }
}

// Sem isto, uma foto que nunca consegue publicar fica invisível: `foto.erro` vazio e fora
// da taxa de erro das métricas, parada em `derivados` para sempre.
async function registrarFalhaPublicacao(dados: DadosPublicarFotoJob, erro: Error): Promise<void> {
    const conexao = new ConexaoPostgres();
    await conexao.open();
    try {
        await conexao.executeParamCount("UPDATE foto SET erro = ?, erro_etapa = 'publicacao' WHERE id_evento = ? AND hash_arquivo = ?", [
            erro.message,
            dados.id_evento,
            dados.hash_arquivo,
        ]);
    } finally {
        await conexao.close();
    }
}

export function iniciarWorkerPublicarFoto(concorrencia = CONCORRENCIA_PADRAO): void {
    const worker = criarWorker<DadosPublicarFotoJob>(NOME_FILA, (job: Job<DadosPublicarFotoJob>) => publicarFoto(job.data), concorrencia);
    worker.on("failed", (job, erro) => {
        if (!job) return;
        const esgotouTentativas = job.attemptsMade >= (job.opts.attempts ?? 1);
        if (erro instanceof UnrecoverableError || esgotouTentativas) {
            registrarFalhaPublicacao(job.data, erro).catch((erroAoGravar) =>
                console.error(`[PublicarFoto] falha ao gravar o erro de ${job.data.id_evento}:${job.data.hash_arquivo}:`, erroAoGravar)
            );
        }
    });
}
