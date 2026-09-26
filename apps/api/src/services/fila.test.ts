import { test, after } from "node:test";
import assert from "node:assert";
import { backoffComTeto, criarFila, fecharFila } from "./fila";
import { iniciarConfig } from "./config";

test("cresce exponencialmente até o teto e trava nele", () => {
    const estrategia = backoffComTeto(10_000);
    assert.strictEqual(estrategia(0), 1000);
    assert.strictEqual(estrategia(1), 2000);
    assert.strictEqual(estrategia(2), 4000);
    assert.strictEqual(estrategia(10), 10_000);
    assert.strictEqual(estrategia(30), 10_000);
});

test("criarFila reaproveita a Queue do mesmo nome", () => {
    iniciarConfig({
        PAPEL: "estacao",
        POSTGRES_HOST: "127.0.0.1",
        POSTGRES_USER: "x",
        POSTGRES_PASSWORD: "x",
        POSTGRES_DB: "x",
        REDIS_URL: "redis://127.0.0.1:6380",
        ESTACAO_CHAVE: "a".repeat(32),
        VPS_URL: "http://127.0.0.1:1",
        VISION_URL: "http://127.0.0.1:1",
    });

    // Sem reaproveitar, cada foto publicada e cada sinal criariam uma Queue nova — com os
    // listeners dela — num processo que fica dias no ar.
    assert.strictEqual(criarFila("fila-teste-reuso"), criarFila("fila-teste-reuso"));
    assert.notStrictEqual(criarFila("fila-teste-reuso"), criarFila("outra-fila-teste"));
});

after(async () => {
    await fecharFila();
});
