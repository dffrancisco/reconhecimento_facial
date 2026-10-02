import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import FotoAberta from "./FotoAberta.vue";

const voltou = () => new Promise((pronto) => window.addEventListener("popstate", pronto, { once: true }));

const fotos = [1, 2, 3].map((id) => ({
    id_foto: id,
    thumb: `/arquivos/7/${id}_thumb.jpg?md5=x&expires=1`,
    web: `/arquivos/7/${id}_web.jpg?md5=x&expires=1`,
}));

type Props = {
    fotos: typeof fotos;
    inicio: number;
    podeCompartilhar: boolean;
    prontaParaCompartilhar?: number | null;
    temMais?: boolean;
};

// Desmontar a lista volta uma entrada no histórico, e esse popstate chega depois: cada
// teste espera o seu terminar, senão ele cai no meio do teste seguinte.
const montadas: VueWrapper[] = [];
function abrir(props: Partial<Props> = {}) {
    const tela = mount(FotoAberta, { props: { fotos, inicio: 0, podeCompartilhar: false, ...props } });
    montadas.push(tela);
    return tela;
}

// O jsdom não implementa scrollIntoView: o espião registra em qual foto a lista parou.
let rolouAte: Element[] = [];
beforeEach(() => {
    rolouAte = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
        rolouAte.push(this);
    });
});

afterEach(async () => {
    for (const tela of montadas.splice(0)) {
        const pendente = window.history.state?.fotoAberta ? voltou() : null;
        tela.unmount();
        await pendente;
    }
});

describe("FotoAberta", () => {
    test("mostra as fotos uma embaixo da outra, na versão grande", () => {
        const tela = abrir();

        const itens = tela.findAll("[data-foto]");
        expect(itens).toHaveLength(3);
        expect(itens[1].find(`img[src='${fotos[1].web}']`).exists()).toBe(true);
    });

    test("abre já na foto que a pessoa tocou na grade", async () => {
        abrir({ inicio: 2 });
        await flushPromises();

        expect(rolouAte).toHaveLength(1);
        expect((rolouAte[0] as HTMLElement).dataset.foto).toBe("2");
    });

    test("cada foto tem o seu baixar", async () => {
        const tela = abrir();

        await tela.get("[aria-label='Baixar a foto 2']").trigger("click");

        expect(tela.emitted("baixar")).toEqual([[1]]);
    });

    test("sem suporte a mandar arquivo, não há botão de compartilhar", () => {
        // No computador o navigator.share não aceita anexo: o botão ficaria lá dando erro.
        const tela = abrir({ podeCompartilhar: false });
        expect(tela.find("[aria-label^='Compartilhar']").exists()).toBe(false);
    });

    test("com suporte, compartilhar avisa qual foto", async () => {
        const tela = abrir({ podeCompartilhar: true });

        await tela.get("[aria-label='Compartilhar a foto 3']").trigger("click");

        expect(tela.emitted("compartilhar")).toEqual([[2]]);
    });

    test("aguardando o segundo toque do iPhone, só a foto certa avisa", () => {
        const tela = abrir({ podeCompartilhar: true, prontaParaCompartilhar: 1 });

        const avisos = tela.findAll("[data-foto]").filter((item) => item.text().includes("Toque de novo"));
        expect(avisos).toHaveLength(1);
        expect(avisos[0].attributes("data-foto")).toBe("1");
    });

    test("com mais fotos no evento, o fim da lista oferece Ver mais", async () => {
        const tela = abrir({ temMais: true });

        await tela.get("[data-ver-mais]").trigger("click");

        expect(tela.emitted("carregarMais")).toHaveLength(1);
    });

    test("sem mais fotos, a lista termina sem botão", () => {
        expect(abrir({ temMais: false }).find("[data-ver-mais]").exists()).toBe(false);
    });

    test("voltar fecha e desfaz a entrada que a lista pôs no histórico", async () => {
        const tela = abrir();
        const esperando = voltou();

        await tela.get("[aria-label='Voltar']").trigger("click");
        await esperando;
        await flushPromises();

        expect(tela.emitted("fechar")).toBeTruthy();
        expect(window.history.state?.fotoAberta).toBeFalsy();
    });

    test("o voltar do celular fecha a lista em vez de sair da tela", async () => {
        // No Android o gesto de voltar é o jeito natural de sair da tela cheia: sem uma
        // entrada própria no histórico, ele sairia do resultado e levaria de volta à câmera.
        const tela = abrir();
        expect(window.history.state?.fotoAberta).toBe(true);
        const esperando = voltou();

        window.history.back();
        await esperando;
        await flushPromises();

        expect(tela.emitted("fechar")).toBeTruthy();
    });
});
