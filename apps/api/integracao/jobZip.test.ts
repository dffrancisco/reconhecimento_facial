import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { iniciarConfig, config } from "../src/services/config";
import { fecharFila } from "../src/services/fila";
import { processarZip } from "../src/jobs/zip";

const executar = promisify(execFile);
let conexao: ConexaoPostgres;
let idEvento: number;
let idBusca: number;

before(async () => {
    const raizFotos = await fs.mkdtemp(path.join(os.tmpdir(), "zip-fotos-"));
    const raizZips = await fs.mkdtemp(path.join(os.tmpdir(), "zip-saida-"));

    iniciarConfig({
        PAPEL: "vps",
        POSTGRES_HOST: "127.0.0.1",
        POSTGRES_PORT: "5433",
        POSTGRES_USER: "fotos",
        POSTGRES_PASSWORD: "fotos",
        POSTGRES_DB: "fotos_vps",
        REDIS_URL: "redis://127.0.0.1:6380",
        ESTACAO_CHAVE: "a".repeat(32),
        ARQUIVO_SEGREDO: "segredo-de-teste",
        OPERADOR_SEGREDO: "a".repeat(32),
        VISION_URL: "http://127.0.0.1:1",
        RAIZ_FOTOS: raizFotos,
        RAIZ_ZIPS: raizZips,
    });

    conexao = new ConexaoPostgres();
    await conexao.open();
    const [evento] = await conexao.queryParam<{ id_evento: number }>(
        `INSERT INTO evento (nome, slug, tipo, privado, chave_anfitriao, data_fim, config)
         VALUES ('Zip', ?, 'esportivo', 'N', ?, '2026-12-31', '{}') RETURNING id_evento`,
        [`evento-zip-${Date.now()}`, `anfitriao-zip-${Date.now()}`]
    );
    idEvento = evento.id_evento;

    await fs.mkdir(path.join(config.raizFotos, String(idEvento)), { recursive: true });
    const [busca] = await conexao.queryParam<{ id_busca: number }>(
        `INSERT INTO busca (id_evento, token, status, qtd_fotos, consentimento_em, versao_termo)
         VALUES (?, ?, 'liberada', 2, now(), 'v1') RETURNING id_busca`,
        [idEvento, `tok-zip-${Date.now()}`]
    );
    idBusca = busca.id_busca;

    for (const letra of ["f", "0"]) {
        const hash = letra.repeat(64);
        await fs.writeFile(path.join(config.raizFotos, String(idEvento), `${hash}_web.jpg`), `foto-${letra}`);
        const [foto] = await conexao.queryParam<{ id_foto: number }>(
            `INSERT INTO foto (id_evento, hash_arquivo, largura, altura, bytes_web, qtd_rostos, situacao)
             VALUES (?, ?, 100, 100, 10, 1, 'visivel') RETURNING id_foto`,
            [idEvento, hash]
        );
        await conexao.executeParamCount(
            "INSERT INTO busca_foto (id_busca, id_foto, id_rosto, similaridade) VALUES (?, ?, NULL, 0.9)",
            [idBusca, foto.id_foto]
        );
    }
});

describe("processarZip", () => {
    test("monta o arquivo com as fotos da busca e marca pronto", async () => {
        const [zip] = await conexao.queryParam<{ id_arquivo_zip: number }>(
            `INSERT INTO arquivo_zip (id_evento, id_busca, parte, status, expira_em)
             VALUES (?, ?, 1, 'pendente', now() + interval '7 days') RETURNING id_arquivo_zip`,
            [idEvento, idBusca]
        );

        await processarZip({ id_arquivo_zip: zip.id_arquivo_zip });

        const [depois] = await conexao.queryParam<{ status: string; qtd_fotos: number; bytes: string }>(
            "SELECT status, qtd_fotos, bytes FROM arquivo_zip WHERE id_arquivo_zip = ?",
            [zip.id_arquivo_zip]
        );
        assert.strictEqual(depois.status, "pronto");
        assert.strictEqual(depois.qtd_fotos, 2);
        assert.ok(Number(depois.bytes) > 0);

        const caminho = path.join(config.raizZips, String(idEvento), `${zip.id_arquivo_zip}.zip`);
        const { stdout } = await executar("unzip", ["-l", caminho]);
        assert.match(stdout, /_web\.jpg/);
    });

    test("ZIP de busca sem foto visível fica pronto e vazio, sem quebrar", async () => {
        const [buscaVazia] = await conexao.queryParam<{ id_busca: number }>(
            `INSERT INTO busca (id_evento, token, status, qtd_fotos, consentimento_em, versao_termo)
             VALUES (?, ?, 'liberada', 0, now(), 'v1') RETURNING id_busca`,
            [idEvento, `tok-zip-vazio-${Date.now()}`]
        );
        const [zip] = await conexao.queryParam<{ id_arquivo_zip: number }>(
            `INSERT INTO arquivo_zip (id_evento, id_busca, parte, status, expira_em)
             VALUES (?, ?, 1, 'pendente', now() + interval '7 days') RETURNING id_arquivo_zip`,
            [idEvento, buscaVazia.id_busca]
        );

        await processarZip({ id_arquivo_zip: zip.id_arquivo_zip });

        const [depois] = await conexao.queryParam<{ status: string; qtd_fotos: number }>(
            "SELECT status, qtd_fotos FROM arquivo_zip WHERE id_arquivo_zip = ?",
            [zip.id_arquivo_zip]
        );
        assert.strictEqual(depois.status, "pronto");
        assert.strictEqual(depois.qtd_fotos, 0);
    });

    test("arquivo de foto sumido não derruba o ZIP: entra o que existe", async () => {
        const hashSumido = "9".repeat(64);
        const [foto] = await conexao.queryParam<{ id_foto: number }>(
            `INSERT INTO foto (id_evento, hash_arquivo, largura, altura, bytes_web, qtd_rostos, situacao)
             VALUES (?, ?, 100, 100, 10, 1, 'visivel') RETURNING id_foto`,
            [idEvento, hashSumido]
        );
        await conexao.executeParamCount(
            "INSERT INTO busca_foto (id_busca, id_foto, id_rosto, similaridade) VALUES (?, ?, NULL, 0.9)",
            [idBusca, foto.id_foto]
        );
        const [zip] = await conexao.queryParam<{ id_arquivo_zip: number }>(
            `INSERT INTO arquivo_zip (id_evento, id_busca, parte, status, expira_em)
             VALUES (?, ?, 1, 'pendente', now() + interval '7 days') RETURNING id_arquivo_zip`,
            [idEvento, idBusca]
        );

        await processarZip({ id_arquivo_zip: zip.id_arquivo_zip });

        const [depois] = await conexao.queryParam<{ status: string; qtd_fotos: number }>(
            "SELECT status, qtd_fotos FROM arquivo_zip WHERE id_arquivo_zip = ?",
            [zip.id_arquivo_zip]
        );
        assert.strictEqual(depois.status, "pronto");
        assert.strictEqual(depois.qtd_fotos, 2, "só as duas que existem em disco");
    });
});

test("ZIP apagado junto com o evento: termina sem erro", async () => {
    await processarZip({ id_arquivo_zip: 999_999_999 });
});

after(async () => {
    await conexao?.close();
    await fecharFila();
    await fecharBanco();
});
