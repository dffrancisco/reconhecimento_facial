import { test, describe } from "node:test";
import assert from "node:assert";
import ConexaoPostgres, { parseParams } from "./conexaoPostgres";

// parseParams passa por toda query do sistema: um erro aqui desalinha valores em silêncio.

describe("parseParams com ?", () => {
    test("traduz para $N na ordem e leva os valores", () => {
        const r = parseParams("SELECT x FROM t WHERE a ilike ? AND b = ?", ["%", 0]);

        assert.strictEqual(r.text, "SELECT x FROM t WHERE a ilike $1 AND b = $2");
        assert.deepStrictEqual(r.values, ["%", 0]);
    });

    test("SQL sem parâmetro passa intacto", () => {
        assert.deepStrictEqual(parseParams("SELECT 1", []), { text: "SELECT 1", values: [] });
    });

    test("placeholder sem valor vira null", () => {
        assert.deepStrictEqual(parseParams("SELECT x WHERE a = ? AND b = ?", ["só-um"]).values, ["só-um", null]);
    });

    test("null explícito é preservado", () => {
        assert.deepStrictEqual(parseParams("SELECT x WHERE a = ?", [null]).values, [null]);
    });

    test("cast ::vector depois do ? é mantido", () => {
        const r = parseParams("SELECT 1 - (embedding <=> ?::vector) FROM rosto WHERE id_evento = ?", ["[1,0]", 7]);

        assert.strictEqual(r.text, "SELECT 1 - (embedding <=> $1::vector) FROM rosto WHERE id_evento = $2");
    });
});

describe("parseParams com $N", () => {
    test("repassa intacto, permitindo reusar o mesmo valor", () => {
        const r = parseParams("SELECT x WHERE a = $1 OR b = $1", [5]);

        assert.deepStrictEqual(r, { text: "SELECT x WHERE a = $1 OR b = $1", values: [5] });
    });

    test("recusa misturar ? com $N", () => {
        assert.throws(() => parseParams("SELECT x WHERE a = ? AND b = $2", [1, 2]), /mistura placeholder/);
    });

    test("$N dentro de string não conta como mistura", () => {
        const r = parseParams("SELECT x WHERE a = ? AND b = 'custa $1'", [1]);

        assert.strictEqual(r.text, "SELECT x WHERE a = $1 AND b = 'custa $1'");
    });
});

describe("ConexaoPostgres sem banco", () => {
    test("recusa query antes de open()", async () => {
        const conexao = new ConexaoPostgres();

        await assert.rejects(conexao.queryParam("SELECT 1", []), /Conexão não aberta/);
    });
});
