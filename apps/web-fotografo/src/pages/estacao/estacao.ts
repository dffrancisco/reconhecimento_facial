import { reactive } from "vue";
import { ErroDaApi } from "../../ts/erros";
import { guardarSessao, lerSessao, sair, type Sessao } from "../../ts/sessao";
import type { RespostaPainel } from "./interfaces";
import { encerrarEvento, getPainel, login, reprocessar } from "./services/estacao.service";

const ATUALIZACAO_MS = 2000;

export const state = reactive({
    carregando: true,
    sessao: null as Sessao | null,
    erroLogin: "",
    painel: null as RespostaPainel | null,
    mensagem: "",
    qrGrande: "",
    confirmandoEncerrar: false,
    agora: Date.now(),
});

let intervalo: ReturnType<typeof setInterval> | undefined;

function pararAtualizacao(): void {
    clearInterval(intervalo);
    intervalo = undefined;
}

function voltarAoLogin(mensagem = ""): void {
    pararAtualizacao();
    sair();
    Object.assign(state, { sessao: null, painel: null, erroLogin: mensagem, confirmandoEncerrar: false, qrGrande: "" });
}

export const actions = {
    async init(): Promise<void> {
        pararAtualizacao();
        state.sessao = lerSessao();
        state.carregando = Boolean(state.sessao);
        if (!state.sessao) {
            state.carregando = false;
            return;
        }
        await actions.carregar();
        state.carregando = false;
        actions.comecarAtualizacao();
    },

    comecarAtualizacao(): void {
        pararAtualizacao();
        intervalo = setInterval(() => actions.carregar(), ATUALIZACAO_MS);
    },

    async carregar(): Promise<void> {
        try {
            state.painel = await getPainel();
            state.agora = Date.now();
        } catch (erro) {
            if (erro instanceof ErroDaApi && erro.codigo === "sessao_expirada") voltarAoLogin(erro.message);
            else if (erro instanceof ErroDaApi && !erro.semConexao && !state.painel) voltarAoLogin(erro.message);
        }
    },

    async entrar(usuario: string, senha: string): Promise<void> {
        state.erroLogin = "";
        try {
            const sessao = await login(usuario, senha);
            guardarSessao(sessao);
            state.sessao = sessao;
            await actions.carregar();
            actions.comecarAtualizacao();
        } catch (erro) {
            state.erroLogin = erro instanceof Error ? erro.message : "Não conseguimos entrar.";
        }
    },

    sair(): void {
        voltarAoLogin();
    },

    async reprocessar(idFoto?: number): Promise<void> {
        try {
            const r = await reprocessar(idFoto);
            state.mensagem =
                r.sem_arquivo > 0
                    ? `${r.reenfileiradas} de volta na fila; ${r.sem_arquivo} sem arquivo na estação (peça reenvio).`
                    : `${r.reenfileiradas} foto(s) de volta na fila.`;
            await actions.carregar();
        } catch (erro) {
            state.mensagem = erro instanceof Error ? erro.message : "Não conseguimos reprocessar.";
        }
    },

    pedirEncerrar(): void {
        state.confirmandoEncerrar = true;
    },

    cancelarEncerrar(): void {
        state.confirmandoEncerrar = false;
    },

    async confirmarEncerrar(): Promise<void> {
        const idEvento = state.painel?.evento?.id_evento;
        state.confirmandoEncerrar = false;
        if (!idEvento) return;
        try {
            await encerrarEvento(idEvento);
            state.mensagem = "Evento encerrado.";
            await actions.carregar();
        } catch (erro) {
            state.mensagem = erro instanceof Error ? erro.message : "Não conseguimos encerrar.";
        }
    },

    async copiar(texto: string): Promise<void> {
        try {
            await navigator.clipboard.writeText(texto);
            state.mensagem = "Link copiado.";
        } catch {
            // Sem HTTPS o navegador não libera a área de transferência: o link fica visível na tela.
            state.mensagem = "O navegador não deixou copiar. Selecione o link e copie à mão.";
        }
    },

    abrirQr(link: string): void {
        state.qrGrande = link;
    },

    fecharQr(): void {
        state.qrGrande = "";
    },

    encerrar(): void {
        pararAtualizacao();
    },
};
