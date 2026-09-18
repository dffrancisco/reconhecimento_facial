import { test, describe } from "node:test";
import assert from "node:assert";
import { carregarConfig, config, iniciarConfig } from "./config";

const BASE = {
    POSTGRES_HOST: "localhost",
    POSTGRES_USER: "fotos",
    POSTGRES_PASSWORD: "segredo",
    POSTGRES_DB: "fotos_vps",
    REDIS_URL: "redis://localhost:6379",
    ESTACAO_CHAVE: "a".repeat(32),
};

describe("carregarConfig", () => {
    test("recusa PAPEL ausente", () => {
        assert.throws(() => carregarConfig({ ...BASE }), /PAPEL deve ser "estacao" ou "vps"/);
    });

    test("recusa PAPEL inválido", () => {
        assert.throws(() => carregarConfig({ ...BASE, PAPEL: "servidor" }), /recebido: "servidor"/);
    });

    test("VPS exige ARQUIVO_SEGREDO", () => {
        assert.throws(() => carregarConfig({ ...BASE, PAPEL: "vps" }), /faltando para o papel vps: ARQUIVO_SEGREDO/);
    });

    test("estação exige VPS_URL e não exige ARQUIVO_SEGREDO", () => {
        assert.throws(() => carregarConfig({ ...BASE, PAPEL: "estacao" }), /faltando para o papel estacao: VPS_URL$/);
    });

    test("lista todas as variáveis faltando de uma vez", () => {
        assert.throws(
            () => carregarConfig({ PAPEL: "vps" }),
            /POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, REDIS_URL, ESTACAO_CHAVE, ARQUIVO_SEGREDO/
        );
    });

    test("recusa ESTACAO_CHAVE curta", () => {
        assert.throws(
            () => carregarConfig({ ...BASE, PAPEL: "vps", ARQUIVO_SEGREDO: "x", ESTACAO_CHAVE: "curta" }),
            /ESTACAO_CHAVE deve ter pelo menos 32 caracteres/
        );
    });

    test("recusa porta que não é inteiro positivo", () => {
        assert.throws(
            () => carregarConfig({ ...BASE, PAPEL: "vps", ARQUIVO_SEGREDO: "x", PORTA: "abc" }),
            /PORTA deve ser um número inteiro positivo/
        );
    });

    test("aplica os padrões", () => {
        const c = carregarConfig({ ...BASE, PAPEL: "vps", ARQUIVO_SEGREDO: "x" });

        assert.strictEqual(c.porta, 3000);
        assert.strictEqual(c.postgres.porta, 5432);
        assert.strictEqual(c.redis.prefixo, "fotos:vps:");
        assert.strictEqual(c.vpsUrl, "");
    });

    test("lê os valores informados", () => {
        const c = carregarConfig({
            ...BASE,
            PAPEL: "estacao",
            VPS_URL: "https://admin.exemplo.com.br",
            PORTA: "8080",
            POSTGRES_PORT: "5433",
            REDIS_PREFIXO: "teste:",
        });

        assert.strictEqual(c.papel, "estacao");
        assert.strictEqual(c.porta, 8080);
        assert.deepStrictEqual(c.postgres, {
            host: "localhost",
            porta: 5433,
            usuario: "fotos",
            senha: "segredo",
            banco: "fotos_vps",
        });
        assert.strictEqual(c.redis.prefixo, "teste:");
        assert.strictEqual(c.vpsUrl, "https://admin.exemplo.com.br");
    });
});

describe("iniciarConfig", () => {
    test("preenche o objeto compartilhado", () => {
        const devolvido = iniciarConfig({ ...BASE, PAPEL: "vps", ARQUIVO_SEGREDO: "x" });

        assert.strictEqual(devolvido, config);
        assert.strictEqual(config.papel, "vps");
    });
});
