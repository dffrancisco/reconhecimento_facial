import { test, before, after } from "node:test";
import assert from "node:assert";
import express from "express";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { iniciarConfig, config } from "../src/services/config";
import { processarSincronizar } from "../src/jobs/sincronizar";

let servidorVps: Server;
let conexao: ConexaoPostgres;

// Ids e chaves altos e únicos por execução: o banco da estação é compartilhado e pode já
// conter os dados que a sincronização real trouxe da VPS (logins e slugs são únicos lá).
const marca = Date.now() % 1_000_000;
const ID_OPERADOR = 900_000 + marca;
const ID_EVENTO = 900_000 + marca;
const ID_FOTOGRAFO = 900_000 + marca;
const ID_VINCULO = 900_000 + marca;

before(async () => {
    const app = express();
    app.use(express.json());
    app.post("/api/estacao/sincronizacao", (_req, res) => {
        res.json({
            operadores: [{ id_operador: ID_OPERADOR, nome: "Ana", login: `ana-${marca}`, senha_hash: "hash", deletado: "N" }],
            eventos: [
                {
                    id_evento: ID_EVENTO,
                    nome: "Evento Sync",
                    slug: `evento-sync-${marca}`,
                    tipo: "esportivo",
                    privado: "N",
                    chave_acesso: null,
                    chave_anfitriao: `chave-anfitriao-${marca}`,
                    data_inicio: null,
                    data_fim: "2026-12-31",
                    ativo: "S",
                    config: { limiar: 0.42 },
                    marca_dagua_caminho: null,
                },
            ],
            fotografos: [{ id_fotografo: ID_FOTOGRAFO, nome: "Fotógrafo Sync", telefone: null, deletado: "N" }],
            vinculos: [{ id_evento_fotografo: ID_VINCULO, id_evento: ID_EVENTO, id_fotografo: ID_FOTOGRAFO, token_upload: `token-${marca}`, ativo: "S" }],
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
        VISION_URL: "http://127.0.0.1:1",
        RAIZ_MARCAS: "/tmp/marcas-teste-sincronizar",
    });
});

test("grava operadores, eventos, fotógrafos e vínculos com os mesmos IDs da VPS", async () => {
    conexao = new ConexaoPostgres();
    await processarSincronizar(conexao);

    const verificacao = new ConexaoPostgres();
    await verificacao.open();
    const [operador] = await verificacao.queryParam("SELECT * FROM operador WHERE id_operador = ?", [ID_OPERADOR]);
    const [evento] = await verificacao.queryParam("SELECT * FROM evento WHERE id_evento = ?", [ID_EVENTO]);
    const [vinculo] = await verificacao.queryParam("SELECT * FROM evento_fotografo WHERE id_evento_fotografo = ?", [ID_VINCULO]);
    assert.strictEqual(operador.login, `ana-${marca}`);
    assert.strictEqual(evento.slug, `evento-sync-${marca}`);
    assert.strictEqual(vinculo.token_upload, `token-${marca}`);
    await verificacao.close();
});

after(async () => {
    servidorVps?.close();
});

// Fecha o pool: sem isso o processo de teste fica ~30s ocioso antes de sair.
after(async () => {
    await fecharBanco();
});
