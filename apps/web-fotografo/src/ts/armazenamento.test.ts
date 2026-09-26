import "fake-indexeddb/auto";
import { describe, expect, test } from "vitest";
import { criarArmazenamento } from "./armazenamento";

describe("armazenamento do navegador", () => {
    test("guarda a impressão digital para não recalcular ao soltar a pasta de novo", async () => {
        const a = criarArmazenamento("token-hash");
        await a.gravarHash("cartao/a.jpg|10|1", "abc");
        expect(await a.lerHash("cartao/a.jpg|10|1")).toBe("abc");
        expect(await a.lerHash("outra")).toBeUndefined();
    });

    test("conta como pendente só o que não terminou, e esquecer zera", async () => {
        const a = criarArmazenamento("token-pendentes");
        await a.gravarItem("1", { situacao: "esperando" });
        await a.gravarItem("2", { situacao: "enviando", idUpload: 3 });
        await a.gravarItem("3", { situacao: "enviado" });
        await a.gravarItem("4", { situacao: "erro" });
        expect(await a.pendentes()).toBe(2);

        await a.esquecerPendentes();
        expect(await a.pendentes()).toBe(0);
    });

    test("dois fotógrafos no mesmo notebook têm filas separadas", async () => {
        const ana = criarArmazenamento("token-ana");
        const bruno = criarArmazenamento("token-bruno");
        await ana.gravarItem("x", { situacao: "esperando" });
        expect(await bruno.pendentes()).toBe(0);
        expect(await ana.pendentes()).toBe(1);
    });
});
