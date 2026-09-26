import { reactive } from "vue";
import { dimensoesReduzidas } from "../../ts/imagem";

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

        const { largura, altura } = dimensoesReduzidas(video.videoWidth, video.videoHeight, LADO_MAIOR_ENVIO);
        const tela = document.createElement("canvas");
        tela.width = largura;
        tela.height = altura;
        tela.getContext("2d")?.drawImage(video, 0, 0, largura, altura);

        const pedaco = await new Promise<Blob | null>((resolve) => tela.toBlob(resolve, "image/jpeg", 0.88));
        if (!pedaco) {
            state.mensagem = "Não conseguimos usar essa foto. Tente de novo.";
            return;
        }

        state.selfies = [...state.selfies, new File([pedaco], "selfie.jpg", { type: "image/jpeg" })].slice(0, state.maxSelfies);
    },

    encerrarCamera(): void {
        for (const trilha of state.fluxo?.getTracks() ?? []) trilha.stop();
        state.fluxo = null;
    },

    tentarDeNovo(): void {
        state.selfies = [];
        state.mensagem = "";
        state.etapa = "camera";
    },
};
