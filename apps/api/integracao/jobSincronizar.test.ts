import { test, before, after } from "node:test";
import assert from "node:assert";
import express from "express";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import ConexaoPostgres from "../src/db/conexaoPostgres";
import { iniciarConfig, config } from "../src/services/config";
import { processarSincronizar } from "../src/jobs/sincronizar";

let servidorVps: Server;
let conexao: ConexaoPostgres;

before(async () => {
    const app = express();
    app.use(express.json());
    app.post("/api/estacao/sincronizacao", (_req, res) => {
        res.json({
            operadores: [{ id_operador: 1, nome: "Ana", login: "ana", senha_hash: "hash", deletado: "N" }],
            eventos: [
                {
                    id_evento: 1,
                    nome: "Evento Sync",
                    slug: "evento-sync",
                    tipo: "esportivo",
                    privado: "N",
                    chave_acesso: null,
                    chave_anfitriao: "chave-anfitriao",
                    data_inicio: null,
                    data_fim: "2026-12-31",
                    ativo: "S",
                    config: { limiar: 0.42 },
                    marca_dagua_caminho: null,
                },
            ],
            fotografos: [{ id_fotografo: 1, nome: "Fotógrafo Sync", telefone: null, deletado: "N" }],
            vinculos: [{ id_evento_fotografo: 1, id_evento: 1, id_fotografo: 1, token_upload: "token", ativo: "S" }],
        });
    });
    servidorVps = app.listen(0);
    await new Promise((resolve) => servidorVps.once("listening", resolve));

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
        RAIZ_MARCAS: "/tmp/marcas-teste-sincronizar",
    });
});

test("grava operadores, eventos, fotógrafos e vínculos com os mesmos IDs da VPS", async () => {
    conexao = new ConexaoPostgres();
    await processarSincronizar(conexao);

    const verificacao = new ConexaoPostgres();
    await verificacao.open();
    const [operador] = await verificacao.queryParam("SELECT * FROM operador WHERE id_operador = 1");
    const [evento] = await verificacao.queryParam("SELECT * FROM evento WHERE id_evento = 1");
    const [vinculo] = await verificacao.queryParam("SELECT * FROM evento_fotografo WHERE id_evento_fotografo = 1");
    assert.strictEqual(operador.login, "ana");
    assert.strictEqual(evento.slug, "evento-sync");
    assert.strictEqual(vinculo.token_upload, "token");
    await verificacao.close();
});

after(async () => {
    servidorVps?.close();
});
