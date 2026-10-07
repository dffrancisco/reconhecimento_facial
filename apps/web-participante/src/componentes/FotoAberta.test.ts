import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { nextTick } from "vue";
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
    total?: number;
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

describe("FotoAberta no computador", () => {
    beforeEach(() => vi.stubGlobal("matchMedia", (consulta: string) => ({ matches: true, media: consulta })));
    afterEach(() => vi.unstubAllGlobals());

    const naTela = (tela: VueWrapper) => tela.get("[data-foto]").attributes("data-foto");
    const teclar = async (tecla: string) => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: tecla }));
        await nextTick();
    };

    test("mostra uma foto por vez, já a que foi clicada na grade", () => {
        const tela = abrir({ inicio: 1 });

        expect(tela.findAll("[data-foto]")).toHaveLength(1);
        expect(naTela(tela)).toBe("1");
        expect(tela.find(`img[src='${fotos[1].web}']`).exists()).toBe(true);
    });

    test("a miniatura aparece na hora, enquanto a versão grande carrega", () => {
        const tela = abrir({ inicio: 1 });
        expect(tela.find(`img[src='${fotos[1].thumb}']`).exists()).toBe(true);
    });

    test("a seta da direita passa para a próxima foto", async () => {
        const tela = abrir({ inicio: 0 });

        await tela.get("[aria-label='Próxima foto']").trigger("click");

        expect(naTela(tela)).toBe("1");
    });

    test("a seta da esquerda volta para a anterior", async () => {
        const tela = abrir({ inicio: 2 });

        await tela.get("[aria-label='Foto anterior']").trigger("click");

        expect(naTela(tela)).toBe("1");
    });

    test("as setas do teclado também passam as fotos", async () => {
        const tela = abrir({ inicio: 1 });

        await teclar("ArrowRight");
        expect(naTela(tela)).toBe("2");

        await teclar("ArrowLeft");
        await teclar("ArrowLeft");
        expect(naTela(tela)).toBe("0");
    });

    test("na primeira foto não há seta para trás, e na última não há para frente", () => {
        expect(abrir({ inicio: 0 }).find("[aria-label='Foto anterior']").exists()).toBe(false);
        expect(abrir({ inicio: 2 }).find("[aria-label='Próxima foto']").exists()).toBe(false);
    });

    test("mostra em qual foto está, contando o total do evento quando ele vem", () => {
        expect(abrir({ inicio: 1 }).text()).toContain("2 de 3");
        expect(abrir({ inicio: 1, total: 120, temMais: true }).text()).toContain("2 de 120");
    });

    test("baixar leva a foto que está na tela", async () => {
        const tela = abrir({ inicio: 0 });
        await tela.get("[aria-label='Próxima foto']").trigger("click");

        await tela.get("[aria-label='Baixar a foto 2']").trigger("click");

        expect(tela.emitted("baixar")).toEqual([[1]]);
    });

    test("compartilhar, quando o navegador deixa, manda a foto da tela", async () => {
        const tela = abrir({ inicio: 2, podeCompartilhar: true });

        await tela.get("[aria-label='Compartilhar a foto 3']").trigger("click");

        expect(tela.emitted("compartilhar")).toEqual([[2]]);
    });

    test("na última foto carregada, a seta pede mais e segue para a nova", async () => {
        const tela = abrir({ inicio: 2, temMais: true });

        await tela.get("[aria-label='Próxima foto']").trigger("click");
        expect(tela.emitted("carregarMais")).toHaveLength(1);

        await tela.setProps({ fotos: [...fotos, { id_foto: 4, thumb: "/arquivos/7/4_thumb.jpg", web: "/arquivos/7/4_web.jpg" }] });
        expect(naTela(tela)).toBe("3");
    });

    test("Esc fecha e desfaz a entrada no histórico", async () => {
        const tela = abrir();
        const esperando = voltou();

        await teclar("Escape");
        await esperando;
        await flushPromises();

        expect(tela.emitted("fechar")).toBeTruthy();
        expect(window.history.state?.fotoAberta).toBeFalsy();
    });

    test("a seta de voltar do canto fecha", async () => {
        const tela = abrir();
        const esperando = voltou();

        await tela.get("[aria-label='Voltar']").trigger("click");
        await esperando;
        await flushPromises();

        expect(tela.emitted("fechar")).toBeTruthy();
    });
});
