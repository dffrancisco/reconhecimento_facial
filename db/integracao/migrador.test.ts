import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import path from "node:path";
import { Client } from "pg";
import { aplicarPendentes, listarMigracoes, reverterUltima, situacao } from "../migrador";
import { criarBancoTeste, tabelas } from "./bancoTeste";

const BASICO = listarMigracoes(path.join(__dirname, "fixtures", "basico"));
const COM_ERRO = listarMigracoes(path.join(__dirname, "fixtures", "com-erro"));

describe("migrador com banco real", () => {
    let banco: { client: Client; remover(): Promise<void> };

    before(async () => {
        banco = await criarBancoTeste();
    });

    after(async () => {
        await banco.remover();
    });

    test("aplica só as migrações do papel, em ordem", async () => {
        const feitas = await aplicarPendentes(banco.client, BASICO, "vps");

        assert.deepStrictEqual(feitas, ["20000101000001_tabela_comum", "20000101000002_tabela_vps"]);
        assert.deepStrictEqual(await tabelas(banco.client), ["comum", "schema_migrations", "schema_papel", "so_vps"]);
    });

    test("segunda execução não aplica nada", async () => {
        assert.deepStrictEqual(await aplicarPendentes(banco.client, BASICO, "vps"), []);
    });

    test("recusa usar o banco com o outro papel", async () => {
        await assert.rejects(aplicarPendentes(banco.client, BASICO, "estacao"), /pertence ao papel "vps"/);
    });

    test("situacao lista só as do papel", async () => {
        assert.deepStrictEqual(await situacao(banco.client, BASICO, "vps"), [
            { versao: "20000101000001_tabela_comum", aplicada: true },
            { versao: "20000101000002_tabela_vps", aplicada: true },
        ]);
    });

    test("reverte uma por vez, da última para a primeira", async () => {
        assert.strictEqual(await reverterUltima(banco.client, BASICO, "vps"), "20000101000002_tabela_vps");
        assert.deepStrictEqual(await tabelas(banco.client), ["comum", "schema_migrations", "schema_papel"]);

        assert.strictEqual(await reverterUltima(banco.client, BASICO, "vps"), "20000101000001_tabela_comum");
        assert.strictEqual(await reverterUltima(banco.client, BASICO, "vps"), null);
        assert.deepStrictEqual(await tabelas(banco.client), ["schema_migrations", "schema_papel"]);
    });
});

describe("migração que falha", () => {
    let banco: { client: Client; remover(): Promise<void> };

    before(async () => {
        banco = await criarBancoTeste();
    });

    after(async () => {
        await banco.remover();
    });

    test("desfaz a que falhou e mantém as anteriores", async () => {
        await assert.rejects(aplicarPendentes(banco.client, COM_ERRO, "vps"), /Falha em 20000101000002_quebrada/);

        assert.deepStrictEqual(await tabelas(banco.client), ["boa", "schema_migrations", "schema_papel"]);
        const { rows } = await banco.client.query("SELECT version FROM schema_migrations");
        assert.deepStrictEqual(rows, [{ version: "20000101000001_boa" }]);
    });
});

describe("status somente leitura", () => {
    let banco: { client: Client; remover(): Promise<void> };

    before(async () => {
        banco = await criarBancoTeste();
    });

    after(async () => {
        await banco.remover();
    });

    test("situacao em banco novo não cria nem grava nada", async () => {
        assert.deepStrictEqual(await situacao(banco.client, BASICO, "vps"), [
            { versao: "20000101000001_tabela_comum", aplicada: false },
            { versao: "20000101000002_tabela_vps", aplicada: false },
        ]);
        assert.deepStrictEqual(await tabelas(banco.client), []);
    });
});
