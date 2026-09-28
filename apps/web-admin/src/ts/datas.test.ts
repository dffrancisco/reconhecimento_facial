import { describe, expect, test } from "vitest";
import { fimAntesDoInicio, hoje, periodo } from "./datas";

describe("datas", () => {
    test("período de um dia, sem início, ou de vários dias", () => {
        expect(periodo("2026-09-27", "2026-09-27")).toBe("27/09/2026");
        expect(periodo(null, "2026-09-27")).toBe("27/09/2026");
        expect(periodo("2026-10-10", "2026-10-11")).toBe("10/10/2026 a 11/10/2026");
    });

    test("hoje no relógio do computador, mesmo tarde da noite", () => {
        expect(hoje(new Date(2026, 8, 7, 23, 30))).toBe("2026-09-07");
    });

    test("fim antes do início; início vazio nunca é", () => {
        expect(fimAntesDoInicio("2026-10-11", "2026-10-10")).toBe(true);
        expect(fimAntesDoInicio("2026-10-10", "2026-10-10")).toBe(false);
        expect(fimAntesDoInicio("", "2026-10-10")).toBe(false);
    });
});
