import { describe, expect, test } from "vitest";
import { periodoParaTela, rotuloDoDia } from "./dias";

describe("rotuloDoDia", () => {
    // 2026-09-26 é um sábado. Montado por partes: new Date("2026-09-26") seria meia-noite
    // UTC e viraria sexta à noite no Brasil.
    test("dia vira rótulo com dia da semana", () => {
        expect(rotuloDoDia("2026-09-26")).toBe("Sáb 26/09");
        expect(rotuloDoDia("2026-09-27")).toBe("Dom 27/09");
    });

    test("valor fora do formato volta como veio", () => {
        expect(rotuloDoDia("sem-data")).toBe("sem-data");
    });
});

describe("periodoParaTela", () => {
    test("dois dias no mesmo mês", () => {
        expect(periodoParaTela("2026-09-26", "2026-09-27")).toBe("26 e 27/09/2026");
    });

    test("um dia só (ou sem data_inicio)", () => {
        expect(periodoParaTela(null, "2026-09-27")).toBe("27/09/2026");
        expect(periodoParaTela("2026-09-27", "2026-09-27")).toBe("27/09/2026");
    });

    test("meses diferentes viram intervalo", () => {
        expect(periodoParaTela("2026-09-30", "2026-10-01")).toBe("30/09/2026 a 01/10/2026");
    });
});
