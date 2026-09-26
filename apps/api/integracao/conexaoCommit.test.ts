import { test, before, after } from "node:test";
import assert from "node:assert";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { iniciarConfig } from "../src/services/config";

before(() => {
    iniciarConfig({
        PAPEL: "vps",
        POSTGRES_HOST: "127.0.0.1",
        POSTGRES_PORT: "5433",
        POSTGRES_USER: "fotos",
        POSTGRES_PASSWORD: "fotos",
        POSTGRES_DB: "fotos_vps",
        REDIS_URL: "redis://127.0.0.1:6380",
        ESTACAO_CHAVE: "a".repeat(32),
        ARQUIVO_SEGREDO: "x",
        OPERADOR_SEGREDO: "a".repeat(32),
    });
});

// Quem chama close() precisa saber que o COMMIT não aconteceu: engolir o erro faz a API
// responder 200 sobre dados que não foram gravados (e a estação apagar a foto publicada).
test("close() rejeita quando o COMMIT falha", async () => {
    const conexao = new ConexaoPostgres();
    await conexao.openTransaction();
    const [{ pid }] = await conexao.queryParam<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    await conexao.executeParamCount("CREATE TEMP TABLE teste_commit_falha (x int)");

    // Derruba a conexão por fora: o COMMIT seguinte não tem como acontecer.
    const carrasco = new ConexaoPostgres();
    await carrasco.open();
    await carrasco.queryParam("SELECT pg_terminate_backend(?)", [pid]);
    await carrasco.close();

    await assert.rejects(() => conexao.close());
});

test("close() continua devolvendo true quando o COMMIT funciona", async () => {
    const conexao = new ConexaoPostgres();
    await conexao.openTransaction();
    await conexao.executeParamCount("CREATE TEMP TABLE teste_commit_ok (x int)");
    assert.strictEqual(await conexao.close(), true);
});

after(async () => {
    await fecharBanco();
});
