import { reactive } from "vue";
import { ErroDaApi } from "../../ts/erros";
import { guardarSessao, lerSessao, sair, type Sessao } from "../../ts/sessao";
import type { RespostaPainel } from "./interfaces";
import { encerrarEvento, getPainel, login, reprocessar } from "./services/estacao.service";

const ATUALIZACAO_MS = 2000;
const CHAVE_EVENTO = "evento_estacao";

// A escolha é deste computador: cada painel aberto acompanha o evento que quiser.
function lerEscolha(): number | null {
    try {
        const id = Number(localStorage.getItem(CHAVE_EVENTO));
        return Number.isInteger(id) && id > 0 ? id : null;
    } catch {
        return null;
    }
}

function guardarEscolha(id: number | null): void {
    try {
        if (id === null) localStorage.removeItem(CHAVE_EVENTO);
        else localStorage.setItem(CHAVE_EVENTO, String(id));
    } catch {
        // Sem armazenamento a escolha vale só até recarregar a página.
    }
}

export const state = reactive({
    carregando: true,
    sessao: null as Sessao | null,
    erroLogin: "",
    painel: null as RespostaPainel | null,
    idEventoEscolhido: null as number | null,
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
        state.idEventoEscolhido = lerEscolha();
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
        const pedido = state.idEventoEscolhido;
        try {
            const painel = await getPainel(pedido);
            // O operador trocou de evento com este pedido no ar: a resposta é do evento anterior.
            if (pedido !== state.idEventoEscolhido) return;
            state.painel = painel;
            state.agora = Date.now();
            // A estação ignora a escolha de um evento que fechou e volta ao de hoje.
            if (pedido !== null && painel.evento?.id_evento !== pedido) {
                state.idEventoEscolhido = null;
                guardarEscolha(null);
            }
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

    async escolherEvento(idEvento: number): Promise<void> {
        state.idEventoEscolhido = idEvento;
        guardarEscolha(idEvento);
        state.mensagem = "";
        await actions.carregar();
    },

    // Sem `idFoto`, todas as fotos com erro do evento mostrado.
    async reprocessar(idFoto?: number): Promise<void> {
        const idEvento = state.painel?.evento?.id_evento;
        if (idFoto === undefined && !idEvento) return;
        try {
            const r = await reprocessar(idFoto !== undefined ? { id_foto: idFoto } : { id_evento: idEvento! });
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
