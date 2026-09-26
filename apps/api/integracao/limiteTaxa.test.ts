import { test, before, after } from "node:test";
import assert from "node:assert";
import { iniciarConfig } from "../src/services/config";
import { contarNaJanela } from "../src/services/limiteTaxa";
import { fecharFila } from "../src/services/fila";

before(() => {
    iniciarConfig({
        PAPEL: "vps",
        POSTGRES_HOST: "127.0.0.1",
        POSTGRES_PORT: "5433",
        POSTGRES_USER: "fotos",
        POSTGRES_PASSWORD: "fotos",
        POSTGRES_DB: "fotos_vps",
        REDIS_URL: "redis://127.0.0.1:6380",
        ESTACAO_CHAVE: "a".repeat(32),
        ARQUIVO_SEGREDO: "x",
        OPERADOR_SEGREDO: "a".repeat(32),
        VISION_URL: "http://127.0.0.1:1",
    });
});

test("conta as chamadas da mesma chave e separa chaves diferentes", async () => {
    const chave = `teste-${Date.now()}`;
    assert.strictEqual(await contarNaJanela(chave, 60), 1);
    assert.strictEqual(await contarNaJanela(chave, 60), 2);
    assert.strictEqual(await contarNaJanela(chave, 60), 3);
    assert.strictEqual(await contarNaJanela(`${chave}-outro`, 60), 1);
});

test("a janela expira sozinha", async () => {
    const chave = `teste-expira-${Date.now()}`;
    await contarNaJanela(chave, 1);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.strictEqual(await contarNaJanela(chave, 1), 1);
});

after(async () => {
    await fecharFila();
});
