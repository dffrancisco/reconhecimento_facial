import { describe, expect, test } from "vitest";
import { estadoConexao, tempoRestante } from "./tempo";

describe("tempoRestante", () => {
    test("sem velocidade medida ainda, não chuta", () => {
        expect(tempoRestante(1000, 0)).toBe("—");
    });

    test("menos de um minuto e minutos arredondados", () => {
        expect(tempoRestante(30, 1)).toBe("menos de 1 min");
        expect(tempoRestante(250, 1)).toBe("cerca de 4 min");
    });
});

describe("estadoConexao", () => {
    test("conectado, tentando e, depois de 1 minuto, alerta", () => {
        expect(estadoConexao(null, 10_000)).toBe("conectado");
        expect(estadoConexao(10_000, 50_000)).toBe("tentando");
        expect(estadoConexao(10_000, 71_000)).toBe("alerta");
    });
});
