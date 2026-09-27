import { describe, test } from "node:test";
import assert from "node:assert";
import { escolherEvento, type EventoAberto } from "./regras";

const ev = (id_evento: number, data_inicio: string | null, data_fim: string): EventoAberto => ({ id_evento, nome: `E${id_evento}`, data_inicio, data_fim });

describe("escolherEvento", () => {
    test("o evento acontecendo hoje vence o que foi cadastrado depois para uma data futura", () => {
        // A sincronização traz todos os eventos ativos: o próximo, cadastrado com antecedência,
        // não pode tomar o lugar do que está acontecendo.
        const abertos = [ev(2, "2026-10-10", "2026-10-10"), ev(1, "2026-09-26", "2026-09-26")];
        assert.strictEqual(escolherEvento(abertos, "2026-09-26", null)?.id_evento, 1);
    });

    test("evento sem data de início é um evento de um dia, na data de fim", () => {
        assert.strictEqual(escolherEvento([ev(1, null, "2026-09-26")], "2026-09-26", null)?.id_evento, 1);
        assert.strictEqual(escolherEvento([ev(1, null, "2026-12-31")], "2026-09-26", null), null);
    });

    test("continua em andamento até 3 dias depois do fim, para os envios do dia seguinte", () => {
        assert.strictEqual(escolherEvento([ev(1, "2026-09-20", "2026-09-23")], "2026-09-26", null)?.id_evento, 1);
        assert.strictEqual(escolherEvento([ev(1, "2026-09-20", "2026-09-22")], "2026-09-26", null), null);
    });

    test("dois acontecendo ao mesmo tempo: o que começou por último", () => {
        const abertos = [ev(1, "2026-09-20", "2026-09-30"), ev(2, "2026-09-25", "2026-09-27")];
        assert.strictEqual(escolherEvento(abertos, "2026-09-26", null)?.id_evento, 2);
    });

    test("a escolha do operador vale enquanto o evento estiver aberto", () => {
        const abertos = [ev(1, "2026-09-26", "2026-09-26"), ev(2, null, "2027-01-10")];
        assert.strictEqual(escolherEvento(abertos, "2026-09-26", 2)?.id_evento, 2);
        assert.strictEqual(escolherEvento(abertos, "2026-09-26", 99)?.id_evento, 1, "escolha de um evento que não está mais aberto é ignorada");
    });

    test("nada acontecendo hoje: nenhum evento, em vez de pegar um qualquer", () => {
        assert.strictEqual(escolherEvento([ev(1, null, "2027-01-10")], "2026-09-26", null), null);
    });
});
