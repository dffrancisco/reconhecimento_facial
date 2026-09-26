import { describe, expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import GradeFotos from "./GradeFotos.vue";

const fotos = [
    { id_foto: 1, thumb: "/arquivos/7/a_thumb.jpg?md5=x&expires=1", similaridade: 0.9712 },
    { id_foto: 2, thumb: "/arquivos/7/b_thumb.jpg?md5=y&expires=1", similaridade: 0.8 },
    { id_foto: 3, thumb: "/arquivos/7/c_thumb.jpg?md5=z&expires=1", similaridade: 0.7 },
];

describe("GradeFotos", () => {
    test("mostra uma imagem por foto, com o thumb assinado", () => {
        const tela = mount(GradeFotos, { props: { fotos } });
        const imagens = tela.findAll("img");

        expect(imagens).toHaveLength(3);
        expect(imagens[0].attributes("src")).toBe(fotos[0].thumb);
    });

    test("o selo de semelhança aparece só na primeira foto", () => {
        const tela = mount(GradeFotos, { props: { fotos, mostrarSelo: true } });
        expect(tela.text()).toContain("97%");
        expect(tela.text()).not.toContain("80%");
    });

    test("sem mostrarSelo, nenhuma porcentagem aparece", () => {
        const tela = mount(GradeFotos, { props: { fotos } });
        expect(tela.text()).not.toContain("97%");
    });

    test("clicar numa foto emite o índice dela", async () => {
        const tela = mount(GradeFotos, { props: { fotos } });
        await tela.findAll("button")[1].trigger("click");

        expect(tela.emitted("abrir")?.[0]).toEqual([1]);
    });

    test("lista vazia não quebra e não mostra imagem", () => {
        const tela = mount(GradeFotos, { props: { fotos: [] } });
        expect(tela.findAll("img")).toHaveLength(0);
    });

    test("as fotos têm texto alternativo, para leitor de tela", () => {
        const tela = mount(GradeFotos, { props: { fotos } });
        expect(tela.find("img").attributes("alt")).toBeTruthy();
    });
});
