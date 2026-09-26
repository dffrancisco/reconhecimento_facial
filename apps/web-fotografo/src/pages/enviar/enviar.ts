import { reactive } from "vue";
import { criarArmazenamento, type Armazenamento } from "../../ts/armazenamento";
import { deSelecionados, filtrarArquivos, lerSoltos, type ArquivoLido } from "../../ts/arquivos";
import { ErroDaApi } from "../../ts/erros";
import { FilaDeEnvio } from "../../ts/fila/fila";
import { FalhaDeEnvio, type ItemFila } from "../../ts/fila/tipos";
import { calcularHash } from "../../ts/hash";
import { estadoConexao } from "../../ts/tempo";
import { lerToken } from "../../ts/token";
import { enviarPedaco, getSessao, iniciarUpload, statusUpload, type SituacaoEstacao } from "./services/enviar.service";
import { falhaDaChamada } from "./services/traducao";

const LINK_INVALIDO = "Este link de envio não é válido. Peça o link ao operador da estação.";
const CONSULTA_ESTACAO_MS = 5000;
const TITULO = "Envio de fotos";

const estacaoVazia = (): SituacaoEstacao => ({ enviadas: 0, processando: 0, prontas: 0, com_erro: 0, erros: [] });

export const state = reactive({
    carregando: true,
    bloqueio: "",
    evento: "",
    fotografo: "",
    pendentesAnteriores: 0,
    ignorados: [] as string[],
    recusados: [] as { nome: string; mensagem: string }[],
    estacao: estacaoVazia(),
    // Só o que a tela mostra: com 2 000 fotos, copiar a fila inteira a cada progresso pesaria.
    emAndamento: [] as ItemFila[],
    comErroItens: [] as ItemFila[],
    pausada: false,
    parada: null as string | null,
    semConexaoDesde: null as number | null,
    // A fila só percebe a queda quando tem foto para mandar; parada, é a consulta periódica.
    estacaoSemConexaoDesde: null as number | null,
    enviados: 0,
    pulados: 0,
    esperando: 0,
    comErro: 0,
    bytesTotais: 0,
    bytesEnviados: 0,
    porVez: 3,
    agora: Date.now(),
    bytesPorSegundo: 0,
});

let fila: FilaDeEnvio | null = null;
let armazenamento: Armazenamento | null = null;
let token = "";
let relogio: ReturnType<typeof setInterval> | undefined;
let consulta: ReturnType<typeof setInterval> | undefined;
let desassinar: (() => void) | undefined;
let copiaAgendada = false;
let amostra: { t: number; bytes: number } | null = null;

function copiarEstado(): void {
    copiaAgendada = false;
    if (!fila) return;
    const e = fila.estado();
    Object.assign(state, {
        emAndamento: e.itens.filter((i) => i.situacao === "preparando" || i.situacao === "enviando").map((i) => ({ ...i })),
        comErroItens: e.itens.filter((i) => i.situacao === "erro").map((i) => ({ ...i })),
        pausada: e.pausada,
        parada: e.parada,
        semConexaoDesde: e.semConexaoDesde,
        enviados: e.enviados,
        pulados: e.pulados,
        esperando: e.esperando,
        comErro: e.comErro,
        bytesTotais: e.bytesTotais,
        bytesEnviados: e.bytesEnviados,
        porVez: fila.porVez,
    });
}

// Várias mudanças por segundo (progresso dos pedaços) viram uma cópia só.
function agendarCopia(): void {
    if (copiaAgendada) return;
    copiaAgendada = true;
    setTimeout(copiarEstado, 0);
}

function bloquearSeFechado(falha: FalhaDeEnvio): FalhaDeEnvio {
    if (falha.linkFechado) state.bloqueio = falha.message;
    return falha;
}

// A queda mais antiga que a fila ou a consulta periódica perceberam.
export function semConexaoDesde(): number | null {
    const marcas = [state.semConexaoDesde, state.estacaoSemConexaoDesde].filter((m): m is number => m !== null);
    return marcas.length ? Math.min(...marcas) : null;
}

function medirVelocidade(): void {
    const agora = Date.now();
    state.agora = agora;
    if (amostra && agora > amostra.t) {
        const instantanea = ((state.bytesEnviados - amostra.bytes) / (agora - amostra.t)) * 1000;
        state.bytesPorSegundo = state.bytesPorSegundo === 0 ? instantanea : state.bytesPorSegundo * 0.8 + instantanea * 0.2;
    }
    amostra = { t: agora, bytes: state.bytesEnviados };
    if (typeof document !== "undefined")
        document.title = estadoConexao(semConexaoDesde(), agora) === "alerta" ? "⚠ Sem conexão" : TITULO;
}

export const actions = {
    async init(): Promise<void> {
        actions.encerrar();
        Object.assign(state, {
            carregando: true,
            bloqueio: "",
            ignorados: [],
            recusados: [],
            estacao: estacaoVazia(),
            emAndamento: [],
            comErroItens: [],
            pendentesAnteriores: 0,
            bytesPorSegundo: 0,
            estacaoSemConexaoDesde: null,
        });
        fila = null;

        token = lerToken() ?? "";
        if (!token) {
            state.bloqueio = LINK_INVALIDO;
            state.carregando = false;
            return;
        }

        try {
            const sessao = await getSessao(token);
            state.evento = sessao.evento.nome;
            state.fotografo = sessao.fotografo.nome;

            armazenamento = criarArmazenamento(token);
            const guardar = armazenamento;
            fila = new FilaDeEnvio(
                {
                    calcularHash,
                    iniciar: (e) =>
                        iniciarUpload(token, e).catch((erro) => {
                            throw bloquearSeFechado(falhaDaChamada(erro));
                        }),
                    enviarPedaco: (e) =>
                        enviarPedaco(token, e).catch((erro) => {
                            throw erro instanceof FalhaDeEnvio ? bloquearSeFechado(erro) : erro;
                        }),
                    esperar: (ms) => new Promise((pronto) => setTimeout(pronto, ms)),
                    aoMudar: (item) => {
                        guardar.gravarItem(item.chave, { situacao: item.situacao, idUpload: item.idUpload, hash: item.hash }).catch(() => {});
                    },
                },
                { pedacoBytes: sessao.pedaco_bytes }
            );
            desassinar = fila.assinar(agendarCopia);
            copiarEstado();
            state.pendentesAnteriores = await armazenamento.pendentes();
        } catch (erro) {
            state.bloqueio =
                erro instanceof ErroDaApi && erro.semConexao
                    ? "Não conseguimos falar com a estação. Confira o Wi-Fi do evento e recarregue a página."
                    : erro instanceof Error
                      ? erro.message
                      : LINK_INVALIDO;
        } finally {
            state.carregando = false;
        }
        if (state.bloqueio) return;

        await actions.atualizarEstacao();
        relogio = setInterval(medirVelocidade, 1000);
        consulta = setInterval(() => actions.atualizarEstacao(), CONSULTA_ESTACAO_MS);
    },

    async atualizarEstacao(): Promise<void> {
        if (!token) return;
        try {
            state.estacao = await statusUpload(token);
            state.estacaoSemConexaoDesde = null;
        } catch (erro) {
            if (erro instanceof ErroDaApi && erro.semConexao) state.estacaoSemConexaoDesde ??= Date.now();
            if (erro instanceof ErroDaApi && (erro.codigo === "link_invalido" || erro.codigo === "evento_encerrado")) state.bloqueio = erro.message;
        }
    },

    async receber(lista: ArquivoLido[]): Promise<void> {
        if (!fila || !armazenamento) return;
        const { aceitos, recusados, ignorados } = filtrarArquivos(lista);
        state.recusados.push(...recusados);
        state.ignorados.push(...ignorados);

        // A impressão digital de uma visita anterior vale de novo: soltar a mesma pasta não recalcula.
        const comHash = await Promise.all(aceitos.map(async (a) => ({ ...a, hash: await armazenamento!.lerHash(a.chave) })));
        fila.adicionar(comHash);
        if (aceitos.length > 0) state.pendentesAnteriores = 0;
        copiarEstado();
    },

    async soltar(dados: DataTransfer): Promise<void> {
        await actions.receber(await lerSoltos(dados));
    },

    async escolher(lista: FileList | File[]): Promise<void> {
        await actions.receber(deSelecionados(lista));
    },

    alternarPausa(): void {
        if (!fila) return;
        if (state.pausada || state.parada) fila.continuar();
        else fila.pausar();
        copiarEstado();
    },

    mudarPorVez(valor: number): void {
        if (!fila) return;
        fila.porVez = valor;
        copiarEstado();
    },

    tentarDeNovo(chave: string): void {
        fila?.tentarDeNovo(chave);
        copiarEstado();
    },

    async esquecerPendentes(): Promise<void> {
        await armazenamento?.esquecerPendentes();
        state.pendentesAnteriores = 0;
    },

    temEnvioPendente(): boolean {
        return state.esperando > 0;
    },

    encerrar(): void {
        clearInterval(relogio);
        clearInterval(consulta);
        desassinar?.();
        desassinar = undefined;
        amostra = null;
        if (typeof document !== "undefined") document.title = TITULO;
    },
};
