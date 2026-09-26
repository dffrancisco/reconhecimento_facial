import { describe, expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import FotoAberta from "./FotoAberta.vue";

const foto = { id_foto: 1, thumb: "/arquivos/7/a_thumb.jpg?md5=x&expires=1", similaridade: 0.9 };

function toque(x: number, y = 300) {
    return { changedTouches: [{ clientX: x, clientY: y }] };
}

describe("FotoAberta", () => {
    test("mostra a foto em tela cheia", () => {
        const tela = mount(FotoAberta, { props: { foto, podeCompartilhar: true } });
        expect(tela.find("img").attributes("src")).toBe(foto.thumb);
    });

    test("com suporte a compartilhar, mostra os dois botões", () => {
        const tela = mount(FotoAberta, { props: { foto, podeCompartilhar: true } });
        expect(tela.text()).toContain("Salvar");
        expect(tela.text()).toContain("Compartilhar");
    });

    test("sem suporte a compartilhar, sobra só Salvar", () => {
        // No computador o navigator.share não existe: o botão não pode ficar lá dando erro.
        const tela = mount(FotoAberta, { props: { foto, podeCompartilhar: false } });
        expect(tela.text()).toContain("Salvar");
        expect(tela.text()).not.toContain("Compartilhar");
    });

    test("fechar emite o evento", async () => {
        const tela = mount(FotoAberta, { props: { foto, podeCompartilhar: false } });
        await tela.find("[aria-label='Fechar']").trigger("click");
        expect(tela.emitted("fechar")).toBeTruthy();
    });

    test("deslizar para a esquerda pede a próxima foto", async () => {
        const tela = mount(FotoAberta, { props: { foto, podeCompartilhar: false } });
        const area = tela.find("[data-deslize]");

        await area.trigger("touchstart", toque(300));
        await area.trigger("touchend", toque(120));

        expect(tela.emitted("proxima")).toBeTruthy();
        expect(tela.emitted("anterior")).toBeFalsy();
    });

    test("deslizar para a direita pede a anterior; um toque parado não troca", async () => {
        const tela = mount(FotoAberta, { props: { foto, podeCompartilhar: false } });
        const area = tela.find("[data-deslize]");

        await area.trigger("touchstart", toque(120));
        await area.trigger("touchend", toque(300));
        await area.trigger("touchstart", toque(200));
        await area.trigger("touchend", toque(205));

        expect(tela.emitted("anterior")).toHaveLength(1);
        expect(tela.emitted("proxima")).toBeFalsy();
    });
});
