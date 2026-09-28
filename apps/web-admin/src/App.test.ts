import { beforeEach, describe, expect, test, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import App from "./App.vue";
import { criarRouter } from "./router";
import { entrarComo, sair } from "./ts/sessao";

vi.mock("./pages/eventos/services/eventos.service", () => ({ listarEventos: vi.fn().mockResolvedValue([]) }));

// A troca de rota que o App dispara sozinho carrega a tela da entrada sob demanda (import
// dinâmico): leva mais que uma rodada de microtarefas.
async function ate(condicao: () => boolean): Promise<void> {
    for (let i = 0; i < 50 && !condicao(); i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => localStorage.clear());

describe("rotas protegidas", () => {
    test("sem sessão, qualquer tela leva à entrada", async () => {
        sair();
        const router = criarRouter(createMemoryHistory());

        await router.push("/");

        expect(router.currentRoute.value.name).toBe("entrar");
    });

    test("a sessão que expira no meio de uma tela volta para a entrada", async () => {
        entrarComo({ token: "tok", nome: "Ana" });
        const router = criarRouter(createMemoryHistory());
        await router.push("/");
        mount(App, { global: { plugins: [router] } });
        await flushPromises();
        expect(router.currentRoute.value.name).toBe("eventos");

        sair("Sessão expirada, faça login novamente.");
        await ate(() => router.currentRoute.value.name === "entrar");

        expect(router.currentRoute.value.name).toBe("entrar");
    });
});
