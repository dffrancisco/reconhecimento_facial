import { reactive } from "vue";
import { aviso, entrarComo } from "../../ts/sessao";
import { login } from "./services/entrar.service";

export const state = reactive({ usuario: "", senha: "", erro: "", entrando: false });

export const actions = {
    init(): void {
        // O motivo de ter caído aqui (sessão expirada) aparece uma vez, no lugar do erro.
        Object.assign(state, { usuario: "", senha: "", erro: aviso.value, entrando: false });
        aviso.value = "";
    },

    async entrar(): Promise<boolean> {
        if (state.entrando) return false;
        state.erro = "";
        state.entrando = true;
        try {
            const r = await login(state.usuario, state.senha);
            entrarComo({ token: r.token, nome: r.nome, id_operador: r.id_operador });
            return true;
        } catch (erro) {
            state.erro = erro instanceof Error ? erro.message : "Não conseguimos entrar.";
            return false;
        } finally {
            state.entrando = false;
        }
    },
};
