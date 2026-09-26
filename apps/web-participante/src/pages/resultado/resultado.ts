import { reactive } from "vue";
import { router } from "../../router";
import { baixarArquivo } from "../../ts/arquivos";
import { esperarPartes } from "../../ts/zip";
import type { FotoDoResultado } from "./interfaces";
import { getResultado, gerarLinks, pedirZip, situacaoZip } from "./services/resultado.service";

// O ZIP de uma busca é pequeno: um minuto de espera cobre o worker com folga.
const ESPERA_ZIP = { tentativas: 60, esperaMs: 1000 };

export const state = reactive({
    token: "",
    carregando: true,
    evento: "",
    slug: "",
    fotos: [] as FotoDoResultado[],
    validadeAte: null as string | null,
    mensagem: "",
    aberta: null as number | null,
    zip: "nenhum" as "nenhum" | "montando" | "pronto",
    urlsZip: [] as string[],
});

export function validadeParaTela(validadeAte: string | null): string {
    return validadeAte ? new Date(validadeAte).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "";
}

function foiCancelado(erro: unknown): boolean {
    return erro instanceof DOMException && erro.name === "AbortError";
}

export const actions = {
    async init(token: string): Promise<void> {
        state.token = token;
        state.carregando = true;
        state.mensagem = "";
        state.aberta = null;
        state.zip = "nenhum";
        state.urlsZip = [];
        // Guardado para o "buscar de novo" mandar como token_origem — é o que dispensa
        // refazer a verificação quando ela existir.
        sessionStorage.setItem("busca_anterior", token);
        try {
            const resposta = await getResultado(token);
            state.evento = resposta.evento.nome;
            state.slug = resposta.evento.slug;
            state.fotos = resposta.fotos;
            state.validadeAte = resposta.validade_ate;
        } catch (erro) {
            state.fotos = [];
            state.mensagem = erro instanceof Error ? erro.message : "Não conseguimos abrir suas fotos.";
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

    // O navigator.share do computador existe mas recusa anexo; por isso a pergunta é se ele
    // aceita um arquivo, não só se a função existe.
    podeCompartilhar(): boolean {
        const nav = globalThis.navigator as Navigator | undefined;
        if (typeof nav?.share !== "function" || typeof nav.canShare !== "function") return false;
        return nav.canShare({ files: [new File([], "foto.jpg", { type: "image/jpeg" })] });
    },

    async linkDaFoto(indice: number): Promise<string | null> {
        const foto = state.fotos[indice];
        if (!foto) return null;
        const { links } = await gerarLinks(state.token, [foto.id_foto]);
        return links[0]?.url ?? null;
    },

    // Erro no meio da foto aberta (prazo venceu enquanto ela olhava): a foto fecha para o
    // recado aparecer, em vez de o botão não fazer nada.
    mostrarFalha(erro: unknown): void {
        state.aberta = null;
        state.mensagem = erro instanceof Error ? erro.message : "Não conseguimos baixar a foto.";
    },

    async salvar(indice: number): Promise<void> {
        try {
            const url = await actions.linkDaFoto(indice);
            if (url) baixarArquivo(url);
        } catch (erro) {
            actions.mostrarFalha(erro);
        }
    },

    async compartilhar(indice: number): Promise<void> {
        const foto = state.fotos[indice];
        if (!foto || !actions.podeCompartilhar()) return;

        let url: string | null = null;
        try {
            url = await actions.linkDaFoto(indice);
            if (!url) return;

            // Baixa o arquivo para poder anexar: compartilhar só o link faria a pessoa mandar
            // uma URL que vence em uma hora.
            const resposta = await fetch(url);
            const arquivo = new File([await resposta.blob()], `foto-${foto.id_foto}.jpg`, { type: "image/jpeg" });
            await navigator.share({ files: [arquivo], title: state.evento });
        } catch (erro) {
            if (foiCancelado(erro)) return;
            // O navegador pode recusar o menu (o toque "venceu" enquanto a foto baixava): a
            // pessoa fica com a foto salva em vez de um botão que não respondeu.
            if (url) baixarArquivo(url);
            else actions.mostrarFalha(erro);
        }
    },

    async pedirZip(): Promise<void> {
        state.zip = "montando";
        state.mensagem = "";
        try {
            const { partes } = await pedirZip(state.token);
            const resultado = await esperarPartes(partes, (id) => situacaoZip(state.token, id), ESPERA_ZIP);
            if (resultado.situacao === "pronto") {
                state.urlsZip = resultado.urls;
                state.zip = "pronto";
                return;
            }
            state.zip = "nenhum";
            state.mensagem = "Não conseguimos montar o ZIP agora. Baixe as fotos uma a uma ou tente mais tarde.";
        } catch (erro) {
            state.zip = "nenhum";
            state.mensagem = erro instanceof Error ? erro.message : "Não conseguimos montar o ZIP.";
        }
    },

    // Quem veio da câmera volta para ela (vale também para evento privado). Quem reabriu o
    // link dias depois não tem tela anterior: vai para a câmera do evento pelo slug.
    temCaminhoParaCamera(): boolean {
        return Boolean(router.options.history.state.back) || Boolean(state.slug);
    },

    voltarParaCamera(): void {
        if (router.options.history.state.back) router.back();
        else if (state.slug) router.push({ name: "evento", params: { slug: state.slug } });
    },
};
