import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import { iniciarConfig } from "../src/services/config";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { envTeste } from "./ambiente";

const TABELA = `teste_conexao_${process.pid}`;

async function executar(sql: string): Promise<void> {
    const c = new ConexaoPostgres();
    await c.open();
    await c.queryParam(sql, []);
    await c.close();
}

async function contar(): Promise<number> {
    const c = new ConexaoPostgres();
    await c.open();
    const linha = await c.queryOneParam<{ n: number }>(`SELECT count(*)::int AS n FROM ${TABELA}`, []);
    await c.close();
    return linha?.n ?? -1;
}

before(async () => {
    iniciarConfig(envTeste("vps"));
    await executar(`CREATE TABLE IF NOT EXISTS ${TABELA} (x int)`);
});

after(async () => {
    await executar(`DROP TABLE IF EXISTS ${TABELA}`);
    await fecharBanco();
});

describe("ConexaoPostgres com banco real", () => {
    test("close sem erro faz commit", async () => {
        const c = new ConexaoPostgres();
        await c.openTransaction();
        assert.strictEqual(await c.executeParamCount(`INSERT INTO ${TABELA} VALUES (?)`, [1]), 1);
        await c.close();

        assert.strictEqual(await contar(), 1);
    });

    test("close depois de erro faz rollback", async () => {
        const c = new ConexaoPostgres();
        await c.openTransaction();
        await c.executeParamCount(`INSERT INTO ${TABELA} VALUES (?)`, [2]);
        await assert.rejects(c.queryParam("SELECT * FROM tabela_que_nao_existe", []));
        await c.close();

        assert.strictEqual(await contar(), 1);
    });

    test("reabrir com transação aberta desfaz a anterior", async () => {
        const c = new ConexaoPostgres();
        await c.openTransaction();
        await c.executeParamCount(`INSERT INTO ${TABELA} VALUES (?)`, [3]);
        await c.openTransaction();
        await c.close();

        assert.strictEqual(await contar(), 1);
    });

    test("queryOneParam sem linha devolve undefined", async () => {
        const c = new ConexaoPostgres();
        await c.open();
        assert.strictEqual(await c.queryOneParam(`SELECT x FROM ${TABELA} WHERE x = ?`, [999]), undefined);
        await c.close();
    });

    test("? dentro de texto não desalinha os valores", async () => {
        const c = new ConexaoPostgres();
        await c.open();
        const linha = await c.queryOneParam<{ t: string; n: number }>("SELECT 'o que houve?' AS t, ?::int AS n", [7]);
        await c.close();

        assert.deepStrictEqual(linha, { t: "o que houve?", n: 7 });
    });
});
