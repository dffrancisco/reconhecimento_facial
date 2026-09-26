import { test, describe } from "node:test";
import assert from "node:assert";
import { agruparResultados } from "./agrupar";

describe("agruparResultados", () => {
    test("sem listas devolve vazio", () => {
        assert.deepStrictEqual(agruparResultados([], 0.42), []);
    });

    test("fica com a maior similaridade da foto e o id_rosto daquele match", () => {
        const resultado = agruparResultados(
            [
                [{ id_foto: 1, id_rosto: 10, similaridade: 0.5 }],
                [{ id_foto: 1, id_rosto: 11, similaridade: 0.8 }],
            ],
            0.42
        );

        assert.deepStrictEqual(resultado, [{ id_foto: 1, id_rosto: 11, similaridade: 0.8 }]);
    });

    test("corta o que está abaixo do limiar", () => {
        const resultado = agruparResultados(
            [
                [
                    { id_foto: 1, id_rosto: 10, similaridade: 0.9 },
                    { id_foto: 2, id_rosto: 20, similaridade: 0.41 },
                ],
            ],
            0.42
        );

        assert.deepStrictEqual(resultado.map((f) => f.id_foto), [1]);
    });

    test("o limiar é inclusivo: igual ao limiar entra", () => {
        const resultado = agruparResultados([[{ id_foto: 1, id_rosto: 10, similaridade: 0.42 }]], 0.42);
        assert.strictEqual(resultado.length, 1);
    });

    test("ordena por similaridade desc, desempatando por id_foto asc", () => {
        const resultado = agruparResultados(
            [
                [
                    { id_foto: 3, id_rosto: 30, similaridade: 0.7 },
                    { id_foto: 1, id_rosto: 10, similaridade: 0.9 },
                    { id_foto: 2, id_rosto: 20, similaridade: 0.7 },
                ],
            ],
            0.42
        );

        assert.deepStrictEqual(resultado.map((f) => f.id_foto), [1, 2, 3]);
    });
});
