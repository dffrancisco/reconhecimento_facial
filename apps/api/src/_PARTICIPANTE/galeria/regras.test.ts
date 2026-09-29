import { test, describe } from "node:test";
import assert from "node:assert";
import { diaValido } from "./regras";

describe("diaValido", () => {
    test("aceita o formato AAAA-MM-DD", () => {
        assert.strictEqual(diaValido("2026-09-26"), true);
    });

    test("recusa valores inválidos", () => {
        const invalidos = ["26/09/2026", "2026-9-26", "2026-09-26T00:00", "x' OR '1'='1", 20260926, null, undefined, ["2026-09-26"]];
        for (const valor of invalidos) {
            assert.strictEqual(diaValido(valor), false, `Deveria rejeitar: ${JSON.stringify(valor)}`);
        }
    });
});
