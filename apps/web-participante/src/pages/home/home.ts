import { reactive } from "vue";
import { router } from "../../router";
import type { EventoPublico } from "../../ts/galeriaPublica";
import { getEvento } from "../../ts/galeriaPublica";
import { memoriaDoEvento } from "../../ts/memoria";

export const state = reactive({
    carregando: true,
    caminho: "",
    evento: null as EventoPublico | null,
    mensagem: "",
    tokenLembrado: "",
    qtdLembrada: 0,
});

export const actions = {
    async init(slug: string, chave: string): Promise<void> {
        state.caminho = chave ? `/p/${chave}` : `/e/${slug}`;
        state.carregando = true;
        state.mensagem = "";
        state.evento = null;
        state.tokenLembrado = "";
        state.qtdLembrada = 0;
        try {
            const [evento, memoria] = await Promise.all([
                getEvento({ slug: slug || undefined, chaveAcesso: chave || undefined }),
                memoriaDoEvento(state.caminho),
            ]);
            state.evento = evento;
            if (memoria) {
                state.tokenLembrado = memoria.token;
                state.qtdLembrada = memoria.qtd_fotos;
            }
        } catch (erro) {
            state.mensagem = erro instanceof Error ? erro.message : "Não conseguimos abrir o evento.";
        } finally {
            state.carregando = false;
        }
    },

    irParaSelfie(): void {
        router.push(`${state.caminho}/selfie`);
    },

    irParaGaleria(): void {
        router.push(`${state.caminho}/fotos`);
    },

    irParaMinhasFotos(): void {
        if (state.tokenLembrado) router.push({ name: "resultado", params: { token: state.tokenLembrado } });
    },
};
