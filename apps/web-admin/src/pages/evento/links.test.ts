import { beforeEach, describe, expect, test, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import PaginaEvento from "./index.vue";
import { obterEvento } from "./services/evento.service";
import { entrarComo } from "../../ts/sessao";
import type { Evento } from "./interfaces";

vi.mock("./services/evento.service", () => ({
    obterEvento: vi.fn(),
    editarEvento: vi.fn(),
    subirMarcaDagua: vi.fn(),
    listarVinculos: vi.fn().mockResolvedValue([]),
    listarFotografos: vi.fn().mockResolvedValue([]),
    criarFotografo: vi.fn(),
    vincularFotografo: vi.fn(),
    desvincularFotografo: vi.fn(),
}));

function eventoFalso(parcial: Partial<Evento> = {}): Evento {
    return {
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
        links: { participante: "http://localhost:8080/#/e/corrida-da-serra", anfitriao: "http://localhost:8080/#/a/anf123" },
        ...parcial,
    };
}

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
    entrarComo({ token: "tok", nome: "Ana" });
    vi.mocked(obterEvento).mockResolvedValue(eventoFalso());
});

describe("página do evento — links", () => {
    test("mostra o link do participante e o do anfitrião, cada um com QR", async () => {
        const tela = await abrir();

        expect(tela.get("[data-link=participante]").text()).toContain("http://localhost:8080/#/e/corrida-da-serra");
        expect(tela.get("[data-link=anfitriao]").text()).toContain("http://localhost:8080/#/a/anf123");
        expect(tela.findAll("[data-bloco=links] svg").length).toBe(2);
    });

    test("copiar põe o link na área de transferência; sem permissão, explica", async () => {
        const escrever = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", { value: { writeText: escrever }, configurable: true });
        const tela = await abrir();

        await tela.get("[data-acao=copiar-participante]").trigger("click");
        await flushPromises();
        expect(escrever).toHaveBeenCalledWith("http://localhost:8080/#/e/corrida-da-serra");
        expect(tela.text()).toContain("Link copiado.");

        escrever.mockRejectedValue(new Error("negado"));
        await tela.get("[data-acao=copiar-anfitriao]").trigger("click");
        await flushPromises();
        expect(tela.text()).toContain("O navegador não deixou copiar. Selecione o link e copie à mão.");
    });

    test("QR grande abre em tela cheia e fecha no clique", async () => {
        const tela = await abrir();

        await tela.get("[data-acao=qr-participante]").trigger("click");
        expect(tela.find("[data-qr-grande] svg").exists()).toBe(true);

        await tela.get("[data-qr-grande]").trigger("click");
        expect(tela.find("[data-qr-grande]").exists()).toBe(false);
    });

    test("sem ENDERECO_PARTICIPANTE no VPS, diz o que configurar", async () => {
        vi.mocked(obterEvento).mockResolvedValue(eventoFalso({ links: null }));
        const tela = await abrir();

        expect(tela.text()).toContain("Configure ENDERECO_PARTICIPANTE no VPS para ver os links.");
    });

    test("evento inativo avisa que o participante não consegue buscar", async () => {
        vi.mocked(obterEvento).mockResolvedValue(eventoFalso({ ativo: "N" }));
        const tela = await abrir();

        expect(tela.text()).toContain("Evento inativo: o participante não consegue buscar as fotos.");
    });
});
