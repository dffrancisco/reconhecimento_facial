import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Job } from "bullmq";
import archiver from "archiver";
import ConexaoPostgres from "../db/conexaoPostgres";
import { config } from "../services/config";
import { criarWorker } from "../services/fila";

export const NOME_FILA = "zip";
export const FOTOS_POR_PARTE = 500;

export interface DadosZip {
    id_arquivo_zip: number;
}

interface LinhaZip {
    id_arquivo_zip: number;
    id_evento: number;
    id_busca: number | null;
    parte: number;
}

export async function processarZip(dados: DadosZip): Promise<void> {
    const conexao = new ConexaoPostgres();
    await conexao.open();
    try {
        const zip = await conexao.queryOneParam<LinhaZip>(
            "SELECT id_arquivo_zip, id_evento, id_busca, parte FROM arquivo_zip WHERE id_arquivo_zip = ?",
            [dados.id_arquivo_zip]
        );
        if (!zip) throw new Error(`[Zip] arquivo_zip ${dados.id_arquivo_zip} não existe`);

        // ZIP do participante sai da busca dele; o do anfitrião (id_busca nulo), do evento inteiro.
        const fotos = zip.id_busca
            ? await conexao.queryParam<{ hash_arquivo: string }>(
                  `SELECT f.hash_arquivo
                     FROM busca_foto bf JOIN foto f ON f.id_foto = bf.id_foto
                    WHERE bf.id_busca = ? AND f.situacao = 'visivel'
                    ORDER BY f.id_foto
                    LIMIT ? OFFSET ?`,
                  [zip.id_busca, FOTOS_POR_PARTE, (zip.parte - 1) * FOTOS_POR_PARTE]
              )
            : await conexao.queryParam<{ hash_arquivo: string }>(
                  `SELECT hash_arquivo FROM foto
                    WHERE id_evento = ? AND situacao = 'visivel'
                    ORDER BY id_foto
                    LIMIT ? OFFSET ?`,
                  [zip.id_evento, FOTOS_POR_PARTE, (zip.parte - 1) * FOTOS_POR_PARTE]
              );

        const pasta = path.join(config.raizZips, String(zip.id_evento));
        await fsp.mkdir(pasta, { recursive: true });
        const destino = path.join(pasta, `${zip.id_arquivo_zip}.zip`);

        const incluidas = await montarZip(destino, zip.id_evento, fotos.map((f) => f.hash_arquivo));
        const info = await fsp.stat(destino);

        await conexao.executeParamCount("UPDATE arquivo_zip SET status = 'pronto', qtd_fotos = ?, bytes = ? WHERE id_arquivo_zip = ?", [
            incluidas,
            info.size,
            zip.id_arquivo_zip,
        ]);
    } catch (erro) {
        await conexao
            .executeParamCount("UPDATE arquivo_zip SET status = 'erro' WHERE id_arquivo_zip = ?", [dados.id_arquivo_zip])
            .catch(() => {});
        throw erro;
    } finally {
        await conexao.close();
    }
}

// Modo store (level 0): JPEG já está comprimido, recomprimir só gastaria CPU.
async function montarZip(destino: string, idEvento: number, hashes: string[]): Promise<number> {
    const saida = fs.createWriteStream(destino);
    const arquivo = archiver("zip", { zlib: { level: 0 } });
    let incluidas = 0;

    const terminou = new Promise<void>((resolve, reject) => {
        saida.on("close", () => resolve());
        arquivo.on("error", reject);
        saida.on("error", reject);
    });

    arquivo.pipe(saida);
    for (const hash of hashes) {
        const caminho = path.join(config.raizFotos, String(idEvento), `${hash}_web.jpg`);
        try {
            await fsp.access(caminho);
        } catch {
            // Foto excluída entre o pedido e a montagem: o ZIP leva o resto.
            console.error(`[Zip] arquivo ausente, pulando: ${hash}`);
            continue;
        }
        arquivo.file(caminho, { name: `${hash}_web.jpg` });
        incluidas++;
    }
    await arquivo.finalize();
    await terminou;
    return incluidas;
}

export function iniciarWorkerZip(concorrencia = 2): void {
    criarWorker<DadosZip>(NOME_FILA, (job: Job<DadosZip>) => processarZip(job.data), concorrencia);
}
