import { test } from "node:test";
import assert from "node:assert";
import { conferirSenha, gerarHashSenha, versaoDaSenha } from "./senha";

test("gera hashes diferentes para a mesma senha (salt aleatório)", async () => {
    const a = await gerarHashSenha("segredo123");
    const b = await gerarHashSenha("segredo123");
    assert.notStrictEqual(a, b);
});

test("confere a senha certa e recusa a errada", async () => {
    const hash = await gerarHashSenha("segredo123");
    assert.strictEqual(await conferirSenha("segredo123", hash), true);
    assert.strictEqual(await conferirSenha("outra-senha", hash), false);
});

test("recusa hash em formato inválido sem lançar", async () => {
    assert.strictEqual(await conferirSenha("segredo123", "formato-invalido"), false);
});

test("a versão da senha é curta, a mesma para o mesmo hash e outra a cada troca", async () => {
    const hash = await gerarHashSenha("segredo123");
    // A mesma senha digitada de novo gera outro hash (salt novo): trocar para a mesma ainda derruba as sessões.
    const trocada = await gerarHashSenha("segredo123");

    assert.match(versaoDaSenha(hash), /^[0-9a-f]{16}$/);
    assert.strictEqual(versaoDaSenha(hash), versaoDaSenha(hash));
    assert.notStrictEqual(versaoDaSenha(hash), versaoDaSenha(trocada));
});
