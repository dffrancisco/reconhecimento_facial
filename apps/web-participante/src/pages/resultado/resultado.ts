import { reactive } from "vue";
import { router } from "../../router";
import { ErroDaApi } from "../../ts/api";
import { baixarArquivo } from "../../ts/arquivos";
import { buscarPorSelfie, VERSAO_TERMO } from "../../ts/busca";
import { compartilharFoto, podeCompartilharArquivos } from "../../ts/compartilhar";
import { entradaDaBusca, guardarEntrada } from "../../ts/entrada";
import { atualizarMemoria, guardarMemoria, limparMemoria, memoriaDoEvento } from "../../ts/memoria";
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
    rebuscando: false,
    // Separada de `mensagem` (que é do ZIP e de outras ações): sem isso, uma falha ao montar
    // o ZIP também acendia o botão "Tirar outra selfie", que só faz sentido para a rebusca.
    mensagemRebusca: "",
});

// Foto já baixada cujo menu de compartilhar o navegador recusou. Fica fora do state: um File
// dentro do reactive vira Proxy, e o navigator.share não aceita Proxy.
let prontaParaEnvio: { indice: number; arquivo: File; url: string } | null = null;

export function validadeParaTela(validadeAte: string | null): string {
    return validadeAte ? new Date(validadeAte).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "";
}

// O caminho de entrada é o elo com a memória: vem da busca guardada e, sem ela, do slug
// público que o resultado conhece.
function caminhoDoEvento(): string | null {
    return entradaDaBusca(state.token) ?? (state.slug ? `/e/${state.slug}` : null);
}

export const actions = {
    async init(token: string): Promise<void> {
        state.token = token;
        state.carregando = true;
        state.mensagem = "";
        state.mensagemRebusca = "";
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

            const caminho = caminhoDoEvento();
            if (caminho) {
                const memoria = await memoriaDoEvento(caminho);
                if (memoria?.token === token)
                    await atualizarMemoria(caminho, { validade_ate: resposta.validade_ate, qtd_fotos: resposta.fotos.length });
            }
        } catch (erro) {
            state.fotos = [];
            state.mensagem = erro instanceof Error ? erro.message : "Não conseguimos abrir suas fotos.";

            const caminho = caminhoDoEvento();
            if (caminho && erro instanceof ErroDaApi) {
                const memoria = await memoriaDoEvento(caminho);
                // Só a memória deste token: o servidor recusou, o atalho local morreu com ele.
                if (memoria?.token === token) await limparMemoria(caminho);
            }
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

    podeCompartilhar(): boolean {
        return podeCompartilharArquivos();
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
        if (!foto || !podeCompartilharArquivos()) return;

        const pronta = prontaParaEnvio?.indice === indice ? prontaParaEnvio : null;
        prontaParaEnvio = null;
        state.compartilharPronto = null;

        let url = pronta?.url ?? null;
        try {
            if (!url) url = await actions.linkDaFoto(indice);
            if (!url) return;

            const resultado = await compartilharFoto({
                url,
                nomeArquivo: `foto-${foto.id_foto}.jpg`,
                titulo: state.evento,
                arquivoPronto: pronta?.arquivo,
            });
            if (resultado.situacao === "toqueDeNovo") {
                prontaParaEnvio = { indice, arquivo: resultado.arquivo, url };
                state.compartilharPronto = indice;
            }
        } catch (erro) {
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

    // "Buscar de novo" sem câmera: reenvia a selfie que ficou no aparelho. Sem selfie
    // guardada (aba anônima, memória limpa), o caminho antigo — a câmera — continua valendo.
    async rebuscar(): Promise<void> {
        const caminho = caminhoDoEvento();
        const memoria = caminho ? await memoriaDoEvento(caminho) : null;
        if (!caminho || !memoria?.selfie) {
            actions.voltarParaCamera();
            return;
        }

        state.rebuscando = true;
        state.mensagemRebusca = "";
        try {
            const resposta = await buscarPorSelfie({
                slug: caminho.startsWith("/e/") ? caminho.slice(3) : undefined,
                chaveAcesso: caminho.startsWith("/p/") ? caminho.slice(3) : undefined,
                versaoTermo: VERSAO_TERMO,
                selfies: [new File([memoria.selfie], "selfie.jpg", { type: "image/jpeg" })],
                tokenOrigem: state.token,
            });
            if (resposta.status === "aguardando") {
                state.mensagemRebusca = "Este evento pede uma confirmação que ainda não está disponível por aqui. Avise a organização.";
                return;
            }
            guardarEntrada(resposta.token, caminho);
            await guardarMemoria(caminho, {
                ...memoria,
                token: resposta.token,
                qtd_fotos: resposta.qtd_fotos,
                validade_ate: null,
                criado_em: new Date().toISOString(),
            });
            router.replace({ name: "resultado", params: { token: resposta.token } });
            await actions.init(resposta.token);
        } catch (erro) {
            state.mensagemRebusca = erro instanceof Error ? erro.message : "Não conseguimos buscar de novo. Tente outra selfie.";
        } finally {
            state.rebuscando = false;
        }
    },

    // A home agora ocupa /e/<slug>: a câmera é sempre <caminho>/selfie. O history.back
    // saiu porque o "voltar" pode ser a home, não a câmera.
    temCaminhoParaCamera(): boolean {
        return Boolean(caminhoDoEvento());
    },

    voltarParaCamera(): void {
        const caminho = caminhoDoEvento();
        if (caminho) router.push(`${caminho}/selfie`);
    },
};
