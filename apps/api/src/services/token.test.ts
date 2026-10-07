import { test } from "node:test";
import assert from "node:assert";
import { createHmac } from "node:crypto";
import { conferirToken, gerarToken } from "./token";

const SEGREDO = "segredo-de-teste-com-pelo-menos-32-caracteres";

test("gera e confere um token válido, com a versão da senha", () => {
    const token = gerarToken(42, SEGREDO, "abc123");
    assert.deepStrictEqual(conferirToken(token, SEGREDO), { id_operador: 42, versao: "abc123" });
});

test("recusa token assinado com outro segredo", () => {
    const token = gerarToken(42, SEGREDO, "abc123");
    assert.strictEqual(conferirToken(token, "outro-segredo-com-32-caracteres-tambem"), null);
});

test("recusa token expirado", () => {
    const token = gerarToken(42, SEGREDO, "abc123", -1);
    assert.strictEqual(conferirToken(token, SEGREDO), null);
});

test("recusa token malformado", () => {
    assert.strictEqual(conferirToken("qualquer-coisa", SEGREDO), null);
    assert.strictEqual(conferirToken("", SEGREDO), null);
});

test("recusa payload adulterado mesmo com assinatura de outro token válido", () => {
    const token1 = gerarToken(1, SEGREDO, "abc123");
    const token2 = gerarToken(2, SEGREDO, "abc123");
    const [, assinatura2] = token2.split(".");
    const [payload1] = token1.split(".");
    assert.strictEqual(conferirToken(`${payload1}.${assinatura2}`, SEGREDO), null);
});

test("recusa o token de antes da versão da senha, mesmo bem assinado", () => {
    // Os tokens emitidos antes desta versão não sabem de qual senha vieram: não dá para cortá-los.
    const payload = Buffer.from(JSON.stringify({ id_operador: 42, exp: Date.now() + 60_000 })).toString("base64url");
    const antigo = `${payload}.${createHmac("sha256", SEGREDO).update(payload).digest("hex")}`;
    assert.strictEqual(conferirToken(antigo, SEGREDO), null);
});
