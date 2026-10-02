import { reactive } from "vue";
import { copiarTexto } from "../../ts/copiar";
import { fimAntesDoInicio } from "../../ts/datas";
import type { DadosEdicao, Evento, FormDados, Fotografo, SituacaoEstacao, Vinculo } from "./interfaces";
import {
    criarFotografo,
    desvincularFotografo,
    editarEvento,
    listarFotografos,
    listarVinculos,
    obterEstacao,
    obterEvento,
    subirMarcaDagua,
    vincularFotografo,
} from "./services/evento.service";

export function formDoEvento(e: Evento): FormDados {
    return {
        nome: e.nome,
        data_inicio: e.data_inicio ?? "",
        data_fim: e.data_fim,
        privado: e.privado === "S",
        ativo: e.ativo === "S",
        organizador: e.config.organizador,
        exigir_whatsapp: e.config.exigir_whatsapp,
        marca_dagua: e.config.marca_dagua,
        limiar: e.config.limiar,
        max_selfies: e.config.max_selfies,
        dias_expurgo: e.config.dias_expurgo,
        validade_resultado_dias: e.config.validade_resultado_dias ?? "",
    };
}

// Os números vazios seguem como "" e a API responde com a faixa do campo; só a validade
// vazia tem sentido próprio ("sem validade") e vira null.
function dadosDoForm(f: FormDados): DadosEdicao {
    return {
        nome: f.nome,
        data_inicio: f.data_inicio || null,
        data_fim: f.data_fim,
        privado: f.privado,
        ativo: f.ativo,
        config: {
            organizador: f.organizador,
            exigir_whatsapp: f.exigir_whatsapp,
            marca_dagua: f.marca_dagua,
            limiar: f.limiar,
            max_selfies: f.max_selfies,
            dias_expurgo: f.dias_expurgo,
            validade_resultado_dias: f.validade_resultado_dias === "" ? null : f.validade_resultado_dias,
        },
    };
}

const NOME_DO_LINK = { participante: "do participante", anfitriao: "do anfitrião", estacao: "da estação" };
const COPIADO_MS = 2000;

const mensagem = (erro: unknown, padrao: string) => (erro instanceof Error ? erro.message : padrao);

function estadoInicial() {
    return {
        carregando: true,
        erro: "",
        evento: null as Evento | null,
        form: null as FormDados | null,
        salvando: false,
        mensagemDados: "",
        erroDados: "",
        enviandoMarca: false,
        mensagemMarca: "",
        erroMarca: "",
        qrGrande: "",
        mensagemLinks: "",
        // Qual botão acabou de copiar: só ele vira "Copiado ✓".
        copiado: "",
        estacao: undefined as SituacaoEstacao | null | undefined,
        vinculos: [] as Vinculo[],
        fotografos: [] as Fotografo[],
        idParaAdicionar: 0,
        novoNome: "",
        novoTelefone: "",
        removendo: null as Vinculo | null,
        ocupadoFotografos: false,
        erroFotografos: "",
    };
}

export const state = reactive(estadoInicial());

export const actions = {
    async init(idEvento: number): Promise<void> {
        Object.assign(state, estadoInicial());
        try {
            const evento = await obterEvento(idEvento);
            state.evento = evento;
            state.form = formDoEvento(evento);
            await Promise.all([actions.carregarFotografos(), actions.carregarEstacao()]);
        } catch (erro) {
            state.erro = mensagem(erro, "Não conseguimos abrir o evento.");
        } finally {
            state.carregando = false;
        }
    },

    async salvar(): Promise<void> {
        if (!state.evento || !state.form || state.salvando) return;
        Object.assign(state, { mensagemDados: "", erroDados: "" });
        if (fimAntesDoInicio(state.form.data_inicio, state.form.data_fim)) {
            state.erroDados = "O fim do evento não pode ser antes do início.";
            return;
        }
        state.salvando = true;
        try {
            const evento = await editarEvento(state.evento.id_evento, dadosDoForm(state.form));
            state.evento = evento;
            state.form = formDoEvento(evento);
            state.mensagemDados = "Salvo. A estação recebe a mudança em até 1 minuto.";
        } catch (erro) {
            state.erroDados = mensagem(erro, "Não conseguimos salvar.");
        } finally {
            state.salvando = false;
        }
    },

    async enviarMarca(arquivo: File): Promise<void> {
        if (!state.evento) return;
        Object.assign(state, { mensagemMarca: "", erroMarca: "", enviandoMarca: true });
        try {
            await subirMarcaDagua(state.evento.id_evento, arquivo);
            state.mensagemMarca = "Marca d'água enviada.";
        } catch (erro) {
            state.erroMarca = mensagem(erro, "Não conseguimos enviar a marca d'água.");
        } finally {
            state.enviandoMarca = false;
        }
    },

    // A estação é um extra da página: sem resposta, a linha dela some e o resto segue.
    async carregarEstacao(): Promise<void> {
        try {
            state.estacao = await obterEstacao();
        } catch {
            state.estacao = undefined;
        }
    },

    async copiar(chave: keyof typeof NOME_DO_LINK, texto: string): Promise<void> {
        if (await copiarTexto(texto)) {
            state.copiado = chave;
            state.mensagemLinks = `Link ${NOME_DO_LINK[chave]} copiado.`;
            setTimeout(() => {
                if (state.copiado === chave) state.copiado = "";
            }, COPIADO_MS);
        } else {
            state.copiado = "";
            state.mensagemLinks = "O navegador não deixou copiar. Selecione o link e copie à mão.";
        }
    },

    abrirQr(link: string): void {
        state.qrGrande = link;
    },

    fecharQr(): void {
        state.qrGrande = "";
    },

    async carregarFotografos(): Promise<void> {
        if (!state.evento) return;
        try {
            const [vinculos, fotografos] = await Promise.all([listarVinculos(state.evento.id_evento), listarFotografos()]);
            Object.assign(state, { vinculos, fotografos });
        } catch (erro) {
            state.erroFotografos = mensagem(erro, "Não conseguimos carregar os fotógrafos.");
        }
    },

    async adicionar(): Promise<void> {
        const idFotografo = Number(state.idParaAdicionar);
        if (!idFotografo) return;
        await comFotografos(async (idEvento) => {
            await vincularFotografo(idEvento, idFotografo);
            state.idParaAdicionar = 0;
        });
    },

    async cadastrarEAdicionar(): Promise<void> {
        const nome = state.novoNome.trim();
        if (!nome) {
            state.erroFotografos = "Informe o nome do fotógrafo.";
            return;
        }
        await comFotografos(async (idEvento) => {
            const fotografo = await criarFotografo(nome, state.novoTelefone.trim() || null);
            await vincularFotografo(idEvento, fotografo.id_fotografo);
            Object.assign(state, { novoNome: "", novoTelefone: "" });
        });
    },

    pedirRemocao(vinculo: Vinculo): void {
        state.removendo = vinculo;
    },

    cancelarRemocao(): void {
        state.removendo = null;
    },

    async confirmarRemocao(): Promise<void> {
        const vinculo = state.removendo;
        state.removendo = null;
        if (!vinculo) return;
        await comFotografos(async () => {
            await desvincularFotografo(vinculo.id_evento_fotografo);
        });
    },
};

// Uma operação por vez no bloco, e a lista recarregada no fim: é ela que diz quem ficou.
async function comFotografos(operacao: (idEvento: number) => Promise<void>): Promise<void> {
    if (!state.evento || state.ocupadoFotografos) return;
    Object.assign(state, { ocupadoFotografos: true, erroFotografos: "" });
    try {
        await operacao(state.evento.id_evento);
        await actions.carregarFotografos();
    } catch (erro) {
        state.erroFotografos = mensagem(erro, "Não conseguimos completar.");
    } finally {
        state.ocupadoFotografos = false;
    }
}
