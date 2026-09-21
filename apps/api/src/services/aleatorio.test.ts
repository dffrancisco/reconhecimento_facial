import { test } from "node:test";
import assert from "node:assert";
import { gerarChave } from "./aleatorio";

test("gera hex do tamanho esperado e não repete", () => {
    const a = gerarChave();
    const b = gerarChave();
    assert.match(a, /^[0-9a-f]{40}$/);
    assert.notStrictEqual(a, b);
});

test("aceita outro tamanho de bytes", () => {
    assert.match(gerarChave(8), /^[0-9a-f]{16}$/);
});
