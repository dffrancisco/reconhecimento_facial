import { test, describe } from "node:test";
import assert from "node:assert";
import { percentil } from "./metricas";

describe("percentil", () => {
    test("lista vazia devolve 0", () => {
        assert.strictEqual(percentil([], 95), 0);
    });

    test("p50 de uma lista ímpar é a mediana", () => {
        assert.strictEqual(percentil([5, 1, 3, 2, 4], 50), 3);
    });

    test("p95 puxa para o maior valor em amostras pequenas", () => {
        assert.strictEqual(percentil([10, 20, 30, 40, 50], 95), 50);
    });

    test("não depende da ordem de entrada", () => {
        assert.strictEqual(percentil([100, 1, 50], 50), percentil([1, 50, 100], 50));
    });
});
