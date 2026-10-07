import { beforeEach, describe, expect, test, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import NovoEvento from "./index.vue";
import { criarEvento } from "./services/novo-evento.service";
import { ErroDaApi } from "../../ts/erros";
import { hoje } from "../../ts/datas";
import { entrarComo } from "../../ts/sessao";

vi.mock("./services/novo-evento.service", () => ({ criarEvento: vi.fn() }));

async function abrir() {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: "/eventos/novo", component: NovoEvento },
            { path: "/", component: { template: "<p>lista</p>" } },
            { path: "/entrar", name: "entrar", component: { template: "<p>entrar</p>" } },
            { path: "/eventos/:id", component: { template: "<p>evento</p>" } },
        ],
    });
    await router.push("/eventos/novo");
    const tela = mount(NovoEvento, { global: { plugins: [router] } });
    await flushPromises();
    return { tela, router };
}

const valor = (tela: VueWrapper, seletor: string) => (tela.get(seletor).element as HTMLInputElement).value;
const marcado = (tela: VueWrapper, seletor: string) => (tela.get(seletor).element as HTMLInputElement).checked;

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    entrarComo({ token: "tok", nome: "Ana", id_operador: 1 });
});

describe("novo evento", () => {
    test("começa com hoje nas duas datas, esportivo, público e sem exigir WhatsApp, com o aviso", async () => {
        const { tela } = await abrir();

        expect(valor(tela, "input[name=data_inicio]")).toBe(hoje());
        expect(valor(tela, "input[name=data_fim]")).toBe(hoje());
        expect(marcado(tela, "input[name=tipo][value=esportivo]")).toBe(true);
        expect(marcado(tela, "input[name=acesso][value=publico]")).toBe(true);
        expect(marcado(tela, "input[name=exigir_whatsapp]")).toBe(false);
        expect(tela.text()).toContain("A verificação por WhatsApp ainda não existe: ligado, o participante não vê as fotos.");
    });

    test("o endereço acompanha o nome até o operador mexer nele", async () => {
        const { tela } = await abrir();

        await tela.get("input[name=nome]").setValue("Corrida da Serra 2026");
        expect(valor(tela, "input[name=endereco]")).toBe("corrida-da-serra-2026");

        await tela.get("input[name=endereco]").setValue("serra-26");
        await tela.get("input[name=nome]").setValue("Corrida da Serra");
        expect(valor(tela, "input[name=endereco]")).toBe("serra-26");
    });

    test("endereço digitado à mão vira endereço válido ao sair do campo", async () => {
        const { tela } = await abrir();

        const campo = tela.get("input[name=endereco]");
        await campo.setValue("Corrida X!");
        await campo.trigger("change");

        expect(valor(tela, "input[name=endereco]")).toBe("corrida-x");
    });

    test("o acesso acompanha o tipo até o operador mexer nele", async () => {
        const { tela } = await abrir();

        await tela.get("input[name=tipo][value=social]").setValue();
        expect(marcado(tela, "input[name=acesso][value=privado]")).toBe(true);

        await tela.get("input[name=acesso][value=publico]").setValue();
        await tela.get("input[name=tipo][value=esportivo]").setValue();
        await tela.get("input[name=tipo][value=social]").setValue();
        expect(marcado(tela, "input[name=acesso][value=publico]")).toBe(true);
    });

    test("criar manda os campos e a config e abre a página do evento", async () => {
        vi.mocked(criarEvento).mockResolvedValue({ id_evento: 42 });
        const { tela, router } = await abrir();

        await tela.get("input[name=nome]").setValue("Corrida da Serra");
        await tela.get("input[name=data_inicio]").setValue("2026-10-10");
        await tela.get("input[name=data_fim]").setValue("2026-10-11");
        await tela.get("form").trigger("submit");
        await flushPromises();

        expect(criarEvento).toHaveBeenCalledWith({
            nome: "Corrida da Serra",
            slug: "corrida-da-serra",
            tipo: "esportivo",
            data_inicio: "2026-10-10",
            data_fim: "2026-10-11",
            privado: false,
            config: { exigir_whatsapp: false },
        });
        expect(router.currentRoute.value.path).toBe("/eventos/42");
    });

    test("dois cliques seguidos em Criar mandam um pedido só", async () => {
        let responder!: (v: { id_evento: number }) => void;
        vi.mocked(criarEvento).mockReturnValue(new Promise((r) => (responder = r)));
        const { tela } = await abrir();
        await tela.get("input[name=nome]").setValue("Corrida");

        await tela.get("form").trigger("submit");
        await tela.get("form").trigger("submit");
        responder({ id_evento: 1 });
        await flushPromises();

        expect(criarEvento).toHaveBeenCalledTimes(1);
    });

    test("endereço repetido: mostra a mensagem e mantém o que foi preenchido", async () => {
        vi.mocked(criarEvento).mockRejectedValue(new ErroDaApi("Esse endereço já é de outro evento.", "endereco_repetido", 422));
        const { tela, router } = await abrir();

        await tela.get("input[name=nome]").setValue("Corrida da Serra");
        await tela.get("form").trigger("submit");
        await flushPromises();

        expect(tela.text()).toContain("Esse endereço já é de outro evento.");
        expect(valor(tela, "input[name=nome]")).toBe("Corrida da Serra");
        expect(router.currentRoute.value.path).toBe("/eventos/novo");
    });

    test("fim antes do início não chega à API", async () => {
        const { tela } = await abrir();

        await tela.get("input[name=nome]").setValue("Corrida");
        await tela.get("input[name=data_inicio]").setValue("2026-10-11");
        await tela.get("input[name=data_fim]").setValue("2026-10-10");
        await tela.get("form").trigger("submit");
        await flushPromises();

        expect(criarEvento).not.toHaveBeenCalled();
        expect(tela.text()).toContain("O fim do evento não pode ser antes do início.");
    });
});
