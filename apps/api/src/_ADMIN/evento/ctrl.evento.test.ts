import { test, describe } from "node:test";
import assert from "node:assert";
import { configPadrao, mesclarConfig } from "./ctrl.evento";

describe("configPadrao", () => {
    test("esportivo: exigir_whatsapp true, o resto dos padrões", () => {
        assert.deepStrictEqual(configPadrao("esportivo", "Corrida X"), {
            limiar: 0.42,
            exigir_whatsapp: true,
            marca_dagua: false,
            organizador: "Corrida X",
            dias_expurgo: 90,
            validade_resultado_dias: null,
            max_selfies: 3,
        });
    });

    test("social: exigir_whatsapp false", () => {
        assert.strictEqual(configPadrao("social", "Festa Y").exigir_whatsapp, false);
    });
});

describe("mesclarConfig", () => {
    const atual = configPadrao("esportivo", "Corrida X");

    test("troca só os campos informados", () => {
        const resultado = mesclarConfig(atual, { limiar: 0.5, organizador: "Novo nome" });
        assert.strictEqual(resultado.limiar, 0.5);
        assert.strictEqual(resultado.organizador, "Novo nome");
        assert.strictEqual(resultado.max_selfies, 3);
    });

    test("aceita validade_resultado_dias explicitamente null", () => {
        const comValidade = mesclarConfig(atual, { validade_resultado_dias: 30 });
        assert.strictEqual(mesclarConfig(comValidade, { validade_resultado_dias: null }).validade_resultado_dias, null);
    });

    test("sem alterações devolve os mesmos valores", () => {
        assert.deepStrictEqual(mesclarConfig(atual, {}), atual);
    });
});
