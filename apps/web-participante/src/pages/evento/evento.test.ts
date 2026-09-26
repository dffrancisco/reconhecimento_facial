import { beforeEach, describe, expect, test, vi } from "vitest";
import { actions, state } from "./evento";

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
