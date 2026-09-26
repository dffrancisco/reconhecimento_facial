import { test, before, after } from "node:test";
import assert from "node:assert";
import express from "express";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { iniciarConfig, config } from "../src/services/config";
import { processarSincronizar } from "../src/jobs/sincronizar";

let servidorVps: Server;
let raizMarcas: string;
let conteudoServido = "marca-versao-1";
let marcaEm = new Date("2026-01-01T10:00:00Z").toISOString();
const ID_EVENTO = 950_000 + (Date.now() % 40_000);

before(async () => {
    const app = express();
    app.use(express.json());
    app.post("/api/estacao/sincronizacao", (_req, res) => {
        res.json({
            operadores: [],
            eventos: [
                {
                    id_evento: ID_EVENTO,
                    nome: "Evento com marca",
                    slug: `evento-marca-sync-${ID_EVENTO}`,
                    tipo: "esportivo",
                    privado: "N",
                    chave_acesso: null,
                    chave_anfitriao: `anfitriao-${ID_EVENTO}`,
                    data_inicio: null,
                    data_fim: "2026-12-31",
                    ativo: "S",
                    config: { marca_dagua: true },
                    marca_dagua_caminho: `/api/estacao/marca-dagua/${ID_EVENTO}`,
                    marca_dagua_em: marcaEm,
                },
            ],
            fotografos: [],
            vinculos: [],
        });
    });
    app.get(`/api/estacao/marca-dagua/${ID_EVENTO}`, (_req, res) => {
        res.type("image/png").send(Buffer.from(conteudoServido));
    });
    servidorVps = app.listen(0);
    await new Promise((resolve) => servidorVps.once("listening", resolve));

    raizMarcas = await fs.mkdtemp(path.join(os.tmpdir(), "marcas-sync-"));
    iniciarConfig({
        PAPEL: "estacao",
        POSTGRES_HOST: "127.0.0.1",
        POSTGRES_PORT: "5433",
        POSTGRES_USER: "fotos",
        POSTGRES_PASSWORD: "fotos",
        POSTGRES_DB: "fotos_estacao",
        REDIS_URL: "redis://127.0.0.1:6380",
        ESTACAO_CHAVE: "a".repeat(32),
        VPS_URL: `http://127.0.0.1:${(servidorVps.address() as AddressInfo).port}`,
        VISION_URL: "http://127.0.0.1:1",
        RAIZ_MARCAS: raizMarcas,
    });
});

test("marca trocada na VPS chega à estação na sincronização seguinte", async () => {
    await processarSincronizar(new ConexaoPostgres());
    const destino = path.join(config.raizMarcas, `${ID_EVENTO}.png`);
    assert.strictEqual(await fs.readFile(destino, "utf8"), "marca-versao-1");

    // O admin sobe outro logo na VPS: a estação não pode seguir usando o antigo para sempre.
    conteudoServido = "marca-versao-2";
    marcaEm = new Date("2026-06-01T10:00:00Z").toISOString();
    await processarSincronizar(new ConexaoPostgres());

    assert.strictEqual(await fs.readFile(destino, "utf8"), "marca-versao-2");
});

after(async () => {
    servidorVps?.close();
    await fs.rm(raizMarcas, { recursive: true, force: true });
});

// Fecha o pool: sem isso o processo de teste fica ~30s ocioso antes de sair.
after(async () => {
    await fecharBanco();
});
