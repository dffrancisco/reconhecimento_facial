import { describe, test } from "node:test";
import assert from "node:assert";
import { decidirPedaco, ehJpeg, mensagemParaFotografo, TAMANHO_MAXIMO_FOTO, validarInicio } from "./regras";

const HASH = "a".repeat(64);
const valido = { nome_arquivo: "IMG_0001.JPG", tamanho: 1000, hash_arquivo: HASH };

describe("validarInicio", () => {
    test("foto JPEG com tamanho e hash certos passa", () => {
        assert.strictEqual(validarInicio(valido), null);
        assert.strictEqual(validarInicio({ ...valido, nome_arquivo: "foto.jpeg" }), null);
        assert.strictEqual(validarInicio({ ...valido, hash_arquivo: "A".repeat(64) }), null);
    });

    test("extensão que não é JPEG é recusada com a explicação para o fotógrafo", () => {
        for (const nome of ["IMG_0001.CR3", "foto.png", "semextensao"])
            assert.strictEqual(validarInicio({ ...valido, nome_arquivo: nome }), "Não é JPEG — exporte em JPEG para enviar.");
    });

    test("tamanho vazio, negativo, fracionado ou acima de 100 MB é recusado", () => {
        for (const tamanho of [0, -1, 1.5, "1000", undefined]) assert.notStrictEqual(validarInicio({ ...valido, tamanho }), null);
        assert.strictEqual(validarInicio({ ...valido, tamanho: 100 * 1024 * 1024 + 1 }), "Foto maior que 100 MB.");
        assert.strictEqual(validarInicio({ ...valido, tamanho: 100 * 1024 * 1024 }), null);
        assert.strictEqual(TAMANHO_MAXIMO_FOTO, 100 * 1024 * 1024);
    });

    test("hash que não é SHA-256 em hexadecimal é recusado", () => {
        assert.notStrictEqual(validarInicio({ ...valido, hash_arquivo: "a".repeat(63) }), null);
        assert.notStrictEqual(validarInicio({ ...valido, hash_arquivo: "g".repeat(64) }), null);
        assert.notStrictEqual(validarInicio({ ...valido, hash_arquivo: 123 }), null);
    });
});

describe("ehJpeg", () => {
    test("reconhece o JPEG pelos bytes, não pela extensão", () => {
        assert.strictEqual(ehJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00])), true);
        assert.strictEqual(ehJpeg(Buffer.from([0x89, 0x50, 0x4e, 0x47])), false);
        assert.strictEqual(ehJpeg(Buffer.from([0xff, 0xd8])), false);
    });
});

describe("decidirPedaco", () => {
    const base = { offset: 8, tamanhoAtual: 8, tamanhoDeclarado: 20, bytesPedaco: 8, limitePedaco: 8 };

    test("pedaço que continua de onde parou é aceito", () => {
        assert.strictEqual(decidirPedaco(base), "ok");
        assert.strictEqual(decidirPedaco({ ...base, offset: 16, tamanhoAtual: 16, bytesPedaco: 4 }), "ok");
    });

    test("offset diferente do que está em disco é fora de ordem", () => {
        // Inclui o caso da estação que reiniciou com meio pedaço gravado: o disco manda.
        assert.strictEqual(decidirPedaco({ ...base, offset: 8, tamanhoAtual: 12 }), "fora_de_ordem");
    });

    test("pedaço acima do limite é grande demais", () => {
        assert.strictEqual(decidirPedaco({ ...base, bytesPedaco: 9 }), "grande_demais");
    });

    test("pedaço que passaria do tamanho declarado é recusado", () => {
        assert.strictEqual(decidirPedaco({ ...base, offset: 16, tamanhoAtual: 16, bytesPedaco: 8 }), "passa_do_tamanho");
    });
});

describe("mensagemParaFotografo", () => {
    test("foto que o vision não leu vira explicação sem jargão", () => {
        assert.strictEqual(
            mensagemParaFotografo("[ProcessarFoto] vision recusou a imagem: decode", "rostos"),
            "A estação não conseguiu ler esta foto (arquivo corrompido)."
        );
    });

    test("falha só na publicação não pede nada ao fotógrafo", () => {
        assert.strictEqual(
            mensagemParaFotografo("VPS respondeu 502", "publicacao"),
            "A foto está pronta e aguarda envio ao site; não precisa fazer nada."
        );
    });

    test("qualquer outro erro aponta para o operador", () => {
        assert.strictEqual(mensagemParaFotografo("ENOENT", "original"), "A estação teve um problema com esta foto. O operador já vê no painel.");
        assert.strictEqual(mensagemParaFotografo(null, null), "A estação teve um problema com esta foto. O operador já vê no painel.");
    });
});
