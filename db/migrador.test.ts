import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { criarArquivo, listarMigracoes } from "./migrador";
import { interpretarMigracao } from "./migrateParse";

let dir: string;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "migracoes-"));
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("listarMigracoes", () => {
    test("devolve os .sql em ordem e ignora outros arquivos", () => {
        fs.writeFileSync(path.join(dir, "20260918120100_b.sql"), "");
        fs.writeFileSync(path.join(dir, "20260918120000_a.sql"), "");
        fs.writeFileSync(path.join(dir, "LEIAME.md"), "");

        assert.deepStrictEqual(listarMigracoes(dir), [
            {
                versao: "20260918120000_a",
                nome: "20260918120000_a.sql",
                caminho: path.join(dir, "20260918120000_a.sql"),
            },
            {
                versao: "20260918120100_b",
                nome: "20260918120100_b.sql",
                caminho: path.join(dir, "20260918120100_b.sql"),
            },
        ]);
    });

    test("recusa .sql fora do padrão de nome", () => {
        fs.writeFileSync(path.join(dir, "cadastros.sql"), "");

        assert.throws(() => listarMigracoes(dir), /fora do padrão AAAAMMDDHHMMSS_nome.sql: cadastros.sql/);
    });

    test("pasta inexistente devolve lista vazia", () => {
        assert.deepStrictEqual(listarMigracoes(path.join(dir, "nao-existe")), []);
    });
});

describe("criarArquivo", () => {
    test("gera nome com carimbo e slug sem acento", () => {
        const nome = criarArquivo(dir, "Adiciona Coluna Ação", "vps", new Date(2026, 8, 18, 12, 0, 5));

        assert.strictEqual(nome, "20260918120005_adiciona_coluna_acao.sql");
    });

    test("o arquivo gerado já tem alvo e seções", () => {
        const nome = criarArquivo(dir, "x", "ambos", new Date(2026, 8, 18, 12, 0, 5));
        const conteudo = fs.readFileSync(path.join(dir, nome), "utf8");

        assert.match(conteudo, /^-- migrate:target ambos\n-- migrate:up\n/);
        assert.match(conteudo, /-- migrate:down/);
        assert.throws(() => interpretarMigracao(conteudo, nome), /ou vazia/);
    });

    test("recusa nome vazio", () => {
        assert.throws(() => criarArquivo(dir, " !! ", "vps"), /Informe um nome/);
    });
});
