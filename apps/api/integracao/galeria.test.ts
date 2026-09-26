import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import express from "express";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { iniciarConfig } from "../src/services/config";
import { fecharFila } from "../src/services/fila";
import per from "../src/services/per";
import Galeria from "../src/_ANFITRIAO/galeria/route.galeria";

let servidor: Server;
let base: string;
let conexao: ConexaoPostgres;
let chaveAnfitriao: string;
let idEvento: number;

before(async () => {
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
    });

    conexao = new ConexaoPostgres();
    await conexao.open();
    chaveAnfitriao = `anfitriao-gal-${Date.now()}`;
    const [evento] = await conexao.queryParam<{ id_evento: number }>(
        `INSERT INTO evento (nome, slug, tipo, privado, chave_anfitriao, data_fim, config)
         VALUES ('Galeria', ?, 'social', 'N', ?, '2026-12-31', '{}') RETURNING id_evento`,
        [`evento-galeria-${Date.now()}`, chaveAnfitriao]
    );
    idEvento = evento.id_evento;

    for (const [i, situacao] of [["1", "visivel"], ["2", "visivel"], ["3", "oculta"]] as const) {
        await conexao.executeParamCount(
            `INSERT INTO foto (id_evento, hash_arquivo, largura, altura, bytes_web, qtd_rostos, situacao, capturada_em)
             VALUES (?, ?, 100, 100, 10, 1, ?, now() - (? || ' minutes')::interval)`,
            [idEvento, `${i.repeat(63)}a`, situacao, i]
        );
    }

    const app = express();
    app.use(express.json());
    app.post("/galeria", (req, res, next) => per(req, res, next, Galeria));
    servidor = app.listen(0);
    await new Promise((resolve) => servidor.once("listening", resolve));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

async function chamar(corpo: object) {
    const resposta = await fetch(`${base}/galeria`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
    });
    return { status: resposta.status, corpo: (await resposta.json()) as Record<string, unknown> };
}

describe("getGaleria", () => {
    test("devolve as fotos visíveis com thumb assinado", async () => {
        const r = await chamar({ call: "getGaleria", chave: chaveAnfitriao, offset: 0 });

        const fotos = r.corpo.fotos as { thumb: string }[];
        assert.strictEqual(fotos.length, 2, "a foto oculta não entra");
        assert.match(fotos[0].thumb, /_thumb\.jpg\?md5=/);
        assert.strictEqual(r.corpo.evento, "Galeria");
    });

    test("chave errada não abre a galeria", async () => {
        const r = await chamar({ call: "getGaleria", chave: "chave-que-nao-existe", offset: 0 });
        assert.strictEqual(r.status, 422);
    });

    test("offset além do fim devolve lista vazia, não erro", async () => {
        const r = await chamar({ call: "getGaleria", chave: chaveAnfitriao, offset: 500 });
        assert.deepStrictEqual(r.corpo.fotos, []);
    });
});

describe("pedirZip", () => {
    test("cria o arquivo pendente para o evento inteiro", async () => {
        const r = await chamar({ call: "pedirZip", chave: chaveAnfitriao });

        assert.strictEqual(r.corpo.status, "pendente");
        const partes = r.corpo.partes as number[];
        assert.strictEqual(partes.length, 1, "2 fotos visíveis cabem numa parte só");

        const [zip] = await conexao.queryParam<{ id_evento: number; id_busca: number | null; parte: number }>(
            "SELECT id_evento, id_busca, parte FROM arquivo_zip WHERE id_arquivo_zip = ?",
            [partes[0]]
        );
        assert.strictEqual(zip.id_evento, idEvento);
        assert.strictEqual(zip.parte, 1);
        assert.strictEqual(zip.id_busca, null, "ZIP do anfitrião não pertence a uma busca");
    });

    test("evento com mais de 500 fotos vira várias partes", async () => {
        // Sem partes, tudo acima da 500ª foto ficaria de fora do ZIP e ninguém perceberia.
        const [grande] = await conexao.queryParam<{ id_evento: number; chave_anfitriao: string }>(
            `INSERT INTO evento (nome, slug, tipo, privado, chave_anfitriao, data_fim, config)
             VALUES ('Grande', ?, 'social', 'N', ?, '2026-12-31', '{}') RETURNING id_evento, chave_anfitriao`,
            [`evento-grande-${Date.now()}`, `anfitriao-grande-${Date.now()}`]
        );
        // 501 linhas de foto, sem arquivo em disco: aqui só interessa a contagem das partes.
        await conexao.executeParamCount(
            `INSERT INTO foto (id_evento, hash_arquivo, largura, altura, bytes_web, qtd_rostos, situacao)
             SELECT ?, lpad(g::text, 64, '0'), 100, 100, 10, 1, 'visivel' FROM generate_series(1, 501) g`,
            [grande.id_evento]
        );

        const r = await chamar({ call: "pedirZip", chave: grande.chave_anfitriao });
        assert.strictEqual((r.corpo.partes as number[]).length, 2);
    });
});

after(async () => {
    servidor?.close();
    await conexao?.close();
    await fecharFila();
    await fecharBanco();
});
