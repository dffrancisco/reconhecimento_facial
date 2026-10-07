import { test } from "node:test";
import assert from "node:assert";
import { caminhoMarcaDagua, caminhoOriginal, caminhoPublicar, pastaDoEvento } from "./caminhos";

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

test("pastaDoEvento devolve a pasta de um nome simples dentro da raiz", () => {
    assert.strictEqual(pastaDoEvento("/data/originais", "corrida-x"), "/data/originais/corrida-x");
    assert.strictEqual(pastaDoEvento("/data/fotos", "12"), "/data/fotos/12");
});

test("pastaDoEvento recusa o que apagaria a raiz ou sairia dela", () => {
    // A exclusão do evento apaga a pasta inteira: um nome vazio ou com ".." levaria a raiz junto.
    for (const nome of ["", ".", "..", "../outra", "a/b", "/etc", "  "]) assert.strictEqual(pastaDoEvento("/data/originais", nome), null, nome);
});
