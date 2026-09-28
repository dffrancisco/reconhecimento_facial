import { reactive } from "vue";
import { fimAntesDoInicio } from "../../ts/datas";
import type { DadosEdicao, Evento, FormDados } from "./interfaces";
import { editarEvento, obterEvento, subirMarcaDagua } from "./services/evento.service";

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
};
