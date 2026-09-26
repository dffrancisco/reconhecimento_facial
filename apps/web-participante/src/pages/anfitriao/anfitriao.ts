import { reactive } from "vue";
import type { FotoNaGrade } from "../../componentes/interfaces";
import { baixarArquivo } from "../../ts/arquivos";
import { esperarPartes } from "../../ts/zip";
import type { FotoDaGaleria } from "./interfaces";
import { getGaleria, pedirZipDoEvento, situacaoZipDoEvento } from "./services/anfitriao.service";

// A API devolve 60 por página: uma página menor que isso é a última.
const POR_PAGINA = 60;
// O ZIP do evento inteiro leva minutos: espera até 5 e depois pede para voltar.
const ESPERA_ZIP = { tentativas: 150, esperaMs: 2000 };

export const state = reactive({
    chave: "",
    carregando: true,
    evento: "",
    fotos: [] as FotoDaGaleria[],
    offset: 0,
    acabou: false,
    mensagem: "",
    aberta: null as number | null,
    zip: "nenhum" as "nenhum" | "montando" | "pronto",
    urlsZip: [] as string[],
});

export const actions = {
    async init(chave: string): Promise<void> {
        state.chave = chave;
        state.fotos = [];
        state.offset = 0;
        state.acabou = false;
        state.aberta = null;
        state.zip = "nenhum";
        state.urlsZip = [];
        await actions.carregarMais();
    },

    async carregarMais(): Promise<void> {
        state.carregando = true;
        state.mensagem = "";
        try {
            const pagina = await getGaleria(state.chave, state.offset);
            state.evento = pagina.evento;
            state.fotos = [...state.fotos, ...pagina.fotos];
            state.offset += pagina.fotos.length;
            state.acabou = pagina.fotos.length < POR_PAGINA;
        } catch (erro) {
            state.mensagem = erro instanceof Error ? erro.message : "Não conseguimos abrir a galeria.";
            state.acabou = true;
        } finally {
            state.carregando = false;
        }
    },

    abrir(indice: number): void {
        state.aberta = indice;
    },

    fechar(): void {
        state.aberta = null;
    },

    proxima(): void {
        if (state.aberta !== null) state.aberta = Math.min(state.aberta + 1, state.fotos.length - 1);
    },

    anterior(): void {
        if (state.aberta !== null) state.aberta = Math.max(state.aberta - 1, 0);
    },

    // A foto aberta mostra a versão web (2048 px), não o thumb da grade.
    fotoAberta(): FotoNaGrade | null {
        const foto = state.aberta === null ? undefined : state.fotos[state.aberta];
        return foto ? { id_foto: foto.id_foto, thumb: foto.web } : null;
    },

    // `dl=1` faz o nginx responder como anexo; fica fora da assinatura, que cobre só o caminho.
    salvar(): void {
        const foto = state.aberta === null ? undefined : state.fotos[state.aberta];
        if (foto) baixarArquivo(`${foto.web}&dl=1`);
    },

    async pedirZip(espera = ESPERA_ZIP): Promise<void> {
        state.zip = "montando";
        state.mensagem = "";
        try {
            const { partes } = await pedirZipDoEvento(state.chave);
            const resultado = await esperarPartes(partes, (id) => situacaoZipDoEvento(state.chave, id), espera);
            if (resultado.situacao === "pronto") {
                state.urlsZip = resultado.urls;
                state.zip = "pronto";
                return;
            }
            state.zip = "nenhum";
            state.mensagem =
                resultado.situacao === "demorou"
                    ? "O ZIP do evento ainda está sendo montado. Volte em alguns minutos e toque de novo em Baixar tudo."
                    : "Não conseguimos montar o ZIP agora. Tente mais tarde.";
        } catch (erro) {
            state.zip = "nenhum";
            state.mensagem = erro instanceof Error ? erro.message : "Não conseguimos pedir o ZIP.";
        }
    },
};
