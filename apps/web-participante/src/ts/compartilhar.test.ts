import { afterEach, describe, expect, test, vi } from "vitest";
import { compartilharFoto, podeCompartilharArquivos } from "./compartilhar";

afterEach(() => vi.unstubAllGlobals());

describe("podeCompartilharArquivos", () => {
    test("só quando o navegador aceita arquivo, não só link", () => {
        // O navigator.share do computador existe, mas recusa anexo: o clique daria erro.
        vi.stubGlobal("navigator", { share: vi.fn(), canShare: () => false });
        expect(podeCompartilharArquivos()).toBe(false);

        vi.stubGlobal("navigator", { share: vi.fn(), canShare: () => true });
        expect(podeCompartilharArquivos()).toBe(true);

        vi.stubGlobal("navigator", {});
        expect(podeCompartilharArquivos()).toBe(false);
    });
});

describe("compartilharFoto", () => {
    const url = "/arquivos/7/a_web.jpg?md5=x&expires=1&dl=1";

    test("baixa a foto e abre o menu do sistema", async () => {
        const share = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal("navigator", { share, canShare: () => true });
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["foto"]) }));

        const resultado = await compartilharFoto({ url, nomeArquivo: "foto-1.jpg", titulo: "Corrida da Serra" });

        expect(resultado.situacao).toBe("ok");
        expect(share).toHaveBeenCalledWith(expect.objectContaining({ title: "Corrida da Serra" }));
    });

    // No iPhone o menu só abre colado no toque, e o download pode passar desse tempo:
    // o arquivo volta pronto para o segundo toque abrir o menu na hora, sem baixar de novo.
    test("recusa por falta de toque devolve o arquivo para o segundo toque", async () => {
        const share = vi.fn().mockRejectedValue(new DOMException("gesto", "NotAllowedError"));
        vi.stubGlobal("navigator", { share, canShare: () => true });
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["foto"]) });
        vi.stubGlobal("fetch", fetchMock);

        const primeira = await compartilharFoto({ url, nomeArquivo: "foto-1.jpg", titulo: "Corrida" });
        expect(primeira.situacao).toBe("toqueDeNovo");
        if (primeira.situacao !== "toqueDeNovo") return;

        share.mockResolvedValueOnce(undefined);
        const segunda = await compartilharFoto({ url, nomeArquivo: "foto-1.jpg", titulo: "Corrida", arquivoPronto: primeira.arquivo });
        expect(segunda.situacao).toBe("ok");
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test("cancelar não é erro", async () => {
        vi.stubGlobal("navigator", { share: vi.fn().mockRejectedValue(new DOMException("cancelou", "AbortError")), canShare: () => true });
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["foto"]) }));

        const resultado = await compartilharFoto({ url, nomeArquivo: "foto-1.jpg", titulo: "Corrida" });
        expect(resultado.situacao).toBe("cancelado");
    });

    test("foto que não baixa lança para o chamador decidir o fallback", async () => {
        vi.stubGlobal("navigator", { share: vi.fn(), canShare: () => true });
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 410 }));

        await expect(compartilharFoto({ url, nomeArquivo: "foto-1.jpg", titulo: "Corrida" })).rejects.toThrow("410");
    });
});
