import { describe, expect, test, vi } from "vitest";
import { baixarArquivo, urlDeArquivo } from "./arquivos";

describe("urlDeArquivo", () => {
    test("mantém o caminho assinado como veio da API", () => {
        // A assinatura cobre o caminho exato: mexer nela invalida o link no nginx.
        const assinado = "/arquivos/7/abc_thumb.jpg?md5=aBc-_123&expires=1800000000";
        expect(urlDeArquivo(assinado)).toBe(assinado);
    });

    test("não duplica barra quando a base termina em barra", () => {
        expect(urlDeArquivo("/arquivos/7/abc_web.jpg?md5=x&expires=1")).toMatch(/^\/arquivos\//);
    });
});

describe("baixarArquivo", () => {
    test("abre o link assinado sem sair da tela", () => {
        // O `dl=1` faz o nginx responder como anexo: o navegador baixa e a tela fica onde está.
        const clicar = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
        const url = "/arquivos/7/a_web.jpg?md5=x&expires=1&dl=1";

        baixarArquivo(url);

        expect(clicar).toHaveBeenCalledTimes(1);
        const link = clicar.mock.contexts[0] as HTMLAnchorElement;
        expect(link.getAttribute("href")).toBe(url);
        expect(link.isConnected).toBe(false);
        clicar.mockRestore();
    });
});
