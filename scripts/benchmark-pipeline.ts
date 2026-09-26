import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Client } from "pg";
import "../apps/api/src/loadEnv";
import { iniciarConfig } from "../apps/api/src/services/config";
import ConexaoPostgres, { fecharBanco } from "../apps/api/src/db/conexaoPostgres";
import { calcularHashArquivo } from "../apps/api/src/services/hashArquivo";
import { criarFila, fecharFila } from "../apps/api/src/services/fila";
import { DadosProcessarFoto, NOME_FILA } from "../apps/api/src/jobs/processarFoto";
import { percentil } from "../apps/api/src/services/metricas";

function argumento(nome: string, padrao?: string): string | undefined {
    const idx = process.argv.indexOf(`--${nome}`);
    return idx >= 0 ? process.argv[idx + 1] : padrao;
}

async function garantirEventoDosDoisLados(slug: string): Promise<number> {
    const conexaoEstacao = new ConexaoPostgres();
    await conexaoEstacao.open();
    const chaveAnfitriao = `benchmark-${Date.now()}`;
    // Id explícito: na estação todo evento vem da VPS com o id de lá.
    const [linha] = await conexaoEstacao.queryParam<{ id_evento: number }>(
        `INSERT INTO evento (id_evento, nome, slug, tipo, privado, chave_anfitriao, data_fim, config)
         VALUES ((SELECT COALESCE(MAX(id_evento), 0) + 1 FROM evento), 'Benchmark do pipeline', ?, 'esportivo', 'N', ?, '2099-12-31', '{}')
         ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug RETURNING id_evento`,
        [slug, chaveAnfitriao]
    );
    await conexaoEstacao.close();

    const clienteVps = new Client({
        host: process.env.VPS_POSTGRES_HOST ?? "127.0.0.1",
        port: Number(process.env.VPS_POSTGRES_PORT ?? 5433),
        user: process.env.VPS_POSTGRES_USER ?? "fotos",
        password: process.env.VPS_POSTGRES_PASSWORD ?? "fotos",
        database: process.env.VPS_POSTGRES_DB ?? "fotos_vps",
    });
    await clienteVps.connect();
    // Mesmo id_evento nos dois bancos, como a sincronização de verdade faria.
    await clienteVps.query(
        `INSERT INTO evento (id_evento, nome, slug, tipo, privado, chave_anfitriao, data_fim, config)
         VALUES ($1, 'Benchmark do pipeline', $2, 'esportivo', 'N', $3, '2099-12-31', '{}')
         ON CONFLICT (id_evento) DO NOTHING`,
        [linha.id_evento, slug, chaveAnfitriao]
    );
    await clienteVps.end();

    return linha.id_evento;
}

async function main(): Promise<void> {
    const pasta = argumento("pasta");
    if (!pasta) throw new Error("Uso: npm run benchmark-pipeline -- --pasta <dir> [--pasta-worker <dir>] [--evento <slug>] [--limite N]");
    // O hash é calculado aqui, mas quem abre o arquivo é o worker: quando ele roda em container,
    // a mesma pasta tem outro caminho lá dentro (ex.: /data/dados/fotos-benchmark).
    const pastaWorker = argumento("pasta-worker", pasta) as string;
    const slug = argumento("evento", `benchmark-pipeline-${Date.now()}`) as string;
    const limite = Number(argumento("limite", "50"));

    iniciarConfig(process.env);
    const idEvento = await garantirEventoDosDoisLados(slug);

    const entradas = (await fs.readdir(pasta, { withFileTypes: true }))
        .filter((e) => e.isFile() && [".jpg", ".jpeg"].includes(path.extname(e.name).toLowerCase()))
        .slice(0, limite);
    if (entradas.length === 0) throw new Error(`Nenhum JPEG em ${pasta}`);

    const fila = criarFila<DadosProcessarFoto>(NOME_FILA);
    const hashes: string[] = [];
    for (const entrada of entradas) {
        const origem = path.join(pasta, entrada.name);
        const hash = await calcularHashArquivo(origem);
        hashes.push(hash);
        await fila.add(
            NOME_FILA,
            { id_evento: idEvento, id_evento_fotografo: null, hash_arquivo: hash, nome_arquivo: entrada.name, origem: path.join(pastaWorker, entrada.name), copiar: true },
            // Separador `_`: o BullMQ recusa `:` em id customizado.
            { jobId: `${idEvento}_${hash}`, attempts: 5, backoff: { type: "exponential", delay: 1000 } }
        );
    }
    console.log(`${hashes.length} fotos de ${pasta} enfileiradas no evento "${slug}" (id_evento=${idEvento}).`);
    console.log("Aguardando publicação — precisa do worker rodando de verdade (docker compose ... worker-estacao).\n");

    const conexao = new ConexaoPostgres();
    await conexao.open();

    const inicio = performance.now();
    const prazoMs = 10 * 60 * 1000;
    while (performance.now() - inicio < prazoMs) {
        // Conta o que já foi publicado, não "o que sobrou": as fotos ainda não processadas
        // sequer têm linha em `foto`, e contar pendentes faria o benchmark encerrar na hora.
        const [linha] = await conexao.queryParam<{ publicadas: number }>(
            "SELECT count(*)::int AS publicadas FROM foto WHERE id_evento = ? AND hash_arquivo = ANY(?::text[]) AND etapa = 'publicada'",
            [idEvento, hashes]
        );
        if (linha.publicadas >= hashes.length) break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    const totalS = (performance.now() - inicio) / 1000;

    const linhas = await conexao.queryParam<{ criado_em: string; publicada_em: string | null; erro: string | null }>(
        "SELECT criado_em, publicada_em, erro FROM foto WHERE id_evento = ? AND hash_arquivo = ANY(?::text[])",
        [idEvento, hashes]
    );
    const publicadas = linhas.filter((l) => l.publicada_em);
    const comErro = linhas.filter((l) => l.erro);
    const latenciasMs = publicadas.map((l) => new Date(l.publicada_em as string).getTime() - new Date(l.criado_em).getTime());

    console.log(`${publicadas.length}/${hashes.length} publicadas em ${totalS.toFixed(1)}s (${comErro.length} com erro)`);
    console.log(`Vazão: ${(publicadas.length / totalS).toFixed(2)} fotos/s`);
    console.log(`Latência hash → publicada na VPS: p50 ${percentil(latenciasMs, 50).toFixed(0)}ms, p95 ${percentil(latenciasMs, 95).toFixed(0)}ms`);

    await conexao.close();
    await fecharFila();
    await fecharBanco();
}

main().catch((erro) => {
    console.error("[BenchmarkPipeline] Falhou:", erro instanceof Error ? erro.message : erro);
    process.exit(1);
});
