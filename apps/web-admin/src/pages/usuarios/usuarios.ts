import { reactive } from "vue";
import { entrarComo, sessao } from "../../ts/sessao";
import type { Janela, Usuario } from "./interfaces";
import { alterarUsuario, criarUsuario, excluirUsuario, listarUsuarios, trocarSenha } from "./services/usuarios.service";

function estadoInicial() {
    return {
        carregando: true,
        erro: "",
        usuarios: [] as Usuario[],
        janela: null as Janela | null,
        form: { nome: "", login: "", senha: "", confirmacao: "" },
        erroJanela: "",
        ocupado: false,
    };
}

export const state = reactive(estadoInicial());

const mensagem = (erro: unknown, padrao: string) => (erro instanceof Error ? erro.message : padrao);

async function carregar(): Promise<void> {
    try {
        state.usuarios = await listarUsuarios();
        state.erro = "";
    } catch (erro) {
        state.erro = mensagem(erro, "Não conseguimos carregar os usuários.");
    } finally {
        state.carregando = false;
    }
}

function abrir(janela: Janela, form: Partial<typeof state.form> = {}): void {
    Object.assign(state, { janela, erroJanela: "", form: { nome: "", login: "", senha: "", confirmacao: "", ...form } });
}

// Uma operação por vez: a janela fica aberta com o erro, ou fecha e a lista recarrega.
async function executar(operacao: () => Promise<void>): Promise<void> {
    if (state.ocupado) return;
    Object.assign(state, { ocupado: true, erroJanela: "" });
    try {
        await operacao();
        state.janela = null;
        await carregar();
    } catch (erro) {
        state.erroJanela = mensagem(erro, "Não conseguimos completar.");
    } finally {
        state.ocupado = false;
    }
}

function senhasConferem(): boolean {
    if (state.form.senha === state.form.confirmacao) return true;
    state.erroJanela = "As senhas não conferem.";
    return false;
}

export const actions = {
    async init(): Promise<void> {
        Object.assign(state, estadoInicial());
        await carregar();
    },

    ehVoce(usuario: Usuario): boolean {
        return usuario.id_operador === sessao.value?.id_operador;
    },

    abrirNovo(): void {
        abrir({ tipo: "novo" });
    },

    abrirAlterar(usuario: Usuario): void {
        abrir({ tipo: "alterar", usuario }, { nome: usuario.nome, login: usuario.login });
    },

    abrirSenha(usuario: Usuario): void {
        abrir({ tipo: "senha", usuario });
    },

    abrirExclusao(usuario: Usuario): void {
        abrir({ tipo: "excluir", usuario });
    },

    fechar(): void {
        state.janela = null;
    },

    async salvar(): Promise<void> {
        const janela = state.janela;
        const { nome, login, senha } = state.form;
        if (!janela) return;

        if (janela.tipo === "novo") {
            if (!senhasConferem()) return;
            await executar(async () => {
                await criarUsuario(nome.trim(), login.trim(), senha);
            });
        } else if (janela.tipo === "alterar") {
            await executar(async () => {
                await alterarUsuario(janela.usuario.id_operador, nome.trim(), login.trim());
                if (actions.ehVoce(janela.usuario) && sessao.value) entrarComo({ ...sessao.value, nome: nome.trim() });
            });
        } else if (janela.tipo === "senha") {
            if (!senhasConferem()) return;
            await executar(async () => {
                const r = await trocarSenha(janela.usuario.id_operador, senha);
                // A própria senha trocada derruba a sessão antiga: a nova chega na resposta.
                if (r.token && sessao.value) entrarComo({ ...sessao.value, token: r.token });
            });
        }
    },

    async confirmarExclusao(): Promise<void> {
        const janela = state.janela;
        if (janela?.tipo !== "excluir") return;
        await executar(async () => {
            await excluirUsuario(janela.usuario.id_operador);
        });
    },
};
