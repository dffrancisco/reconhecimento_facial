import { reactive } from "vue";
import { fimAntesDoInicio, hoje } from "../../ts/datas";
import { enderecoDoNome } from "../../ts/endereco";
import { criarEvento } from "./services/novo-evento.service";

function formVazio() {
    const dia = hoje();
    return {
        nome: "",
        slug: "",
        tipo: "esportivo" as "esportivo" | "social",
        data_inicio: dia,
        data_fim: dia,
        privado: false,
        // Desligado enquanto a verificação por WhatsApp não existe (spec §3.3).
        exigir_whatsapp: false,
    };
}

export const state = reactive({ form: formVazio(), slugEditado: false, acessoEditado: false, salvando: false, erro: "" });

export const actions = {
    init(): void {
        Object.assign(state, { form: formVazio(), slugEditado: false, acessoEditado: false, salvando: false, erro: "" });
    },

    mudarNome(nome: string): void {
        state.form.nome = nome;
        if (!state.slugEditado) state.form.slug = enderecoDoNome(nome);
    },

    editarEndereco(valor: string): void {
        state.slugEditado = true;
        state.form.slug = valor;
    },

    // Ao sair do campo: o que o operador digitou vira um endereço válido, em vez de voltar
    // recusado pela API com uma mensagem técnica.
    arrumarEndereco(): void {
        state.form.slug = enderecoDoNome(state.form.slug);
    },

    mudarTipo(tipo: "esportivo" | "social"): void {
        state.form.tipo = tipo;
        if (!state.acessoEditado) state.form.privado = tipo === "social";
    },

    mudarAcesso(privado: boolean): void {
        state.acessoEditado = true;
        state.form.privado = privado;
    },

    async criar(): Promise<number | null> {
        if (state.salvando) return null;
        const f = state.form;
        const nome = f.nome.trim();
        if (!nome) return falhar("Informe o nome do evento.");
        if (!f.slug) return falhar("Informe o endereço do evento.");
        if (!f.data_fim) return falhar("Informe a data de fim.");
        if (fimAntesDoInicio(f.data_inicio, f.data_fim)) return falhar("O fim do evento não pode ser antes do início.");

        state.erro = "";
        state.salvando = true;
        try {
            const evento = await criarEvento({
                nome,
                slug: f.slug,
                tipo: f.tipo,
                data_inicio: f.data_inicio || null,
                data_fim: f.data_fim,
                privado: f.privado,
                config: { exigir_whatsapp: f.exigir_whatsapp },
            });
            return evento.id_evento;
        } catch (erro) {
            return falhar(erro instanceof Error ? erro.message : "Não conseguimos criar o evento.");
        } finally {
            state.salvando = false;
        }
    },
};

function falhar(mensagem: string): null {
    state.erro = mensagem;
    return null;
}
