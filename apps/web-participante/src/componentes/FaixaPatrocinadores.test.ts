import { describe, expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import FaixaPatrocinadores from "./FaixaPatrocinadores.vue";

describe("FaixaPatrocinadores", () => {
    test("com lista vazia não renderiza nada", () => {
        // A API de patrocinadores é da parte 2: até lá a lista vem vazia e a faixa
        // não pode ocupar espaço nem desenhar uma barra branca solta na tela.
        const tela = mount(FaixaPatrocinadores, { props: { patrocinadores: [] } });
        expect(tela.html()).toBe("<!--v-if-->");
    });

    test("mostra o logo de cada patrocinador", () => {
        const tela = mount(FaixaPatrocinadores, {
            props: { patrocinadores: [{ nome: "Loja X", logo: "/patrocinadores/1.png" }] },
        });
        expect(tela.find("img").attributes("src")).toBe("/patrocinadores/1.png");
        expect(tela.find("img").attributes("alt")).toBe("Loja X");
    });

    test("com site, o logo vira link que abre fora", () => {
        const tela = mount(FaixaPatrocinadores, {
            props: { patrocinadores: [{ nome: "Loja X", logo: "/p/1.png", site: "https://loja.com.br" }] },
        });
        const link = tela.find("a");
        expect(link.attributes("href")).toBe("https://loja.com.br");
        expect(link.attributes("rel")).toContain("noopener");
    });
});
