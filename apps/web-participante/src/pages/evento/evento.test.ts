import { beforeEach, describe, expect, test, vi } from "vitest";
import { actions, state } from "./evento";
import { buscarPorSelfie } from "./services/evento.service";
import { ErroDaApi } from "../../ts/api";

vi.mock("./services/evento.service", () => ({ buscarPorSelfie: vi.fn() }));

const irPara = vi.fn();
vi.mock("../../router", () => ({ router: { push: (destino: unknown) => irPara(destino) } }));

function fluxoFalso() {
    const trilha = { stop: vi.fn() };
    return { trilha, fluxo: { getTracks: () => [trilha] } as unknown as MediaStream };
}

describe("tela do evento", () => {
    beforeEach(() => {
        state.etapa = "camera";
        state.consentiu = false;
        state.selfies = [];
        state.mensagem = "";
        state.maxSelfies = 3;
        state.lado = "user";
        state.fluxo = null;
    });

    test("começa sem consentimento: o disparo não pode funcionar", () => {
        expect(state.consentiu).toBe(false);
        expect(actions.podeDisparar()).toBe(false);
    });

    test("com o visto marcado, o disparo libera", () => {
        state.consentiu = true;
        expect(actions.podeDisparar()).toBe(true);
    });

    test("com o limite de selfies atingido, o disparo trava em vez de descartar a foto", () => {
        const arquivo = () => new File([new Uint8Array([1])], "s.jpg", { type: "image/jpeg" });
        state.consentiu = true;
        state.maxSelfies = 2;
        state.selfies = [arquivo(), arquivo()];

        expect(actions.podeDisparar()).toBe(false);
    });

    test("permissão de câmera negada leva ao caminho da galeria, não a uma tela morta", async () => {
        // É o risco conhecido de abrir direto na câmera: parte das pessoas nega por reflexo.
        vi.stubGlobal("navigator", {
            mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(new Error("NotAllowedError")) },
        });

        await actions.pedirCamera();

        expect(state.etapa).toBe("semCamera");
        expect(state.mensagem).toContain("galeria");
    });

    test("navegador sem suporte a câmera cai no mesmo caminho", async () => {
        vi.stubGlobal("navigator", {});

        await actions.pedirCamera();

        expect(state.etapa).toBe("semCamera");
    });

    test("virar troca para a câmera traseira e desliga a da frente", async () => {
        // Às vezes é um amigo que tira a foto: a câmera de trás é melhor e o corredor não vira.
        const frente = fluxoFalso();
        const getUserMedia = vi.fn().mockResolvedValue(fluxoFalso().fluxo);
        vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
        state.fluxo = frente.fluxo;

        await actions.virarCamera();

        expect(frente.trilha.stop).toHaveBeenCalled();
        expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: "environment" }, audio: false });
        expect(state.lado).toBe("environment");
    });

    test("voltar para a tela depois de uma busca recomeça na câmera, com o visto mantido", async () => {
        // O resultado volta para cá com "buscar de novo": sem recomeçar, a tela ficaria
        // presa em "Procurando você".
        vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(fluxoFalso().fluxo) } });
        state.etapa = "buscando";
        state.consentiu = true;
        state.selfies = [new File([new Uint8Array([1])], "s.jpg", { type: "image/jpeg" })];
        state.mensagem = "qualquer";

        await actions.init();

        expect(state.etapa).toBe("camera");
        expect(state.selfies).toHaveLength(0);
        expect(state.mensagem).toBe("");
        expect(state.consentiu).toBe(true);
    });

    test("escolher da galeria guarda o arquivo e sai do estado sem câmera", () => {
        const arquivo = new File([new Uint8Array([1, 2, 3])], "selfie.jpg", { type: "image/jpeg" });
        state.etapa = "semCamera";

        actions.escolherDaGaleria([arquivo]);

        expect(state.selfies).toHaveLength(1);
        expect(state.selfies[0].type).toBe("image/jpeg");
    });

    test("respeita o limite de selfies do evento", () => {
        const arquivo = () => new File([new Uint8Array([1])], "s.jpg", { type: "image/jpeg" });
        state.maxSelfies = 2;

        actions.escolherDaGaleria([arquivo(), arquivo(), arquivo()]);

        expect(state.selfies).toHaveLength(2);
    });
});

describe("envio da selfie", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.etapa = "camera";
        state.consentiu = true;
        state.mensagem = "";
        state.selfies = [new File([new Uint8Array([1])], "selfie.jpg", { type: "image/jpeg" })];
        state.slug = "corrida-da-serra";
        state.fluxo = null;
    });

    test("busca liberada leva para a tela de resultado", async () => {
        vi.mocked(buscarPorSelfie).mockResolvedValue({ token: "tok123", status: "liberada", qtd_fotos: 12, previas: [] });

        await actions.buscar();

        expect(irPara).toHaveBeenCalledWith({ name: "resultado", params: { token: "tok123" } });
    });

    test("busca aguardando confirmação não leva a um resultado que diria 'não achamos'", async () => {
        // Evento de corrida nasce exigindo WhatsApp, e essa etapa ainda não existe: quem tem
        // fotos cairia num "não encontramos suas fotos" falso.
        vi.mocked(buscarPorSelfie).mockResolvedValue({ token: "tokA", status: "aguardando", qtd_fotos: 4, previas: [] });

        await actions.buscar();

        expect(irPara).not.toHaveBeenCalled();
        expect(state.etapa).toBe("erro");
        expect(state.mensagem).toContain("organização");
    });

    test("guarda por onde a pessoa entrou, para o resultado reaberto saber voltar à câmera", async () => {
        // Evento privado só abre por /p/<chave>: pelo slug a API recusa.
        state.slug = "";
        state.chaveAcesso = "chave-privada";
        vi.mocked(buscarPorSelfie).mockResolvedValue({ token: "tokP", status: "liberada", qtd_fotos: 2, previas: [] });

        await actions.buscar();

        expect(localStorage.getItem("entrada:tokP")).toBe("/p/chave-privada");
        localStorage.clear();
    });

    test("mostra a busca em curso enquanto espera", async () => {
        let liberar: (valor: unknown) => void = () => {};
        vi.mocked(buscarPorSelfie).mockReturnValue(new Promise((resolve) => (liberar = resolve)) as never);

        const emCurso = actions.buscar();
        expect(state.etapa).toBe("buscando");

        liberar({ token: "t", status: "liberada", qtd_fotos: 0, previas: [] });
        await emCurso;
    });

    test("selfie recusada mostra a mensagem da API e mantém o consentimento", async () => {
        // A pessoa não pode ter que marcar o visto de novo por causa de uma foto tremida.
        vi.mocked(buscarPorSelfie).mockRejectedValue(new ErroDaApi("A foto ficou tremida. Segure o celular firme."));

        await actions.buscar();

        expect(state.etapa).toBe("erro");
        expect(state.mensagem).toContain("tremida");
        expect(state.consentiu).toBe(true);
    });

    test("queda de rede não descarta a selfie já tirada", async () => {
        vi.mocked(buscarPorSelfie).mockRejectedValue(new ErroDaApi("Perdemos a conexão. Tente de novo."));

        await actions.buscar();

        expect(state.mensagem).toContain("conexão");
        expect(state.selfies).toHaveLength(1);
    });

    test("tentar de novo depois da queda reenvia a mesma selfie, sem pedir outra", async () => {
        vi.mocked(buscarPorSelfie).mockRejectedValueOnce(new ErroDaApi("Perdemos a conexão. Tente de novo."));
        vi.mocked(buscarPorSelfie).mockResolvedValueOnce({ token: "tok9", status: "liberada", qtd_fotos: 2, previas: [] });
        const selfie = state.selfies[0];

        await actions.buscar();
        await actions.buscar();

        expect(vi.mocked(buscarPorSelfie).mock.calls[1][0].selfies[0]).toBe(selfie);
        expect(irPara).toHaveBeenCalledWith({ name: "resultado", params: { token: "tok9" } });
    });

    test("o buscar de novo manda o token da busca anterior", async () => {
        // Sem isso, quem já se verificou teria que se verificar de novo a cada busca.
        sessionStorage.setItem("busca_anterior", "tok-anterior");
        vi.mocked(buscarPorSelfie).mockResolvedValue({ token: "tok2", status: "liberada", qtd_fotos: 3, previas: [] });

        await actions.buscar();

        expect(vi.mocked(buscarPorSelfie).mock.calls[0][0].tokenOrigem).toBe("tok-anterior");
        sessionStorage.clear();
    });

    test("não envia sem selfie nenhuma", async () => {
        state.selfies = [];

        await actions.buscar();

        expect(buscarPorSelfie).not.toHaveBeenCalled();
    });

    test("não envia sem o visto de consentimento", async () => {
        state.consentiu = false;

        await actions.buscar();

        expect(buscarPorSelfie).not.toHaveBeenCalled();
    });

    test("evento privado aberto pelo slug mostra o recado da API e não abre a câmera", async () => {
        vi.mocked(buscarPorSelfie).mockRejectedValue(new ErroDaApi("Evento não encontrado. Confira o link."));

        await actions.buscar();

        expect(state.etapa).toBe("erro");
        expect(state.mensagem).toContain("Evento não encontrado");
    });

    test("escolher da galeria já parte para a busca", async () => {
        // Quem negou a câmera só tem a galeria: escolher a foto é o último passo dela.
        const daGaleria = new File([new Uint8Array([9])], "da-galeria.jpg", { type: "image/jpeg" });
        state.selfies = [];
        vi.mocked(buscarPorSelfie).mockResolvedValue({ token: "tok3", status: "liberada", qtd_fotos: 1, previas: [] });

        await actions.usarDaGaleria([daGaleria]);

        expect(vi.mocked(buscarPorSelfie).mock.calls[0][0].selfies).toHaveLength(1);
        expect(irPara).toHaveBeenCalledWith({ name: "resultado", params: { token: "tok3" } });
    });

    test("tentar outra selfie sem câmera volta para a galeria, não para uma câmera preta", async () => {
        vi.stubGlobal("navigator", {
            mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(new Error("NotAllowedError")) },
        });
        state.etapa = "erro";
        state.mensagem = "Não encontramos um rosto na foto.";

        await actions.tentarDeNovo();

        expect(state.etapa).toBe("semCamera");
        expect(state.selfies).toHaveLength(0);
        expect(state.mensagem).toContain("galeria");
    });
});
