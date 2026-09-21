import { test } from "node:test";
import assert from "node:assert";
import { conferirToken, gerarToken } from "./token";

const SEGREDO = "segredo-de-teste-com-pelo-menos-32-caracteres";

test("gera e confere um token válido", () => {
    const token = gerarToken(42, SEGREDO);
    assert.strictEqual(conferirToken(token, SEGREDO), 42);
});

test("recusa token assinado com outro segredo", () => {
    const token = gerarToken(42, SEGREDO);
    assert.strictEqual(conferirToken(token, "outro-segredo-com-32-caracteres-tambem"), null);
});

test("recusa token expirado", () => {
    const token = gerarToken(42, SEGREDO, -1);
    assert.strictEqual(conferirToken(token, SEGREDO), null);
});

test("recusa token malformado", () => {
    assert.strictEqual(conferirToken("qualquer-coisa", SEGREDO), null);
    assert.strictEqual(conferirToken("", SEGREDO), null);
});

test("recusa payload adulterado mesmo com assinatura de outro token válido", () => {
    const token1 = gerarToken(1, SEGREDO);
    const token2 = gerarToken(2, SEGREDO);
    const [, assinatura2] = token2.split(".");
    const [payload1] = token1.split(".");
    assert.strictEqual(conferirToken(`${payload1}.${assinatura2}`, SEGREDO), null);
});
