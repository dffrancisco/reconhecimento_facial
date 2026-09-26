import { reactive } from "vue";
import { router } from "../../router";
import { guardarEntrada } from "../../ts/entrada";
import { dimensoesReduzidas, jpegDoCanvas, reduzirSelfie } from "../../ts/imagem";
import { buscarPorSelfie } from "./services/evento.service";

export const VERSAO_TERMO = "v1";
const LADO_MAIOR_ENVIO = 1280;

export const state = reactive({
    etapa: "camera" as "camera" | "semCamera" | "buscando" | "erro",
    consentiu: false,
    selfies: [] as File[],
    mensagem: "",
    nomeEvento: "",
    totalFotos: 0,
    maxSelfies: 3,
    lado: "user" as "user" | "environment",
    fluxo: null as MediaStream | null,
    slug: "",
    chaveAcesso: "",
});

export const actions = {
    // O state vive enquanto a página estiver aberta: quem volta do resultado ("buscar de
    // novo") recomeça na câmera. O visto fica, porque a pessoa já o deu nesta visita.
    async init(): Promise<void> {
        state.etapa = "camera";
        state.selfies = [];
        state.mensagem = "";
        await actions.pedirCamera();
    },

    podeDisparar(): boolean {
        return state.consentiu && state.selfies.length < state.maxSelfies;
    },

    // Abrir direto na câmera é o caminho mais rápido, mas parte das pessoas nega a permissão
    // por reflexo: quem negar precisa cair num lugar com saída, nunca numa tela preta.
    async pedirCamera(): Promise<void> {
        const midia = (globalThis.navigator as Navigator | undefined)?.mediaDevices;
        if (!midia?.getUserMedia) {
            state.etapa = "semCamera";
            state.mensagem = "Seu navegador não abre a câmera aqui. Escolha uma selfie da galeria.";
            return;
        }

        try {
            state.fluxo = await midia.getUserMedia({ video: { facingMode: state.lado }, audio: false });
            state.etapa = "camera";
        } catch {
            state.etapa = "semCamera";
            state.mensagem = "Precisamos de uma selfie para achar suas fotos. Escolha uma da galeria.";
        }
    },

    async virarCamera(): Promise<void> {
        actions.encerrarCamera();
        state.lado = state.lado === "user" ? "environment" : "user";
        await actions.pedirCamera();
    },

    escolherDaGaleria(arquivos: File[]): void {
        state.selfies = arquivos.slice(0, state.maxSelfies);
        state.mensagem = "";
    },

    async disparar(video: HTMLVideoElement): Promise<void> {
        if (!actions.podeDisparar()) return;

        const selfie = await jpegDoCanvas(video, dimensoesReduzidas(video.videoWidth, video.videoHeight, LADO_MAIOR_ENVIO));
        if (!selfie) {
            state.mensagem = "Não conseguimos usar essa foto. Tente de novo.";
            return;
        }

        state.selfies = [...state.selfies, selfie].slice(0, state.maxSelfies);
    },

    // Quem negou a câmera só tem a galeria: escolher a foto é o último passo, então a busca
    // já parte daqui.
    async usarDaGaleria(arquivos: File[]): Promise<void> {
        const reduzidas = await Promise.all(arquivos.slice(0, state.maxSelfies).map((arquivo) => reduzirSelfie(arquivo, LADO_MAIOR_ENVIO)));
        actions.escolherDaGaleria(reduzidas);
        await actions.buscar();
    },

    async buscar(): Promise<void> {
        if (state.selfies.length === 0 || !state.consentiu) return;

        state.etapa = "buscando";
        state.mensagem = "";
        try {
            const resposta = await buscarPorSelfie({
                slug: state.slug || undefined,
                chaveAcesso: state.chaveAcesso || undefined,
                versaoTermo: VERSAO_TERMO,
                selfies: state.selfies,
                tokenOrigem: sessionStorage.getItem("busca_anterior") ?? undefined,
            });

            // A confirmação por WhatsApp é da parte 2: um evento que ainda a exige devolve
            // `aguardando` (só acontece com fotos achadas), e o resultado responderia "não
            // encontramos suas fotos" a quem tem fotos.
            if (resposta.status === "aguardando") {
                state.etapa = "erro";
                state.mensagem =
                    "Achamos fotos suas, mas este evento pede uma confirmação que ainda não está disponível por aqui. Avise a organização do evento.";
                return;
            }

            actions.encerrarCamera();
            guardarEntrada(resposta.token, state.chaveAcesso ? `/p/${state.chaveAcesso}` : `/e/${state.slug}`);
            // Mesmo com zero fotos a busca é `liberada`: a tela de resultado é que mostra
            // o "ainda não achamos você" (spec da plataforma §8).
            router.push({ name: "resultado", params: { token: resposta.token } });
        } catch (erro) {
            // A selfie e o consentimento continuam de pé: "Tentar de novo" reenvia a mesma foto.
            state.etapa = "erro";
            state.mensagem = erro instanceof Error ? erro.message : "Não conseguimos completar. Tente de novo.";
        }
    },

    encerrarCamera(): void {
        for (const trilha of state.fluxo?.getTracks() ?? []) trilha.stop();
        state.fluxo = null;
    },

    // "Tentar outra selfie": com a câmera ainda ligada volta direto para ela; sem câmera,
    // pedirCamera() leva de novo ao caminho da galeria, com a explicação.
    async tentarDeNovo(): Promise<void> {
        state.selfies = [];
        state.mensagem = "";
        if (state.fluxo) state.etapa = "camera";
        else await actions.pedirCamera();
    },
};
