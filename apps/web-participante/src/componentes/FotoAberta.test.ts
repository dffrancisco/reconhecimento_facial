import { afterEach, describe, expect, test } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import FotoAberta from "./FotoAberta.vue";

const voltou = () => new Promise((pronto) => window.addEventListener("popstate", pronto, { once: true }));

// Desmontar a foto aberta volta uma entrada no histórico, e esse popstate chega depois:
// cada teste espera o seu terminar, senão ele cai no meio do teste seguinte.
const montadas: VueWrapper[] = [];
function abrir(props: { foto: typeof foto; podeCompartilhar: boolean; prontaParaCompartilhar?: boolean }) {
    const tela = mount(FotoAberta, { props });
    montadas.push(tela);
    return tela;
}

afterEach(async () => {
    for (const tela of montadas.splice(0)) {
        const pendente = window.history.state?.fotoAberta ? voltou() : null;
        tela.unmount();
        await pendente;
    }
});

const foto = { id_foto: 1, thumb: "/arquivos/7/a_thumb.jpg?md5=x&expires=1", similaridade: 0.9 };

function toque(x: number, y = 300) {
    return { changedTouches: [{ clientX: x, clientY: y }] };
}

describe("FotoAberta", () => {
    test("mostra a foto em tela cheia", () => {
        const tela = abrir({ foto, podeCompartilhar: true });
        expect(tela.find("img").attributes("src")).toBe(foto.thumb);
    });

    test("com suporte a compartilhar há um só botão: Salvar / Compartilhar", () => {
        const tela = abrir({ foto, podeCompartilhar: true });
        const botoes = tela.findAll("button").filter((b) => b.text() !== "×");
        expect(botoes).toHaveLength(1);
        expect(botoes[0].text()).toBe("Salvar / Compartilhar");
        botoes[0].trigger("click");
        expect(tela.emitted("compartilhar")).toBeTruthy();
    });

    test("sem suporte o botão é Baixar e salva direto", () => {
        // No computador o navigator.share não existe: o botão não pode ficar lá dando erro.
        const tela = abrir({ foto, podeCompartilhar: false });
        const botoes = tela.findAll("button").filter((b) => b.text() !== "×");
        expect(botoes).toHaveLength(1);
        expect(botoes[0].text()).toBe("Baixar");
        botoes[0].trigger("click");
        expect(tela.emitted("salvar")).toBeTruthy();
    });

    test("aguardando o segundo toque do iPhone, o rótulo avisa", () => {
        const tela = abrir({ foto, podeCompartilhar: true, prontaParaCompartilhar: true });
        expect(tela.text()).toContain("Toque de novo para compartilhar");
    });

    test("fechar emite o evento e desfaz a entrada que a foto pôs no histórico", async () => {
        const tela = abrir({ foto, podeCompartilhar: false });
        const esperando = voltou();

        await tela.find("[aria-label='Fechar']").trigger("click");
        await esperando;
        await flushPromises();

        expect(tela.emitted("fechar")).toBeTruthy();
        expect(window.history.state?.fotoAberta).toBeFalsy();
    });

    test("o voltar do celular fecha a foto em vez de sair da tela", async () => {
        // No Android o gesto de voltar é o jeito natural de sair da tela cheia: sem uma
        // entrada própria no histórico, ele sairia do resultado e levaria de volta à câmera.
        const tela = abrir({ foto, podeCompartilhar: false });
        expect(window.history.state?.fotoAberta).toBe(true);
        const esperando = voltou();

        window.history.back();
        await esperando;
        await flushPromises();

        expect(tela.emitted("fechar")).toBeTruthy();
    });

    test("deslizar para a esquerda pede a próxima foto", async () => {
        const tela = abrir({ foto, podeCompartilhar: false });
        const area = tela.find("[data-deslize]");

        await area.trigger("touchstart", toque(300));
        await area.trigger("touchend", toque(120));

        expect(tela.emitted("proxima")).toBeTruthy();
        expect(tela.emitted("anterior")).toBeFalsy();
    });

    test("deslizar para a direita pede a anterior; um toque parado não troca", async () => {
        const tela = abrir({ foto, podeCompartilhar: false });
        const area = tela.find("[data-deslize]");

        await area.trigger("touchstart", toque(120));
        await area.trigger("touchend", toque(300));
        await area.trigger("touchstart", toque(200));
        await area.trigger("touchend", toque(205));

        expect(tela.emitted("anterior")).toHaveLength(1);
        expect(tela.emitted("proxima")).toBeFalsy();
    });
});
