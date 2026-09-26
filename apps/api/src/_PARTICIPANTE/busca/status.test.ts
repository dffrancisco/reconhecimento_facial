import { test, describe } from "node:test";
import assert from "node:assert";
import { decidirStatusBusca } from "./status";

const BASE = { qtdFotos: 3, exigirWhatsapp: true, idParticipanteAparelho: null, origem: null, idEvento: 7 };

describe("decidirStatusBusca", () => {
    test("zero fotos libera sem pedir nada", () => {
        const r = decidirStatusBusca({ ...BASE, qtdFotos: 0 });
        assert.deepStrictEqual(r, { status: "liberada", idParticipante: null, precisaCodigo: false });
    });

    test("evento que não exige WhatsApp libera", () => {
        const r = decidirStatusBusca({ ...BASE, exigirWhatsapp: false });
        assert.deepStrictEqual(r, { status: "liberada", idParticipante: null, precisaCodigo: false });
    });

    test("aparelho conhecido libera e reaproveita o participante", () => {
        const r = decidirStatusBusca({ ...BASE, idParticipanteAparelho: 42 });
        assert.deepStrictEqual(r, { status: "liberada", idParticipante: 42, precisaCodigo: false });
    });

    test("token de origem liberado e verificado libera", () => {
        const r = decidirStatusBusca({
            ...BASE,
            origem: { status: "liberada", id_evento: 7, id_participante: 42, dentroDaValidade: true },
        });
        assert.deepStrictEqual(r, { status: "liberada", idParticipante: 42, precisaCodigo: false });
    });

    test("origem sem participante não dispensa a verificação", () => {
        // Senão a busca de zero fotos viraria atalho para pular o WhatsApp.
        const r = decidirStatusBusca({
            ...BASE,
            origem: { status: "liberada", id_evento: 7, id_participante: null, dentroDaValidade: true },
        });
        assert.strictEqual(r.status, "aguardando");
    });

    test("origem de outro evento não vale", () => {
        const r = decidirStatusBusca({
            ...BASE,
            origem: { status: "liberada", id_evento: 8, id_participante: 42, dentroDaValidade: true },
        });
        assert.strictEqual(r.status, "aguardando");
    });

    test("origem fora da validade não vale", () => {
        const r = decidirStatusBusca({
            ...BASE,
            origem: { status: "liberada", id_evento: 7, id_participante: 42, dentroDaValidade: false },
        });
        assert.strictEqual(r.status, "aguardando");
    });

    test("origem ainda aguardando não vale", () => {
        const r = decidirStatusBusca({
            ...BASE,
            origem: { status: "aguardando", id_evento: 7, id_participante: 42, dentroDaValidade: true },
        });
        assert.strictEqual(r.status, "aguardando");
    });

    test("sem nada disso, aguarda com código", () => {
        const r = decidirStatusBusca(BASE);
        assert.deepStrictEqual(r, { status: "aguardando", idParticipante: null, precisaCodigo: true });
    });

    test("zero fotos ganha de tudo: nem aparelho nem origem mudam a resposta", () => {
        const r = decidirStatusBusca({
            ...BASE,
            qtdFotos: 0,
            idParticipanteAparelho: 42,
            origem: { status: "liberada", id_evento: 7, id_participante: 42, dentroDaValidade: true },
        });
        assert.deepStrictEqual(r, { status: "liberada", idParticipante: null, precisaCodigo: false });
    });
});
