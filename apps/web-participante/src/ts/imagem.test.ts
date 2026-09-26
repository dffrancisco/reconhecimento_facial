import { afterEach, describe, expect, test, vi } from "vitest";
import { dimensoesReduzidas, reduzirSelfie } from "./imagem";

describe("dimensoesReduzidas", () => {
    test("reduz o lado maior até o limite, mantendo a proporção", () => {
        // Selfie de celular em pé: 3024x4032 vira 960x1280.
        expect(dimensoesReduzidas(3024, 4032, 1280)).toEqual({ largura: 960, altura: 1280 });
    });

    test("reduz pelo lado maior quando a foto é deitada", () => {
        expect(dimensoesReduzidas(4032, 3024, 1280)).toEqual({ largura: 1280, altura: 960 });
    });

    test("não amplia foto menor que o limite", () => {
        expect(dimensoesReduzidas(640, 480, 1280)).toEqual({ largura: 640, altura: 480 });
    });

    test("arredonda para inteiro, porque canvas não aceita fração", () => {
        const r = dimensoesReduzidas(1000, 333, 500);
        expect(Number.isInteger(r.largura)).toBe(true);
        expect(Number.isInteger(r.altura)).toBe(true);
    });

    test("imagem quadrada continua quadrada", () => {
        expect(dimensoesReduzidas(2000, 2000, 1280)).toEqual({ largura: 1280, altura: 1280 });
    });
});

describe("reduzirSelfie", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    test("foto da galeria sai em JPEG com o lado maior em 1280", async () => {
        // Foto de galeria pode passar de 8 MB, que a API recusa; reduzida, ela sobe em segundos.
        const fechar = vi.fn();
        vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 4032, height: 3024, close: fechar }));
        const desenhar = vi.fn();
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage: desenhar } as never);
        vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((pronto) => pronto(new Blob([new Uint8Array([7])], { type: "image/jpeg" })));
        const original = new File([new Uint8Array(10)], "IMG_0001.HEIC", { type: "image/heic" });

        const reduzida = await reduzirSelfie(original);

        expect(reduzida.type).toBe("image/jpeg");
        expect(reduzida.name).toBe("selfie.jpg");
        expect(desenhar).toHaveBeenCalledWith(expect.anything(), 0, 0, 1280, 960);
        expect(fechar).toHaveBeenCalled();
    });

    test("se o navegador não consegue ler a foto, manda a original e deixa a API decidir", async () => {
        vi.stubGlobal("createImageBitmap", vi.fn().mockRejectedValue(new Error("formato desconhecido")));
        const original = new File([new Uint8Array(10)], "x.jpg", { type: "image/jpeg" });

        expect(await reduzirSelfie(original)).toBe(original);
    });
});
