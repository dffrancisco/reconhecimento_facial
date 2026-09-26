import { test } from "node:test";
import assert from "node:assert";
import { caminhoMarcaDagua, caminhoOriginal, caminhoPublicar } from "./caminhos";

test("caminhoOriginal usa slug e data, não o id do evento", () => {
    assert.strictEqual(caminhoOriginal("/data/originais", "corrida-x", "2026-11-01", "abc123"), "/data/originais/corrida-x/2026-11-01/abc123.jpg");
});

test("caminhoPublicar usa o id do evento e o sufixo do tipo", () => {
    assert.strictEqual(caminhoPublicar("/data/publicar", 7, "abc123", "web"), "/data/publicar/7/abc123_web.jpg");
    assert.strictEqual(caminhoPublicar("/data/publicar", 7, "abc123", "thumb"), "/data/publicar/7/abc123_thumb.jpg");
});

test("caminhoMarcaDagua", () => {
    assert.strictEqual(caminhoMarcaDagua("/data/marcas", 7), "/data/marcas/7.png");
});
