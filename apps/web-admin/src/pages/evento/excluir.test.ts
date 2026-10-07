import { beforeEach, describe, expect, test, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import PaginaEvento from "./index.vue";
import { excluirEvento, listarFotografos, listarVinculos, obterEstacao, obterEvento } from "./services/evento.service";
import { ErroDaApi } from "../../ts/erros";
import { entrarComo } from "../../ts/sessao";
import type { Evento } from "./interfaces";

vi.mock("./services/evento.service", () => ({
    obterEvento: vi.fn(),
    editarEvento: vi.fn(),
    subirMarcaDagua: vi.fn(),
    listarVinculos: vi.fn(),
    listarFotografos: vi.fn(),
    criarFotografo: vi.fn(),
    vincularFotografo: vi.fn(),
    desvincularFotografo: vi.fn(),
    obterEstacao: vi.fn(),
    excluirEvento: vi.fn(),
}));

const evento: Evento = {
    id_evento: 7,
    nome: "Corrida da Serra",
    slug: "corrida-da-serra",
    tipo: "esportivo",
    privado: "N",
    chave_acesso: null,
    chave_anfitriao: "anf123",
    data_inicio: "2026-09-27",
    data_fim: "2026-09-27",
    ativo: "S",
    config: { limiar: 0.42, exigir_whatsapp: false, marca_dagua: false, organizador: "X", dias_expurgo: 90, validade_resultado_dias: null, max_selfies: 3 },
    links: null,
    qtd_fotos: 29,
};

async function abrir(): Promise<{ tela: VueWrapper; router: Router }> {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: "/eventos/:id", component: PaginaEvento },
            { path: "/", component: { template: "<p>lista</p>" } },
            { path: "/entrar", name: "entrar", component: { template: "<p>entrar</p>" } },
        ],
    });
    await router.push("/eventos/7");
    const tela = mount(PaginaEvento, { global: { plugins: [router] } });
    await flushPromises();
    return { tela, router };
}

async function abrirJanela(tela: VueWrapper) {
    await tela.get("[data-acao='excluir-evento']").trigger("click");
}

const confirmar = (tela: VueWrapper) => tela.get("[data-acao='confirmar-exclusao']");

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    entrarComo({ token: "tok", nome: "Ana", id_operador: 1 });
    vi.mocked(obterEvento).mockResolvedValue(evento);
    vi.mocked(listarVinculos).mockResolvedValue([]);
    vi.mocked(listarFotografos).mockResolvedValue([]);
    vi.mocked(obterEstacao).mockResolvedValue(null);
});

describe("página do evento — excluir", () => {
    test("o bloco de excluir é o último da página", async () => {
        const { tela } = await abrir();

        const blocos = tela.findAll("[data-bloco]");
        expect(blocos.at(-1)?.attributes("data-bloco")).toBe("excluir");
        expect(blocos.at(-1)?.text()).toContain("Não dá para desfazer.");
    });

    test("a janela diz que não tem volta, quantas fotos somem e pede o nome do evento", async () => {
        const { tela } = await abrir();

        await abrirJanela(tela);

        const janela = tela.get(".modal").text();
        expect(janela).toContain("Excluir Corrida da Serra para sempre?");
        expect(janela).toContain("as 29 fotos do site e os originais dos fotógrafos");
        expect(janela).toContain("Não dá para desfazer.");
        expect(janela).toContain("digite o nome do evento: Corrida da Serra");
    });

    test("sem fotos, a janela não fala em número", async () => {
        vi.mocked(obterEvento).mockResolvedValue({ ...evento, qtd_fotos: 0 });
        const { tela } = await abrir();

        await abrirJanela(tela);

        expect(tela.get(".modal").text()).toContain("as fotos do site e os originais dos fotógrafos");
        expect(tela.get(".modal").text()).not.toContain("0 fotos");
    });

    test("o botão só libera com o nome exato: espaços nas pontas não contam, maiúsculas contam", async () => {
        const { tela } = await abrir();
        await abrirJanela(tela);
        const campo = tela.get(".modal input[name=confirmacao]");

        expect(confirmar(tela).attributes("disabled")).toBeDefined();
        await campo.setValue("corrida da serra");
        expect(confirmar(tela).attributes("disabled")).toBeDefined();
        await campo.setValue("  Corrida da Serra ");
        expect(confirmar(tela).attributes("disabled")).toBeUndefined();
    });

    test("confirmar exclui e volta para a lista avisando", async () => {
        vi.mocked(excluirEvento).mockResolvedValue({ ok: true });
        const { tela, router } = await abrir();
        await abrirJanela(tela);

        await tela.get(".modal input[name=confirmacao]").setValue("Corrida da Serra");
        await confirmar(tela).trigger("click");
        await flushPromises();

        expect(excluirEvento).toHaveBeenCalledWith(7, "Corrida da Serra");
        expect(router.currentRoute.value.path).toBe("/");
        expect(router.currentRoute.value.query.excluido).toBe("1");
    });

    test("o erro da API aparece na janela, sem apagar o que foi digitado", async () => {
        vi.mocked(excluirEvento).mockRejectedValue(new ErroDaApi("O nome digitado não confere com o do evento.", undefined, 422));
        const { tela, router } = await abrir();
        await abrirJanela(tela);

        await tela.get(".modal input[name=confirmacao]").setValue("Corrida da Serra");
        await confirmar(tela).trigger("click");
        await flushPromises();

        expect(tela.get(".modal").text()).toContain("O nome digitado não confere com o do evento.");
        expect((tela.get(".modal input[name=confirmacao]").element as HTMLInputElement).value).toBe("Corrida da Serra");
        expect(router.currentRoute.value.path).toBe("/eventos/7");
    });

    test("cancelar fecha sem chamar a API", async () => {
        const { tela } = await abrir();
        await abrirJanela(tela);

        await tela.get(".modal [data-acao='cancelar-exclusao']").trigger("click");

        expect(tela.find(".modal").exists()).toBe(false);
        expect(excluirEvento).not.toHaveBeenCalled();
    });
});
