import { test, describe } from "node:test";
import assert from "node:assert";
import { deveRodar, interpretarMigracao, nomeDeMigracaoValido } from "./migrateParse";

const COMPLETA = [
    "-- migrate:target vps",
    "-- migrate:up",
    "CREATE TABLE a (id int);",
    "",
    "-- migrate:down",
    "DROP TABLE a;",
].join("\n");

describe("interpretarMigracao", () => {
    test("separa up, down e alvo", () => {
        assert.deepStrictEqual(interpretarMigracao(COMPLETA, "x.sql"), {
            up: "CREATE TABLE a (id int);",
            down: "DROP TABLE a;",
            semTransacao: false,
            alvo: "vps",
        });
    });

    test("aceita quebras de linha CRLF", () => {
        assert.strictEqual(interpretarMigracao(COMPLETA.replace(/\n/g, "\r\n"), "x.sql").down, "DROP TABLE a;");
    });

    test("lê a diretiva no-transaction", () => {
        const m = interpretarMigracao(
            COMPLETA.replace("-- migrate:up", "-- migrate:up\n-- migrate:no-transaction"),
            "x.sql"
        );

        assert.strictEqual(m.semTransacao, true);
        assert.strictEqual(m.up, "CREATE TABLE a (id int);");
    });

    for (const alvo of ["estacao", "vps", "ambos"]) {
        test(`aceita o alvo ${alvo}`, () => {
            assert.strictEqual(
                interpretarMigracao(COMPLETA.replace("target vps", `target ${alvo}`), "x.sql").alvo,
                alvo
            );
        });
    }

    test("recusa alvo inválido", () => {
        assert.throws(
            () => interpretarMigracao(COMPLETA.replace("target vps", "target todos"), "x.sql"),
            /"-- migrate:target todos" inválida em x.sql/
        );
    });

    test("recusa arquivo sem alvo", () => {
        assert.throws(
            () => interpretarMigracao(COMPLETA.replace("-- migrate:target vps\n", ""), "x.sql"),
            /sem "-- migrate:target" em x.sql/
        );
    });

    test("recusa up vazio", () => {
        assert.throws(
            () =>
                interpretarMigracao(
                    "-- migrate:target vps\n-- migrate:up\n\n-- migrate:down\nDROP TABLE a;",
                    "x.sql"
                ),
            /sem seção "-- migrate:up" \(ou vazia\): x.sql/
        );
    });

    test("down é opcional", () => {
        assert.strictEqual(
            interpretarMigracao("-- migrate:target ambos\n-- migrate:up\nSELECT 1;", "x.sql").down,
            ""
        );
    });
});

describe("deveRodar", () => {
    test("ambos roda nos dois papéis", () => {
        assert.strictEqual(deveRodar("ambos", "estacao"), true);
        assert.strictEqual(deveRodar("ambos", "vps"), true);
    });

    test("alvo de um papel roda só nele", () => {
        assert.strictEqual(deveRodar("vps", "vps"), true);
        assert.strictEqual(deveRodar("vps", "estacao"), false);
        assert.strictEqual(deveRodar("estacao", "vps"), false);
    });
});

describe("nomeDeMigracaoValido", () => {
    test("aceita AAAAMMDDHHMMSS_nome.sql", () => {
        assert.strictEqual(nomeDeMigracaoValido("20260918120000_cadastros.sql"), true);
    });

    for (const nome of [
        "2026_cadastros.sql",
        "20260918120000-cadastros.sql",
        "20260918120000_Cadastros.sql",
        "20260918120000_x.txt",
    ]) {
        test(`recusa ${nome}`, () => {
            assert.strictEqual(nomeDeMigracaoValido(nome), false);
        });
    }
});
