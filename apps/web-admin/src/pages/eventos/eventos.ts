import { reactive } from "vue";
import type { EventoDaLista } from "./interfaces";
import { listarEventos } from "./services/eventos.service";

export const state = reactive({ carregando: true, eventos: [] as EventoDaLista[], erro: "" });

export const actions = {
    async init(): Promise<void> {
        Object.assign(state, { carregando: true, erro: "" });
        try {
            state.eventos = await listarEventos();
        } catch (erro) {
            state.erro = erro instanceof Error ? erro.message : "Não conseguimos carregar os eventos.";
        } finally {
            state.carregando = false;
        }
    },
};
