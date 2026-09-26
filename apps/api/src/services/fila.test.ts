import { test } from "node:test";
import assert from "node:assert";
import { backoffComTeto } from "./fila";

test("cresce exponencialmente até o teto e trava nele", () => {
    const estrategia = backoffComTeto(10_000);
    assert.strictEqual(estrategia(0), 1000);
    assert.strictEqual(estrategia(1), 2000);
    assert.strictEqual(estrategia(2), 4000);
    assert.strictEqual(estrategia(10), 10_000);
    assert.strictEqual(estrategia(30), 10_000);
});
