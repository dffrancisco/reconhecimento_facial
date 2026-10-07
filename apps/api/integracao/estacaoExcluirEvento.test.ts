import { test, before, after } from "node:test";
import assert from "node:assert";
import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { iniciarConfig, config } from "../src/services/config";
import { processarSincronizar } from "../src/jobs/sincronizar";
import { caminhoParcial } from "../src/_FOTOGRAFO/upload/ctrl.upload";

let servidorVps: Server;
let conexao: ConexaoPostgres;

// Ids altos e únicos por execução: o banco da estação de dev é compartilhado com outros testes.
const marca = Date.now() % 1_000_000;
const ALVO = 800_000_000 + marca;
const VIZINHO = ALVO + 1;
const NOVO = ALVO + 2;
const INEXISTENTE = ALVO + 3;
const slugAlvo = `alvo-excluir-${marca}`;
const slugVizinho = `vizinho-excluir-${marca}`;
const FOTOGRAFO = 800_000_000 + marca;
const hash = (letra: string) => letra.repeat(64);

const evento = (id: number, slug: string) => ({
    id_evento: id,
    nome: `Evento ${id}`,
    slug,
    tipo: "esportivo",
    privado: "N",
    chave_acesso: null,
    chave_anfitriao: `anf-${id}`,
    data_inicio: null,
    data_fim: "2026-12-31",
    ativo: "S",
    config: {},
    marca_dagua_caminho: null,
});

let idUploadAlvo: number;
let idUploadVizinho: number;

// O que a estação teria de um evento em andamento: fotos com rosto, um envio pela metade e os
// arquivos de cada etapa no disco.
async function semear(id: number, slug: string, letra: string): Promise<number> {
    await conexao.executeParamCount(
        `INSERT INTO evento (id_evento, nome, slug, tipo, privado, chave_anfitriao, data_fim, config)
         VALUES (?, ?, ?, 'esportivo', 'N', ?, '2026-12-31', '{}')`,
        [id, `Evento ${id}`, slug, `anf-${id}`]
    );
    await conexao.executeParamCount("INSERT INTO evento_fotografo (id_evento_fotografo, id_evento, id_fotografo, token_upload) VALUES (?, ?, ?, ?)", [
        id,
        id,
        FOTOGRAFO,
        `tok-${id}`,
    ]);
    const [foto] = await conexao.queryParam<{ id_foto: number }>(
        `INSERT INTO foto (id_evento, id_evento_fotografo, hash_arquivo, nome_arquivo, etapa) VALUES (?, ?, ?, 'a.jpg', 'publicada') RETURNING id_foto`,
        [id, id, hash(letra)]
    );
    await conexao.executeParamCount(
        "INSERT INTO rosto (id_foto, id_evento, embedding, bbox, det_score, area_px) VALUES (?, ?, ?::vector, ?, 0.9, 900)",
        [foto.id_foto, id, `[${new Array(512).fill(0.01).join(",")}]`, JSON.stringify([1, 2, 3, 4])]
    );
    const [upload] = await conexao.queryParam<{ id_upload: number }>(
        "INSERT INTO upload (id_evento_fotografo, nome_arquivo, tamanho, hash_arquivo) VALUES (?, 'b.jpg', 100, ?) RETURNING id_upload",
        [id, hash(letra)]
    );

    await fs.mkdir(path.join(config.raizOriginais, slug, "2026-10-07"), { recursive: true });
    await fs.writeFile(path.join(config.raizOriginais, slug, "2026-10-07", `${hash(letra)}.jpg`), "original");
    await fs.mkdir(path.join(config.raizPublicar, String(id)), { recursive: true });
    await fs.writeFile(path.join(config.raizPublicar, String(id), `${hash(letra)}_web.jpg`), "web");
    await fs.mkdir(config.raizMarcas, { recursive: true });
    await fs.writeFile(path.join(config.raizMarcas, `${id}.png`), "png");
    await fs.mkdir(config.raizUploads, { recursive: true });
    await fs.writeFile(caminhoParcial(upload.id_upload), "metade");
    return upload.id_upload;
}

before(async () => {
    const app = express();
    app.use(express.json());
    app.post("/api/estacao/sincronizacao", (_req, res) => {
        // O vizinho continua; o alvo foi excluído e um evento novo já usa o endereço dele.
        res.json({
            operadores: [],
            eventos: [evento(VIZINHO, slugVizinho), evento(NOVO, slugAlvo)],
            fotografos: [],
            vinculos: [],
            eventos_excluidos: [ALVO, INEXISTENTE],
        });
    });
    servidorVps = app.listen(0);
    await new Promise((resolve) => servidorVps.once("listening", resolve));

    const raiz = await fs.mkdtemp(path.join(os.tmpdir(), "estacao-excluir-"));
    iniciarConfig({
        PAPEL: "estacao",
        POSTGRES_HOST: "127.0.0.1",
        POSTGRES_PORT: "5433",
        POSTGRES_USER: "fotos",
        POSTGRES_PASSWORD: "fotos",
        POSTGRES_DB: "fotos_estacao",
        REDIS_URL: "redis://127.0.0.1:6380",
        ESTACAO_CHAVE: "a".repeat(32),
        VPS_URL: `http://127.0.0.1:${(servidorVps.address() as AddressInfo).port}`,
        VISION_URL: "http://127.0.0.1:1",
        RAIZ_ORIGINAIS: path.join(raiz, "originais"),
        RAIZ_PUBLICAR: path.join(raiz, "publicar"),
        RAIZ_MARCAS: path.join(raiz, "marcas"),
        RAIZ_UPLOADS: path.join(raiz, "originais", "_uploads"),
    });

    conexao = new ConexaoPostgres();
    await conexao.open();
    await conexao.executeParamCount("INSERT INTO fotografo (id_fotografo, nome) VALUES (?, 'Ana')", [FOTOGRAFO]);
    idUploadAlvo = await semear(ALVO, slugAlvo, "a");
    idUploadVizinho = await semear(VIZINHO, slugVizinho, "b");

    await processarSincronizar(new ConexaoPostgres());
});

async function contar(sql: string, valores: unknown[]): Promise<number> {
    const [linha] = await conexao.queryParam<{ n: number }>(`SELECT count(*)::int AS n FROM ${sql}`, valores);
    return linha.n;
}

const existe = (caminho: string) =>
    fs.access(caminho).then(
        () => true,
        () => false
    );

test("apaga do banco da estação o evento, as fotos, os rostos, os envios e os vínculos", async () => {
    assert.strictEqual(await contar("evento WHERE id_evento = ?", [ALVO]), 0);
    assert.strictEqual(await contar("foto WHERE id_evento = ?", [ALVO]), 0);
    assert.strictEqual(await contar("rosto WHERE id_evento = ?", [ALVO]), 0);
    assert.strictEqual(await contar("evento_fotografo WHERE id_evento = ?", [ALVO]), 0);
    assert.strictEqual(await contar("upload WHERE id_upload = ?", [idUploadAlvo]), 0);
});

test("apaga do disco os originais, as cópias para publicar, a marca d'água e o envio pela metade", async () => {
    assert.strictEqual(await existe(path.join(config.raizOriginais, slugAlvo, "2026-10-07")), false);
    assert.strictEqual(await existe(path.join(config.raizPublicar, String(ALVO))), false);
    assert.strictEqual(await existe(path.join(config.raizMarcas, `${ALVO}.png`)), false);
    assert.strictEqual(await existe(caminhoParcial(idUploadAlvo)), false);
});

test("não toca no evento vizinho, nem na pasta dos envios", async () => {
    assert.strictEqual(await contar("foto WHERE id_evento = ?", [VIZINHO]), 1);
    assert.strictEqual(await contar("upload WHERE id_upload = ?", [idUploadVizinho]), 1);
    assert.strictEqual(await existe(path.join(config.raizOriginais, slugVizinho, "2026-10-07", `${hash("b")}.jpg`)), true);
    assert.strictEqual(await existe(path.join(config.raizPublicar, String(VIZINHO))), true);
    assert.strictEqual(await existe(path.join(config.raizMarcas, `${VIZINHO}.png`)), true);
    assert.strictEqual(await existe(caminhoParcial(idUploadVizinho)), true);
});

test("um evento novo com o endereço do excluído entra na mesma sincronização", async () => {
    const [novo] = await conexao.queryParam<{ slug: string }>("SELECT slug FROM evento WHERE id_evento = ?", [NOVO]);
    assert.strictEqual(novo?.slug, slugAlvo);
});

test("sincronizar de novo, com o excluído já apagado, não falha", async () => {
    await processarSincronizar(new ConexaoPostgres());
    assert.strictEqual(await contar("evento WHERE id_evento = ?", [VIZINHO]), 1);
});

after(async () => {
    for (const id of [ALVO, VIZINHO, NOVO]) {
        await conexao.executeParamCount("DELETE FROM upload WHERE id_evento_fotografo = ?", [id]);
        await conexao.executeParamCount("DELETE FROM foto WHERE id_evento = ?", [id]);
        await conexao.executeParamCount("DELETE FROM evento_fotografo WHERE id_evento = ?", [id]);
        await conexao.executeParamCount("DELETE FROM evento WHERE id_evento = ?", [id]);
    }
    await conexao.executeParamCount("DELETE FROM fotografo WHERE id_fotografo = ?", [FOTOGRAFO]);
    await conexao?.close();
    servidorVps?.close();
});

// Fecha o pool: sem isso o processo de teste fica ~30s ocioso antes de sair.
after(async () => {
    await fecharBanco();
});
