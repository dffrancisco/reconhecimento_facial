import { afterEach, describe, expect, test, vi } from "vitest";
import { telaDeComputador } from "./aparelho";

afterEach(() => vi.unstubAllGlobals());

describe("telaDeComputador", () => {
    test("tela larga com mouse é computador", () => {
        vi.stubGlobal("matchMedia", (consulta: string) => ({ matches: true, media: consulta }));
        expect(telaDeComputador()).toBe(true);
    });

    test("tela pequena ou de toque não é", () => {
        vi.stubGlobal("matchMedia", (consulta: string) => ({ matches: false, media: consulta }));
        expect(telaDeComputador()).toBe(false);
    });

    test("pergunta pela largura e pelo mouse, não só pela largura", () => {
        // Um tablet deitado passa de 1024 px, mas é de toque: fica com a lista do celular.
        const consultas: string[] = [];
        vi.stubGlobal("matchMedia", (consulta: string) => {
            consultas.push(consulta);
            return { matches: false, media: consulta };
        });

        telaDeComputador();

        expect(consultas[0]).toContain("min-width");
        expect(consultas[0]).toContain("hover: hover");
    });

    test("navegador sem matchMedia fica com a lista", () => {
        vi.stubGlobal("matchMedia", undefined);
        expect(telaDeComputador()).toBe(false);
    });
});
