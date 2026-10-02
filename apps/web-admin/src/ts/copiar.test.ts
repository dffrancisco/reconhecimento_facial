import { afterEach, describe, expect, test, vi } from "vitest";
import { copiarTexto } from "./copiar";

function comAreaDeTransferencia(writeText: ((t: string) => Promise<void>) | undefined) {
    Object.defineProperty(navigator, "clipboard", { value: writeText ? { writeText } : undefined, configurable: true });
}

afterEach(() => {
    comAreaDeTransferencia(undefined);
    vi.restoreAllMocks();
});

describe("copiarTexto", () => {
    test("com HTTPS usa a área de transferência do navegador", async () => {
        const escrever = vi.fn().mockResolvedValue(undefined);
        comAreaDeTransferencia(escrever);

        expect(await copiarTexto("http://x/#/a/1")).toBe(true);
        expect(escrever).toHaveBeenCalledWith("http://x/#/a/1");
    });

    test("sem HTTPS (navigator.clipboard nem existe) copia pela caixa de texto escondida", async () => {
        // É o caso da estação aberta pelo IP da rede: http://192.168.x.x não é contexto seguro.
        comAreaDeTransferencia(undefined);
        let copiado = "";
        document.execCommand = vi.fn(() => {
            copiado = (document.activeElement as HTMLTextAreaElement).value;
            return true;
        });

        expect(await copiarTexto("http://192.168.0.10/#/?t=abc")).toBe(true);
        expect(document.execCommand).toHaveBeenCalledWith("copy");
        expect(copiado).toBe("http://192.168.0.10/#/?t=abc");
        expect(document.querySelector("textarea")).toBeNull();
    });

    test("área de transferência recusada cai na caixa de texto", async () => {
        comAreaDeTransferencia(vi.fn().mockRejectedValue(new Error("negado")));
        document.execCommand = vi.fn(() => true);

        expect(await copiarTexto("x")).toBe(true);
    });

    test("quando nenhum dos dois copia, avisa com false", async () => {
        comAreaDeTransferencia(undefined);
        document.execCommand = vi.fn(() => false);

        expect(await copiarTexto("x")).toBe(false);
    });
});
