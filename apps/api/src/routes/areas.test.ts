import { test } from "node:test";
import assert from "node:assert";
import { areasDoPapel } from "./areas";

test("estação monta só fotógrafo e painel", () => {
    assert.deepStrictEqual(
        areasDoPapel("estacao").map((a) => a.caminho),
        ["fotografo", "painel"]
    );
});

test("VPS monta participante, anfitrião, admin e estação", () => {
    assert.deepStrictEqual(
        areasDoPapel("vps").map((a) => a.caminho),
        ["participante", "anfitriao", "admin", "estacao"]
    );
});
