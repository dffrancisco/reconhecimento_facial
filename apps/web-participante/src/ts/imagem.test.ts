import { describe, expect, test } from "vitest";
import { dimensoesReduzidas } from "./imagem";

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
