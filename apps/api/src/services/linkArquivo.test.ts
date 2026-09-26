import { test, describe } from "node:test";
import assert from "node:assert";
import { createHash } from "node:crypto";
import { assinarUrlArquivo } from "./linkArquivo";

// Reproduz o que o nginx faz, para o teste falhar se o formato sair do combinado.
function comoONginxCalcula(uri: string, expira: number, segredo: string): string {
    return createHash("md5")
        .update(`${expira}${uri} ${segredo}`)
        .digest("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
}

describe("assinarUrlArquivo", () => {
    test("monta a URL com md5 e expires", () => {
        const url = assinarUrlArquivo("/arquivos/7/abc_web.jpg", 1800000000, "segredo-de-teste");
        const esperado = comoONginxCalcula("/arquivos/7/abc_web.jpg", 1800000000, "segredo-de-teste");

        assert.strictEqual(url, `/arquivos/7/abc_web.jpg?md5=${esperado}&expires=1800000000`);
    });

    test("a assinatura é url-safe: sem +, / ou =", () => {
        // Varre várias entradas porque só algumas produzem os caracteres problemáticos.
        for (let i = 0; i < 200; i++) {
            const url = assinarUrlArquivo(`/arquivos/${i}/foto_web.jpg`, 1800000000 + i, "s");
            const md5 = new URLSearchParams(url.split("?")[1]).get("md5") as string;
            assert.ok(!/[+/=]/.test(md5), `assinatura não url-safe: ${md5}`);
        }
    });

    test("mudar qualquer parte muda a assinatura", () => {
        const base = assinarUrlArquivo("/arquivos/7/abc_web.jpg", 1800000000, "segredo");
        assert.notStrictEqual(base, assinarUrlArquivo("/arquivos/7/abc_thumb.jpg", 1800000000, "segredo"));
        assert.notStrictEqual(base, assinarUrlArquivo("/arquivos/7/abc_web.jpg", 1800000001, "segredo"));
        assert.notStrictEqual(base, assinarUrlArquivo("/arquivos/7/abc_web.jpg", 1800000000, "outro"));
    });
});
