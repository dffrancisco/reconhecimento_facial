import { describe, test } from "node:test";
import assert from "node:assert";
import { montarLinks, slugRepetido, validarConfig, validarDatas, validarNome } from "./regras";

describe("validarDatas", () => {
    test("início e fim no mesmo dia, ou sem início, valem", () => {
        assert.strictEqual(validarDatas("2026-09-27", "2026-09-27"), null);
        assert.strictEqual(validarDatas(null, "2026-09-27"), null);
    });

    test("fim antes do início é recusado", () => {
        assert.strictEqual(validarDatas("2026-10-11", "2026-10-10"), "O fim do evento não pode ser antes do início.");
    });

    test("data que não existe ou fora do formato é recusada", () => {
        assert.strictEqual(validarDatas(null, "2026-02-30"), "Data de fim inválida.");
        assert.strictEqual(validarDatas(null, "27/09/2026"), "Data de fim inválida.");
        assert.strictEqual(validarDatas(null, undefined), "Data de fim inválida.");
        assert.strictEqual(validarDatas("2026-13-01", "2026-12-31"), "Data de início inválida.");
    });
});

describe("validarNome", () => {
    test("obrigatório e até 150 caracteres", () => {
        assert.strictEqual(validarNome("Corrida da Serra"), null);
        assert.strictEqual(validarNome("   "), "Informe o nome do evento.");
        assert.strictEqual(validarNome(undefined), "Informe o nome do evento.");
        assert.strictEqual(validarNome("x".repeat(151)), "O nome do evento deve ter até 150 caracteres.");
    });
});

describe("validarConfig", () => {
    test("sem config, nada muda", () => {
        assert.deepStrictEqual(validarConfig(undefined), { valores: {} });
        assert.deepStrictEqual(validarConfig(null), { valores: {} });
    });

    test("guarda só os campos conhecidos", () => {
        assert.deepStrictEqual(validarConfig({ exigir_whatsapp: false, qualquer: 1 }), { valores: { exigir_whatsapp: false } });
    });

    test("aceita os extremos de cada faixa", () => {
        assert.deepStrictEqual(validarConfig({ limiar: 0.2, max_selfies: 5, dias_expurgo: 3650, validade_resultado_dias: 1 }), {
            valores: { limiar: 0.2, max_selfies: 5, dias_expurgo: 3650, validade_resultado_dias: 1 },
        });
        assert.deepStrictEqual(validarConfig({ limiar: 0.8, max_selfies: 1, dias_expurgo: 1, validade_resultado_dias: null }), {
            valores: { limiar: 0.8, max_selfies: 1, dias_expurgo: 1, validade_resultado_dias: null },
        });
    });

    test("recusa fora da faixa, com a mensagem do campo", () => {
        assert.deepStrictEqual(validarConfig({ limiar: 0.9 }), { erro: "O limiar de semelhança deve ficar entre 0,20 e 0,80." });
        assert.deepStrictEqual(validarConfig({ limiar: "0.5" }), { erro: "O limiar de semelhança deve ficar entre 0,20 e 0,80." });
        assert.deepStrictEqual(validarConfig({ max_selfies: 0 }), { erro: "O máximo de selfies deve ser de 1 a 5." });
        assert.deepStrictEqual(validarConfig({ max_selfies: 2.5 }), { erro: "O máximo de selfies deve ser de 1 a 5." });
        assert.deepStrictEqual(validarConfig({ dias_expurgo: 3651 }), { erro: "Os dias até apagar o evento devem ser de 1 a 3650." });
        assert.deepStrictEqual(validarConfig({ validade_resultado_dias: 0 }), {
            erro: "A validade do resultado deve ficar vazia ou ser de 1 a 3650 dias.",
        });
    });

    test("sim ou não só com booleano; organizador obrigatório e sem espaço sobrando", () => {
        assert.deepStrictEqual(validarConfig({ exigir_whatsapp: "false" }), { erro: "Exigir WhatsApp deve ser sim ou não." });
        assert.deepStrictEqual(validarConfig({ marca_dagua: 1 }), { erro: "Marca d'água deve ser sim ou não." });
        assert.deepStrictEqual(validarConfig({ organizador: "  " }), { erro: "Informe o nome do organizador (até 120 caracteres)." });
        assert.deepStrictEqual(validarConfig({ organizador: "  Liga X " }), { valores: { organizador: "Liga X" } });
    });

    test("config que não é objeto é recusada", () => {
        assert.deepStrictEqual(validarConfig([1]), { erro: "Configuração do evento inválida." });
        assert.deepStrictEqual(validarConfig("x"), { erro: "Configuração do evento inválida." });
    });
});

describe("montarLinks", () => {
    const base = { slug: "corrida-da-serra", chave_acesso: null, chave_anfitriao: "anf123", privado: "N" as const };

    test("público: participante pelo endereço do evento", () => {
        assert.deepStrictEqual(montarLinks("https://fotos.exemplo.com.br", base), {
            participante: "https://fotos.exemplo.com.br/#/e/corrida-da-serra",
            anfitriao: "https://fotos.exemplo.com.br/#/a/anf123",
        });
    });

    test("privado: participante pela chave de acesso", () => {
        assert.strictEqual(montarLinks("http://localhost:8080", { ...base, privado: "S", chave_acesso: "chv456" })?.participante, "http://localhost:8080/#/p/chv456");
    });

    test("sem endereço configurado, sem links", () => {
        assert.strictEqual(montarLinks(null, base), null);
    });
});

describe("slugRepetido", () => {
    test("só a violação única do endereço", () => {
        assert.strictEqual(slugRepetido({ code: "23505", constraint: "evento_slug_key" }), true);
        assert.strictEqual(slugRepetido({ code: "23505", constraint: "evento_chave_anfitriao_key" }), false);
        assert.strictEqual(slugRepetido(new Error("outro")), false);
    });
});
