import { describe, expect, test } from "vitest";
import { urlDeArquivo } from "./arquivos";

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
