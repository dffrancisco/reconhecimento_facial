import { reactive } from "vue";
import { router } from "../../router";
import { baixarArquivo } from "../../ts/arquivos";
import { entradaDaBusca } from "../../ts/entrada";
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
    compartilharPronto: null as number | null,
});

// Foto já baixada cujo menu de compartilhar o navegador recusou. Fica fora do state: um File
// dentro do reactive vira Proxy, e o navigator.share não aceita Proxy.
let prontaParaEnvio: { indice: number; arquivo: File; url: string } | null = null;

export function validadeParaTela(validadeAte: string | null): string {
    return validadeAte ? new Date(validadeAte).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "";
}

function foiCancelado(erro: unknown): boolean {
    return erro instanceof DOMException && erro.name === "AbortError";
}

function recusadoPorFaltaDeToque(erro: unknown): boolean {
    return erro instanceof DOMException && erro.name === "NotAllowedError";
}

export const actions = {
    async init(token: string): Promise<void> {
        state.token = token;
        state.carregando = true;
        state.mensagem = "";
        state.evento = "";
        state.slug = "";
        state.aberta = null;
        state.zip = "nenhum";
        state.urlsZip = [];
        state.compartilharPronto = null;
        prontaParaEnvio = null;
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

    prontaParaCompartilhar(): boolean {
        return state.compartilharPronto !== null && state.compartilharPronto === state.aberta;
    },

    async compartilhar(indice: number): Promise<void> {
        const foto = state.fotos[indice];
        if (!foto || !actions.podeCompartilhar()) return;

        const pronta = prontaParaEnvio?.indice === indice ? prontaParaEnvio : null;
        prontaParaEnvio = null;
        state.compartilharPronto = null;

        let url = pronta?.url ?? null;
        let arquivo = pronta?.arquivo ?? null;
        try {
            if (!arquivo) {
                url = await actions.linkDaFoto(indice);
                if (!url) return;

                // Baixa o arquivo para poder anexar: compartilhar só o link faria a pessoa
                // mandar uma URL que vence em uma hora.
                const resposta = await fetch(url);
                if (!resposta.ok) throw new Error(`A foto respondeu ${resposta.status}.`);
                arquivo = new File([await resposta.blob()], `foto-${foto.id_foto}.jpg`, { type: "image/jpeg" });
            }
            await navigator.share({ files: [arquivo], title: state.evento });
        } catch (erro) {
            if (foiCancelado(erro)) return;
            // No iPhone o menu só abre colado no toque, e baixar a foto pode passar desse
            // tempo. Com a foto já em mãos, o segundo toque abre o menu na hora — baixar para
            // Arquivos no lugar não põe a foto na galeria.
            if (!pronta && arquivo && url && recusadoPorFaltaDeToque(erro)) {
                prontaParaEnvio = { indice, arquivo, url };
                state.compartilharPronto = indice;
                return;
            }
            // Qualquer outra recusa: a pessoa fica com a foto salva em vez de um botão mudo.
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

    // Quem veio da câmera volta para ela. Quem reabriu o link dias depois não tem tela
    // anterior: vai pela entrada guardada na busca (vale para evento privado) e, sem ela,
    // pela câmera do evento pelo slug.
    temCaminhoParaCamera(): boolean {
        return Boolean(router.options.history.state.back) || Boolean(entradaDaBusca(state.token)) || Boolean(state.slug);
    },

    voltarParaCamera(): void {
        const entrada = entradaDaBusca(state.token);
        if (router.options.history.state.back) router.back();
        else if (entrada) router.push(entrada);
        else if (state.slug) router.push({ name: "evento", params: { slug: state.slug } });
    },
};
