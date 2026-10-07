import { beforeEach, describe, expect, test, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import PaginaUsuarios from "./index.vue";
import { alterarUsuario, criarUsuario, excluirUsuario, listarUsuarios, trocarSenha } from "./services/usuarios.service";
import { ErroDaApi } from "../../ts/erros";
import { entrarComo, sessao } from "../../ts/sessao";
import type { Usuario } from "./interfaces";

vi.mock("./services/usuarios.service", () => ({
    listarUsuarios: vi.fn(),
    criarUsuario: vi.fn(),
    alterarUsuario: vi.fn(),
    trocarSenha: vi.fn(),
    excluirUsuario: vi.fn(),
}));

const francisco: Usuario = { id_operador: 1, nome: "Francisco", login: "francisco", criado_em: "2026-09-20T15:00:00.000Z" };
const wallas: Usuario = { id_operador: 4, nome: "Wallas", login: "wallas", criado_em: "2026-10-05T15:00:00.000Z" };

async function abrir() {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: "/usuarios", component: PaginaUsuarios },
            { path: "/", component: { template: "<p>eventos</p>" } },
            { path: "/entrar", name: "entrar", component: { template: "<p>entrar</p>" } },
        ],
    });
    await router.push("/usuarios");
    const tela = mount(PaginaUsuarios, { global: { plugins: [router] } });
    await flushPromises();
    return tela;
}

async function preencher(tela: VueWrapper, campos: Record<string, string>) {
    for (const [nome, valor] of Object.entries(campos)) await tela.get(`.modal input[name=${nome}]`).setValue(valor);
}

async function salvar(tela: VueWrapper) {
    await tela.get(".modal form").trigger("submit");
    await flushPromises();
}

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    entrarComo({ token: "tok", nome: "Francisco", id_operador: 1 });
    vi.mocked(listarUsuarios).mockResolvedValue([francisco, wallas]);
});

describe("usuários — lista", () => {
    test("mostra nome, login e a data de criação", async () => {
        const tela = await abrir();

        const linha = tela.get("[data-usuario='4']").text();
        expect(linha).toContain("Wallas");
        expect(linha).toContain("wallas");
        expect(linha).toContain("05/10/2026");
    });

    test("a própria linha diz (você) e não tem Excluir; a dos outros tem", async () => {
        const tela = await abrir();

        expect(tela.get("[data-usuario='1']").text()).toContain("(você)");
        expect(tela.find("[data-acao='excluir-1']").exists()).toBe(false);
        expect(tela.find("[data-acao='excluir-4']").exists()).toBe(true);
    });

    test("o cabeçalho leva para Usuários", async () => {
        const tela = await abrir();
        expect(tela.get("header").text()).toContain("Usuários");
    });

    test("erro ao carregar aparece no lugar da lista", async () => {
        vi.mocked(listarUsuarios).mockRejectedValue(new ErroDaApi("Sem conexão.", undefined, 500));
        const tela = await abrir();
        expect(tela.text()).toContain("Sem conexão.");
    });
});

describe("usuários — novo", () => {
    test("cria, fecha a janela e recarrega a lista", async () => {
        vi.mocked(criarUsuario).mockResolvedValue({ id_operador: 9 });
        const tela = await abrir();

        await tela.get("[data-acao='novo-usuario']").trigger("click");
        await preencher(tela, { nome: "Ana Souza", login: "ana", senha: "senha-da-ana", confirmacao: "senha-da-ana" });
        await salvar(tela);

        expect(criarUsuario).toHaveBeenCalledWith("Ana Souza", "ana", "senha-da-ana");
        expect(tela.find(".modal").exists()).toBe(false);
        expect(listarUsuarios).toHaveBeenCalledTimes(2);
    });

    test("senhas diferentes não chamam a API", async () => {
        const tela = await abrir();

        await tela.get("[data-acao='novo-usuario']").trigger("click");
        await preencher(tela, { nome: "Ana", login: "ana", senha: "senha-da-ana", confirmacao: "outra-senha" });
        await salvar(tela);

        expect(criarUsuario).not.toHaveBeenCalled();
        expect(tela.get(".modal").text()).toContain("As senhas não conferem.");
    });

    test("o erro da API aparece na janela, sem apagar o que foi preenchido", async () => {
        vi.mocked(criarUsuario).mockRejectedValue(new ErroDaApi("Esse login já é de outro usuário.", undefined, 422));
        const tela = await abrir();

        await tela.get("[data-acao='novo-usuario']").trigger("click");
        await preencher(tela, { nome: "Ana", login: "wallas", senha: "senha-da-ana", confirmacao: "senha-da-ana" });
        await salvar(tela);

        expect(tela.get(".modal").text()).toContain("Esse login já é de outro usuário.");
        expect((tela.get(".modal input[name=login]").element as HTMLInputElement).value).toBe("wallas");
    });

    test("cancelar fecha sem chamar a API", async () => {
        const tela = await abrir();

        await tela.get("[data-acao='novo-usuario']").trigger("click");
        await tela.get("[data-acao='cancelar']").trigger("click");

        expect(tela.find(".modal").exists()).toBe(false);
        expect(criarUsuario).not.toHaveBeenCalled();
    });
});

describe("usuários — alterar", () => {
    test("abre com o nome e o login de hoje e salva os dois", async () => {
        vi.mocked(alterarUsuario).mockResolvedValue({ ok: true });
        const tela = await abrir();

        await tela.get("[data-acao='alterar-4']").trigger("click");
        expect((tela.get(".modal input[name=nome]").element as HTMLInputElement).value).toBe("Wallas");
        await preencher(tela, { nome: "Wallas Lima" });
        await salvar(tela);

        expect(alterarUsuario).toHaveBeenCalledWith(4, "Wallas Lima", "wallas");
        expect(tela.find(".modal").exists()).toBe(false);
    });

    test("alterar o próprio nome atualiza o nome da sessão", async () => {
        vi.mocked(alterarUsuario).mockResolvedValue({ ok: true });
        const tela = await abrir();

        await tela.get("[data-acao='alterar-1']").trigger("click");
        await preencher(tela, { nome: "Francisco Alves" });
        await salvar(tela);

        expect(sessao.value?.nome).toBe("Francisco Alves");
    });
});

describe("usuários — trocar senha", () => {
    test("troca a senha de outro", async () => {
        vi.mocked(trocarSenha).mockResolvedValue({ ok: true });
        const tela = await abrir();

        await tela.get("[data-acao='senha-4']").trigger("click");
        expect(tela.get(".modal").text()).toContain("As sessões abertas dele com a senha antiga param de valer.");
        await preencher(tela, { senha: "senha-nova-1", confirmacao: "senha-nova-1" });
        await salvar(tela);

        expect(trocarSenha).toHaveBeenCalledWith(4, "senha-nova-1");
        expect(tela.find(".modal").exists()).toBe(false);
        expect(sessao.value?.token).toBe("tok");
    });

    test("na própria senha, guarda a sessão nova que a API devolve", async () => {
        vi.mocked(trocarSenha).mockResolvedValue({ ok: true, token: "tok-novo" });
        const tela = await abrir();

        await tela.get("[data-acao='senha-1']").trigger("click");
        expect(tela.get(".modal").text()).toContain("Você continua conectado neste navegador");
        await preencher(tela, { senha: "minha-nova-1", confirmacao: "minha-nova-1" });
        await salvar(tela);

        expect(sessao.value?.token).toBe("tok-novo");
        expect(sessao.value?.id_operador).toBe(1);
    });

    test("senhas diferentes não chamam a API", async () => {
        const tela = await abrir();

        await tela.get("[data-acao='senha-4']").trigger("click");
        await preencher(tela, { senha: "senha-nova-1", confirmacao: "senha-nova-2" });
        await salvar(tela);

        expect(trocarSenha).not.toHaveBeenCalled();
        expect(tela.get(".modal").text()).toContain("As senhas não conferem.");
    });
});

describe("usuários — excluir", () => {
    test("pede confirmação e exclui", async () => {
        vi.mocked(excluirUsuario).mockResolvedValue({ ok: true });
        const tela = await abrir();

        await tela.get("[data-acao='excluir-4']").trigger("click");
        expect(tela.get(".modal").text()).toContain("Excluir Wallas?");
        expect(excluirUsuario).not.toHaveBeenCalled();
        await tela.get("[data-acao='confirmar-exclusao']").trigger("click");
        await flushPromises();

        expect(excluirUsuario).toHaveBeenCalledWith(4);
        expect(listarUsuarios).toHaveBeenCalledTimes(2);
    });

    test("a recusa da API aparece na janela", async () => {
        vi.mocked(excluirUsuario).mockRejectedValue(new ErroDaApi("Precisa sobrar pelo menos um usuário.", undefined, 422));
        const tela = await abrir();

        await tela.get("[data-acao='excluir-4']").trigger("click");
        await tela.get("[data-acao='confirmar-exclusao']").trigger("click");
        await flushPromises();

        expect(tela.get(".modal").text()).toContain("Precisa sobrar pelo menos um usuário.");
    });
});
