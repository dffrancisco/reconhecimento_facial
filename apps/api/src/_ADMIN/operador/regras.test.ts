import { test, describe } from "node:test";
import assert from "node:assert";
import { normalizarLogin, validarLogin, validarNome, validarSenha } from "./regras";

describe("normalizarLogin", () => {
    test("tira os espaços das pontas e passa para minúsculas", () => {
        assert.strictEqual(normalizarLogin("  Francisco "), "francisco");
    });
});

describe("validarLogin", () => {
    test("aceita letras minúsculas, números, ponto, hífen e sublinhado", () => {
        for (const login of ["francisco", "ana.paula", "op-2", "joao_silva", "abc"]) assert.strictEqual(validarLogin(login), null, login);
    });

    test("recusa curto demais, longo demais, com espaço no meio ou acento", () => {
        for (const login of ["ab", "a".repeat(61), "ana paula", "joão", "ana@x"]) assert.ok(validarLogin(login), login);
    });

    test("confere o login já normalizado: maiúsculas e espaços nas pontas passam", () => {
        assert.strictEqual(validarLogin(" Francisco "), null);
    });

    test("recusa vazio ou o que não é texto", () => {
        assert.ok(validarLogin(""));
        assert.ok(validarLogin(undefined));
        assert.ok(validarLogin(42));
    });
});

describe("validarSenha", () => {
    test("pede pelo menos 8 caracteres", () => {
        assert.ok(validarSenha("1234567"));
        assert.strictEqual(validarSenha("12345678"), null);
    });

    test("recusa mais de 200: o scrypt de um texto enorme vira um jeito de travar a API", () => {
        assert.ok(validarSenha("a".repeat(201)));
        assert.strictEqual(validarSenha("a".repeat(200)), null);
    });

    test("recusa o que não é texto", () => {
        assert.ok(validarSenha(undefined));
        assert.ok(validarSenha(12345678));
    });
});

describe("validarNome", () => {
    test("pede o nome, sem contar os espaços", () => {
        assert.ok(validarNome("   "));
        assert.ok(validarNome(undefined));
        assert.strictEqual(validarNome("Ana"), null);
    });

    test("até 100 caracteres", () => {
        assert.ok(validarNome("a".repeat(101)));
        assert.strictEqual(validarNome("a".repeat(100)), null);
    });
});
