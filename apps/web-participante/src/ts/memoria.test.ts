import { beforeEach, describe, expect, test, vi } from "vitest";
import { del, get, set } from "idb-keyval";
import { atualizarMemoria, guardarMemoria, limparMemoria, memoriaDoEvento, MemoriaDoEvento } from "./memoria";

const banco = vi.hoisted(() => new Map<string, unknown>());
vi.mock("idb-keyval", () => ({
    get: vi.fn(async (chave: string) => banco.get(chave)),
    set: vi.fn(async (chave: string, valor: unknown) => void banco.set(chave, valor)),
    del: vi.fn(async (chave: string) => void banco.delete(chave)),
}));

const memoria: MemoriaDoEvento = {
    token: "tok123",
    qtd_fotos: 7,
    validade_ate: null,
    selfie: new Blob(["selfie"], { type: "image/jpeg" }),
    criado_em: "2026-09-29T10:00:00.000Z",
};

describe("memória do aparelho", () => {
    beforeEach(() => {
        banco.clear();
        vi.mocked(get).mockClear();
    });

    test("guarda e lê pela entrada do evento", async () => {
        await guardarMemoria("/e/corrida-demo", memoria);
        const lida = await memoriaDoEvento("/e/corrida-demo");
        expect(lida?.token).toBe("tok123");
        expect(lida?.qtd_fotos).toBe(7);
    });

    test("memória vencida some e é apagada", async () => {
        await guardarMemoria("/e/corrida-demo", { ...memoria, validade_ate: "2020-01-01T00:00:00.000Z" });
        expect(await memoriaDoEvento("/e/corrida-demo")).toBeNull();
        expect(banco.has("memoria:/e/corrida-demo")).toBe(false);
    });

    test("atualizar mescla sem apagar a selfie", async () => {
        await guardarMemoria("/e/corrida-demo", memoria);
        await atualizarMemoria("/e/corrida-demo", { validade_ate: "2099-01-01T00:00:00.000Z", qtd_fotos: 9 });
        const lida = await memoriaDoEvento("/e/corrida-demo");
        expect(lida?.qtd_fotos).toBe(9);
        expect(lida?.selfie).not.toBeNull();
    });

    test("atualizar sem memória existente não cria uma pela metade", async () => {
        await atualizarMemoria("/e/corrida-demo", { validade_ate: "2099-01-01T00:00:00.000Z" });
        expect(banco.has("memoria:/e/corrida-demo")).toBe(false);
    });

    test("limpar apaga", async () => {
        await guardarMemoria("/e/corrida-demo", memoria);
        await limparMemoria("/e/corrida-demo");
        expect(await memoriaDoEvento("/e/corrida-demo")).toBeNull();
    });

    // Aba anônima do Safari: o IndexedDB lança. O app segue como se não houvesse memória.
    test("armazenamento indisponível devolve null sem lançar", async () => {
        vi.mocked(get).mockRejectedValueOnce(new DOMException("bloqueado"));
        await expect(memoriaDoEvento("/e/corrida-demo")).resolves.toBeNull();
    });

    // Armazenamento cheio ou bloqueado: escrever não pode derrubar o fluxo de busca.
    test("guardar com escrita recusada não lança", async () => {
        vi.mocked(set).mockRejectedValueOnce(new DOMException("cheio"));
        await expect(guardarMemoria("/e/corrida-demo", memoria)).resolves.toBeUndefined();
    });

    test("atualizar com escrita recusada não lança", async () => {
        await guardarMemoria("/e/corrida-demo", memoria);
        vi.mocked(set).mockRejectedValueOnce(new DOMException("cheio"));
        await expect(
            atualizarMemoria("/e/corrida-demo", { validade_ate: "2099-01-01T00:00:00.000Z" }),
        ).resolves.toBeUndefined();
    });

    test("limpar com exclusão recusada não lança", async () => {
        await guardarMemoria("/e/corrida-demo", memoria);
        vi.mocked(del).mockRejectedValueOnce(new DOMException("bloqueado"));
        await expect(limparMemoria("/e/corrida-demo")).resolves.toBeUndefined();
    });
});
