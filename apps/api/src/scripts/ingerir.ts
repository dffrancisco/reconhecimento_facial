import fs from "node:fs/promises";
import path from "node:path";
import "../loadEnv";
import { iniciarConfig } from "../services/config";
import ConexaoPostgres from "../db/conexaoPostgres";
import { calcularHashArquivo } from "../services/hashArquivo";
import { criarFila } from "../services/fila";
import { DadosProcessarFoto, NOME_FILA } from "../jobs/processarFoto";

const EXTENSOES = new Set([".jpg", ".jpeg"]);

export async function ingerir(
    conexao: ConexaoPostgres,
    opcoes: { slug: string; pasta: string; idEventoFotografo: number | null }
): Promise<{ enfileiradas: number; ignoradas: number }> {
    const evento = await conexao.queryOneParam<{ id_evento: number }>("SELECT id_evento FROM evento WHERE slug = ?", [opcoes.slug]);
    if (!evento) throw new Error(`[Ingerir] evento não encontrado localmente: ${opcoes.slug} (rode a sincronização primeiro)`);

    const entradas = await fs.readdir(opcoes.pasta, { withFileTypes: true });
    const arquivos = entradas.filter((e) => e.isFile() && EXTENSOES.has(path.extname(e.name).toLowerCase()));

    const fila = criarFila<DadosProcessarFoto>(NOME_FILA);
    let enfileiradas = 0;
    let ignoradas = 0;

    for (const arquivo of arquivos) {
        const origem = path.join(opcoes.pasta, arquivo.name);
        const hash = await calcularHashArquivo(origem);
        // Separador `_`: o BullMQ recusa `:` em id customizado.
        const jobId = `${evento.id_evento}_${hash}`;

        // `fila.add` com um jobId existente devolve o job já existente em vez de lançar erro —
        // checar antes é a única forma de saber se era mesmo novo, para o resumo ficar correto.
        if (await fila.getJob(jobId)) {
            ignoradas++;
            continue;
        }

        const dados: DadosProcessarFoto = {
            id_evento: evento.id_evento,
            id_evento_fotografo: opcoes.idEventoFotografo,
            hash_arquivo: hash,
            nome_arquivo: arquivo.name,
            origem,
            copiar: true,
        };
        await fila.add(NOME_FILA, dados, { jobId, attempts: 5, backoff: { type: "exponential", delay: 1000 } });
        enfileiradas++;
    }

    return { enfileiradas, ignoradas };
}

function argumento(nome: string): string | undefined {
    const idx = process.argv.indexOf(`--${nome}`);
    return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main(): Promise<void> {
    const slug = argumento("evento");
    const pasta = argumento("pasta");
    if (!slug || !pasta) {
        console.error("[Ingerir] Uso: npm run ingerir -w apps/api -- --evento <slug> --pasta <dir> [--fotografo <id_evento_fotografo>]");
        process.exit(1);
    }

    iniciarConfig(process.env);
    const conexao = new ConexaoPostgres();
    await conexao.open();
    try {
        const fotografoArg = argumento("fotografo");
        const resultado = await ingerir(conexao, { slug, pasta, idEventoFotografo: fotografoArg ? Number(fotografoArg) : null });
        console.log(`[Ingerir] ${resultado.enfileiradas} fotos enfileiradas para "${slug}" (${resultado.ignoradas} já estavam na fila).`);
    } finally {
        await conexao.close();
    }
}

if (require.main === module) {
    main().catch((erro) => {
        console.error("[Ingerir] Falhou:", erro instanceof Error ? erro.message : erro);
        process.exit(1);
    });
}
