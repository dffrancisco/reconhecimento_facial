import { beforeEach, describe, expect, test, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import Eventos from "./index.vue";
import { listarEventos } from "./services/eventos.service";
import { entrarComo } from "../../ts/sessao";
import type { EventoDaLista } from "./interfaces";

vi.mock("./services/eventos.service", () => ({ listarEventos: vi.fn() }));

const serra: EventoDaLista = { id_evento: 7, nome: "Corrida da Serra", slug: "corrida-da-serra", tipo: "esportivo", privado: "N", data_inicio: "2026-09-27", data_fim: "2026-09-27", ativo: "S" };
const festa: EventoDaLista = { id_evento: 9, nome: "Festa da Bia", slug: "festa-da-bia", tipo: "social", privado: "S", data_inicio: "2026-10-10", data_fim: "2026-10-11", ativo: "N" };

async function abrir() {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: "/", component: Eventos },
            { path: "/entrar", name: "entrar", component: { template: "<p>entrar</p>" } },
            { path: "/eventos/novo", component: { template: "<p>novo</p>" } },
            { path: "/eventos/:id", component: { template: "<p>evento</p>" } },
        ],
    });
    await router.push("/");
    const tela = mount(Eventos, { global: { plugins: [router] } });
    await flushPromises();
    return { tela, router };
}

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    entrarComo({ token: "tok", nome: "Ana" });
    vi.mocked(listarEventos).mockResolvedValue([serra, festa]);
});

describe("lista de eventos", () => {
    test("mostra período, tipo, acesso e situação", async () => {
        const { tela } = await abrir();

        const texto = tela.text();
        expect(texto).toContain("Corrida da Serra");
        expect(texto).toContain("27/09/2026");
        expect(texto).toContain("10/10/2026 a 11/10/2026");
        expect(texto).toContain("Esportivo");
        expect(texto).toContain("Privado");
        expect(texto).toContain("Inativo");
    });

    test("clicar na linha abre a página do evento", async () => {
        const { tela, router } = await abrir();

        await tela.get("[data-evento='7']").trigger("click");
        await flushPromises();

        expect(router.currentRoute.value.path).toBe("/eventos/7");
    });

    test("sem eventos, convida a criar o primeiro", async () => {
        vi.mocked(listarEventos).mockResolvedValue([]);
        const { tela } = await abrir();

        expect(tela.text()).toContain("Nenhum evento ainda. Crie o primeiro.");
        expect(tela.find("[data-acao=novo-evento]").exists()).toBe(true);
    });

    test("Sair apaga a sessão e volta para a entrada", async () => {
        const { tela, router } = await abrir();

        await tela.get("[data-acao=sair]").trigger("click");
        await flushPromises();

        expect(localStorage.getItem("sessao_admin")).toBeNull();
        expect(router.currentRoute.value.path).toBe("/entrar");
    });
});
