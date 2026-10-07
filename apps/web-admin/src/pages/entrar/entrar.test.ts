import { beforeEach, describe, expect, test, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import Entrar from "./index.vue";
import { login } from "./services/entrar.service";
import { ErroDaApi } from "../../ts/erros";
import { sair } from "../../ts/sessao";

vi.mock("./services/entrar.service", () => ({ login: vi.fn() }));

async function abrir() {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: "/entrar", name: "entrar", component: Entrar },
            { path: "/", name: "eventos", component: { template: "<p>eventos</p>" } },
        ],
    });
    await router.push("/entrar");
    const tela = mount(Entrar, { global: { plugins: [router] } });
    await flushPromises();
    return { tela, router };
}

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sair();
});

describe("entrar", () => {
    test("login certo guarda a sessão e abre a lista de eventos", async () => {
        vi.mocked(login).mockResolvedValue({ token: "tok-novo", nome: "Ana", id_operador: 3 });
        const { tela, router } = await abrir();

        await tela.get("input[name=login]").setValue("ana");
        await tela.get("input[name=senha]").setValue("senha-dev-123");
        await tela.get("form").trigger("submit");
        await flushPromises();

        expect(login).toHaveBeenCalledWith("ana", "senha-dev-123");
        expect(JSON.parse(localStorage.getItem("sessao_admin")!)).toEqual({ token: "tok-novo", nome: "Ana", id_operador: 3 });
        expect(router.currentRoute.value.path).toBe("/");
    });

    test("login errado mostra a mensagem da API e fica na entrada", async () => {
        vi.mocked(login).mockRejectedValue(new ErroDaApi("Login ou senha inválidos.", undefined, 422));
        const { tela, router } = await abrir();

        await tela.get("input[name=login]").setValue("ana");
        await tela.get("input[name=senha]").setValue("errada");
        await tela.get("form").trigger("submit");
        await flushPromises();

        expect(tela.text()).toContain("Login ou senha inválidos.");
        expect(router.currentRoute.value.path).toBe("/entrar");
    });

    test("vindo de uma sessão expirada, mostra o motivo", async () => {
        sair("Sessão expirada, faça login novamente.");
        const { tela } = await abrir();

        expect(tela.text()).toContain("Sessão expirada, faça login novamente.");
    });
});
