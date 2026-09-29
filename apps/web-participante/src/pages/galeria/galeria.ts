import { reactive } from "vue";
import type { FotoNaGrade } from "../../componentes/interfaces";
import { baixarArquivo } from "../../ts/arquivos";
import { compartilharFoto, podeCompartilharArquivos } from "../../ts/compartilhar";
import type { DiaDoEvento, EntradaEvento, FotoPublica } from "../../ts/galeriaPublica";
import { getEvento, getGaleria } from "../../ts/galeriaPublica";

// A API devolve 60 por página: uma página menor que isso é a última.
const POR_PAGINA = 60;

export const state = reactive({
    entrada: {} as EntradaEvento,
    carregando: true,
    nomeEvento: "",
    dias: [] as DiaDoEvento[],
    diaAtivo: null as string | null,
    fotos: [] as FotoPublica[],
    offset: 0,
    acabou: false,
    mensagem: "",
    aberta: null as number | null,
    compartilharPronto: null as number | null,
});

// Arquivo do "toque de novo" do iPhone fora do state: File dentro do reactive vira Proxy,
// e o navigator.share não aceita Proxy.
let prontaParaEnvio: { indice: number; arquivo: File; url: string } | null = null;

export const actions = {
    async init(slug: string, chave: string): Promise<void> {
        state.entrada = { slug: slug || undefined, chaveAcesso: chave || undefined };
        state.carregando = true;
        state.nomeEvento = "";
        state.dias = [];
        state.diaAtivo = null;
        state.fotos = [];
        state.offset = 0;
        state.acabou = false;
        state.mensagem = "";
        state.aberta = null;
        state.compartilharPronto = null;
        prontaParaEnvio = null;
        try {
            const evento = await getEvento(state.entrada);
            state.nomeEvento = evento.nome;
            state.dias = evento.dias;
            // Um dia sempre ativo quando há escolha; com um dia só não há chip nem filtro.
            state.diaAtivo = evento.dias.length > 1 ? evento.dias[0].dia : null;
            await actions.carregarMais();
        } catch (erro) {
            state.mensagem = erro instanceof Error ? erro.message : "Não conseguimos abrir a galeria.";
            state.acabou = true;
            state.carregando = false;
        }
    },

    async trocarDia(dia: string): Promise<void> {
        if (dia === state.diaAtivo) return;
        state.diaAtivo = dia;
        state.fotos = [];
        state.offset = 0;
        state.acabou = false;
        state.aberta = null;
        await actions.carregarMais();
    },

    async carregarMais(): Promise<void> {
        state.carregando = true;
        state.mensagem = "";
        try {
            const pagina = await getGaleria(state.entrada, state.offset, state.diaAtivo ?? undefined);
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

    podeCompartilhar(): boolean {
        return podeCompartilharArquivos();
    },

    prontaParaCompartilhar(): boolean {
        return state.compartilharPronto !== null && state.compartilharPronto === state.aberta;
    },

    // `dl=1` faz o nginx responder como anexo; fica fora da assinatura, que cobre só o caminho.
    salvar(): void {
        const foto = state.aberta === null ? undefined : state.fotos[state.aberta];
        if (foto) baixarArquivo(`${foto.web}&dl=1`);
    },

    async compartilhar(): Promise<void> {
        const indice = state.aberta;
        const foto = indice === null ? undefined : state.fotos[indice];
        if (indice === null || !foto || !podeCompartilharArquivos()) return;

        const pronta = prontaParaEnvio?.indice === indice ? prontaParaEnvio : null;
        prontaParaEnvio = null;
        state.compartilharPronto = null;

        try {
            const resultado = await compartilharFoto({
                url: foto.web,
                nomeArquivo: `foto-${foto.id_foto}.jpg`,
                titulo: state.nomeEvento,
                arquivoPronto: pronta?.arquivo,
            });
            if (resultado.situacao === "toqueDeNovo") {
                prontaParaEnvio = { indice, arquivo: resultado.arquivo, url: foto.web };
                state.compartilharPronto = indice;
            }
        } catch {
            // Qualquer outra recusa: a pessoa fica com a foto baixada em vez de um botão mudo.
            baixarArquivo(`${foto.web}&dl=1`);
        }
    },
};
