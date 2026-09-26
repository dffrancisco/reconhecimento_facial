import { test, before, after } from "node:test";
import assert from "node:assert";
import express from "express";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { iniciarConfig } from "../src/services/config";
import { fecharFila } from "../src/services/fila";
import { MetricasFila, obterMetricasFila } from "../src/services/metricas";
import { montarSinal } from "../src/jobs/sinal";

let servidorVision: Server;
let conexao: ConexaoPostgres;
let idEvento: number;
let antes: MetricasFila;

before(async () => {
    const app = express();
    app.get("/health", (_req, res) => {
        res.json({ gpu: { vram_usada_mb: 1000, vram_total_mb: 12282, utilizacao: 10 } });
    });
    servidorVision = app.listen(0);
    await new Promise((resolve) => servidorVision.once("listening", resolve));

    iniciarConfig({
        PAPEL: "estacao",
        POSTGRES_HOST: "127.0.0.1",
        POSTGRES_PORT: "5433",
        POSTGRES_USER: "fotos",
        POSTGRES_PASSWORD: "fotos",
        POSTGRES_DB: "fotos_estacao",
        REDIS_URL: "redis://127.0.0.1:6380",
        ESTACAO_CHAVE: "a".repeat(32),
        VPS_URL: "http://127.0.0.1:1",
        VISION_URL: `http://127.0.0.1:${(servidorVision.address() as AddressInfo).port}`,
    });

    conexao = new ConexaoPostgres();
    await conexao.open();
    const slug = `evento-metricas-${Date.now()}`;
    // Id explícito: na estação todo evento vem da VPS com o id de lá.
    const [evento] = await conexao.queryParam<{ id_evento: number }>(
        `INSERT INTO evento (id_evento, nome, slug, tipo, privado, chave_anfitriao, data_fim, config)
         VALUES ((SELECT COALESCE(MAX(id_evento), 0) + 1 FROM evento), 'Teste', ?, 'esportivo', 'N', ?, '2026-12-31', '{}') RETURNING id_evento`,
        [slug, `anfitriao-${Date.now()}`]
    );
    idEvento = evento.id_evento;

    // As métricas são do banco inteiro (a estação atende um evento por vez), então o que se
    // verifica é o quanto estas fotos mexeram nos números, não o valor absoluto.
    antes = await obterMetricasFila(conexao);

    await conexao.executeParamCount(
        "INSERT INTO foto (id_evento, hash_arquivo, nome_arquivo, etapa) VALUES (?, 'h1', 'a.jpg', 'rostos'), (?, 'h2', 'b.jpg', 'derivados')",
        [idEvento, idEvento]
    );
    await conexao.executeParamCount(
        "INSERT INTO foto (id_evento, hash_arquivo, nome_arquivo, etapa, publicada_em, criado_em) VALUES (?, 'h3', 'c.jpg', 'publicada', now(), now() - interval '10 seconds')",
        [idEvento]
    );
    await conexao.executeParamCount("INSERT INTO foto (id_evento, hash_arquivo, nome_arquivo, etapa, erro, erro_etapa) VALUES (?, 'h4', 'd.jpg', 'original', 'falhou', 'original')", [
        idEvento,
    ]);
});

test("obterMetricasFila conta por etapa, fotos/min e taxa de erro", async () => {
    const metricas = await obterMetricasFila(conexao);

    assert.strictEqual((metricas.por_etapa.rostos ?? 0) - (antes.por_etapa.rostos ?? 0), 1);
    assert.strictEqual((metricas.por_etapa.derivados ?? 0) - (antes.por_etapa.derivados ?? 0), 1);
    assert.strictEqual((metricas.por_etapa.original ?? 0) - (antes.por_etapa.original ?? 0), 1);
    assert.strictEqual(metricas.por_etapa.publicada, undefined);
    assert.ok(metricas.fotos_min[1] >= 1);
    assert.ok(metricas.taxa_erro > 0);
});

test("montarSinal combina fila BullMQ, métricas e GPU", async () => {
    const sinal = await montarSinal(conexao);
    assert.ok(sinal.fila_bullmq);
    assert.deepStrictEqual(sinal.gpu, { vram_usada_mb: 1000, vram_total_mb: 12282, utilizacao: 10 });
});

after(async () => {
    servidorVision?.close();
    await conexao?.close();
    await fecharFila();
});

// Fecha o pool: sem isso o processo de teste fica ~30s ocioso antes de sair.
after(async () => {
    await fecharBanco();
});
