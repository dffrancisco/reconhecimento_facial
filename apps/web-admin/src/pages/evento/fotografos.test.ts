import { beforeEach, describe, expect, test, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import PaginaEvento from "./index.vue";
import {
    criarFotografo,
    desvincularFotografo,
    listarFotografos,
    listarVinculos,
    obterEvento,
    vincularFotografo,
} from "./services/evento.service";
import { ErroDaApi } from "../../ts/erros";
import { entrarComo } from "../../ts/sessao";
import type { Evento, Fotografo, Vinculo } from "./interfaces";

vi.mock("./services/evento.service", () => ({
    obterEvento: vi.fn(),
    editarEvento: vi.fn(),
    subirMarcaDagua: vi.fn(),
    listarVinculos: vi.fn(),
    listarFotografos: vi.fn(),
    criarFotografo: vi.fn(),
    vincularFotografo: vi.fn(),
    desvincularFotografo: vi.fn(),
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
    qtd_fotos: 0,
};
const ana: Fotografo = { id_fotografo: 1, nome: "Ana Souza", telefone: "+5511911112222" };
const bruno: Fotografo = { id_fotografo: 2, nome: "Bruno Lima", telefone: null };
const vinculoAna: Vinculo = { id_evento_fotografo: 50, id_fotografo: 1, nome: "Ana Souza", telefone: "+5511911112222" };

async function abrir() {
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
    return tela;
}

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    entrarComo({ token: "tok", nome: "Ana", id_operador: 1 });
    vi.mocked(obterEvento).mockResolvedValue(evento);
    vi.mocked(listarVinculos).mockResolvedValue([vinculoAna]);
    vi.mocked(listarFotografos).mockResolvedValue([ana, bruno]);
});

describe("página do evento — fotógrafos", () => {
    test("lista os vinculados e avisa onde fica o link de upload", async () => {
        const tela = await abrir();

        expect(listarVinculos).toHaveBeenCalledWith(7);
        expect(tela.get("[data-bloco=fotografos]").text()).toContain("Ana Souza");
        expect(tela.text()).toContain("O link e o QR de upload de cada fotógrafo aparecem no painel da estação.");
    });

    test("a escolha só traz quem ainda não está no evento; adicionar vincula e recarrega", async () => {
        vi.mocked(vincularFotografo).mockResolvedValue({});
        const tela = await abrir();

        const opcoes = tela.findAll("select[name=fotografo] option").map((o) => o.text());
        expect(opcoes.some((t) => t.includes("Bruno Lima"))).toBe(true);
        expect(opcoes.some((t) => t.includes("Ana Souza"))).toBe(false);

        await tela.get("select[name=fotografo]").setValue("2");
        await tela.get("[data-acao=adicionar]").trigger("click");
        await flushPromises();

        expect(vincularFotografo).toHaveBeenCalledWith(7, 2);
        expect(listarVinculos).toHaveBeenCalledTimes(2);
    });

    test("cadastrar novo cria o fotógrafo e já vincula; telefone vazio vai como null", async () => {
        vi.mocked(criarFotografo).mockResolvedValue({ id_fotografo: 3, nome: "Bia", telefone: null });
        vi.mocked(vincularFotografo).mockResolvedValue({});
        const tela = await abrir();

        await tela.get("input[name=novo_nome]").setValue("Bia");
        await tela.get("[data-acao=cadastrar]").trigger("click");
        await flushPromises();

        expect(criarFotografo).toHaveBeenCalledWith("Bia", null);
        expect(vincularFotografo).toHaveBeenCalledWith(7, 3);
        expect((tela.get("input[name=novo_nome]").element as HTMLInputElement).value).toBe("");
    });

    test("cadastrar sem nome não chama a API", async () => {
        const tela = await abrir();

        await tela.get("[data-acao=cadastrar]").trigger("click");
        await flushPromises();

        expect(criarFotografo).not.toHaveBeenCalled();
        expect(tela.text()).toContain("Informe o nome do fotógrafo.");
    });

    test("remover pede confirmação; cancelar não remove, confirmar remove e recarrega", async () => {
        vi.mocked(desvincularFotografo).mockResolvedValue({ ok: true });
        const tela = await abrir();

        await tela.get("[data-acao=remover-50]").trigger("click");
        expect(tela.text()).toContain("O link de upload dele para de aceitar fotos. As fotos já enviadas continuam.");
        await tela.get("[data-acao=cancelar-remocao]").trigger("click");
        expect(desvincularFotografo).not.toHaveBeenCalled();

        await tela.get("[data-acao=remover-50]").trigger("click");
        await tela.get("[data-acao=confirmar-remocao]").trigger("click");
        await flushPromises();

        expect(desvincularFotografo).toHaveBeenCalledWith(50);
        expect(listarVinculos).toHaveBeenCalledTimes(2);
    });

    test("erro ao adicionar aparece no bloco", async () => {
        vi.mocked(vincularFotografo).mockRejectedValue(new ErroDaApi("Fotógrafo não encontrado.", undefined, 422));
        const tela = await abrir();

        await tela.get("select[name=fotografo]").setValue("2");
        await tela.get("[data-acao=adicionar]").trigger("click");
        await flushPromises();

        expect(tela.get("[data-bloco=fotografos]").text()).toContain("Fotógrafo não encontrado.");
    });
});
