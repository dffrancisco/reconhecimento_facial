import { describe, expect, test } from "vitest";
import { enderecoDoNome } from "./endereco";

describe("enderecoDoNome", () => {
    test("minúsculas, sem acento, espaços e símbolos viram um hífen só", () => {
        expect(enderecoDoNome("Corrida da Serra 2026")).toBe("corrida-da-serra-2026");
        expect(enderecoDoNome("  São João — Festa!! ")).toBe("sao-joao-festa");
        expect(enderecoDoNome("Corrida X!")).toBe("corrida-x");
    });

    test("nada aproveitável vira vazio", () => {
        expect(enderecoDoNome("!!!")).toBe("");
    });

    test("até 80 caracteres, sem hífen sobrando no fim do corte", () => {
        const endereco = enderecoDoNome(`${"a".repeat(79)} b`);
        expect(endereco.length).toBeLessThanOrEqual(80);
        expect(endereco.endsWith("-")).toBe(false);
    });
});
