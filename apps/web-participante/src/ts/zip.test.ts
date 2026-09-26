import { describe, expect, test, vi } from "vitest";
import { esperarPartes } from "./zip";

const rapido = { tentativas: 3, esperaMs: 0 };

describe("esperarPartes", () => {
    test("espera cada parte ficar pronta e devolve os links na ordem das partes", async () => {
        const consultar = vi
            .fn()
            .mockResolvedValueOnce({ status: "pendente" })
            .mockResolvedValueOnce({ status: "pronto", url: "/z/1.zip" })
            .mockResolvedValueOnce({ status: "pronto", url: "/z/2.zip" });

        const r = await esperarPartes([1, 2], consultar, rapido);

        expect(r).toEqual({ situacao: "pronto", urls: ["/z/1.zip", "/z/2.zip"] });
    });

    test("uma parte com erro faz o ZIP inteiro falhar", async () => {
        const consultar = vi.fn(async (id: number) => (id === 2 ? { status: "erro" } : { status: "pronto", url: "/z/1.zip" }));

        expect(await esperarPartes([1, 2], consultar, rapido)).toEqual({ situacao: "erro" });
    });

    test("parte que não fica pronta a tempo é 'demorou', não erro", async () => {
        // O ZIP do evento inteiro pode levar minutos: quem volta depois e pede de novo recebe
        // o mesmo arquivo, então a tela precisa saber que não foi falha.
        const consultar = vi.fn().mockResolvedValue({ status: "pendente" });

        expect(await esperarPartes([1], consultar, rapido)).toEqual({ situacao: "demorou" });
        expect(consultar).toHaveBeenCalledTimes(3);
    });
});
