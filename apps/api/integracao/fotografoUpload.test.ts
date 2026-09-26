import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { iniciarConfig } from "../src/services/config";
import { fecharFila } from "../src/services/fila";
import per from "../src/services/per";
import Upload from "../src/_FOTOGRAFO/upload/route.upload";
import { envTeste } from "./ambiente";

let servidor: Server;
let base: string;
let conexao: ConexaoPostgres;
let raizUploads: string;
let idEvento: number;
let token: string;
let tokenOutro: string;
let idVinculo: number;
let idVinculoOutro: number;
const sufixo = Date.now();

async function proximoId(tabela: string, coluna: string): Promise<number> {
    const [linha] = await conexao.queryParam<{ id: number }>(`SELECT COALESCE(MAX(${coluna}), 0) + 1 AS id FROM ${tabela}`);
    return linha.id;
}

// Na estação evento, fotógrafo e vínculo vêm do VPS com os ids de lá.
async function criarVinculo(idEv: number, nome: string, ativo = "S"): Promise<{ id: number; token: string }> {
    const idFotografo = await proximoId("fotografo", "id_fotografo");
    await conexao.executeParamCount("INSERT INTO fotografo (id_fotografo, nome) VALUES (?, ?)", [idFotografo, nome]);
    const id = await proximoId("evento_fotografo", "id_evento_fotografo");
    const tokenNovo = `tok-${nome}-${sufixo}`;
    await conexao.executeParamCount(
        "INSERT INTO evento_fotografo (id_evento_fotografo, id_evento, id_fotografo, token_upload, ativo) VALUES (?, ?, ?, ?, ?)",
        [id, idEv, idFotografo, tokenNovo, ativo]
    );
    return { id, token: tokenNovo };
}

async function criarEvento(nome: string, encerrado = false): Promise<number> {
    const id = await proximoId("evento", "id_evento");
    await conexao.executeParamCount(
        `INSERT INTO evento (id_evento, nome, slug, tipo, privado, chave_anfitriao, data_fim, config, encerrado_em)
         VALUES (?, ?, ?, 'esportivo', 'N', ?, '2026-12-31', '{}', ?)`,
        [id, nome, `${nome.toLowerCase().replace(/\s/g, "-")}-${sufixo}-${id}`, `anf-${sufixo}-${id}`, encerrado ? new Date() : null]
    );
    return id;
}

before(async () => {
    raizUploads = await fs.mkdtemp(path.join(os.tmpdir(), "uploads-"));
    iniciarConfig({ ...envTeste("estacao"), RAIZ_UPLOADS: raizUploads });

    conexao = new ConexaoPostgres();
    await conexao.open();
    idEvento = await criarEvento("Corrida Upload");
    ({ id: idVinculo, token } = await criarVinculo(idEvento, "Ana"));
    ({ id: idVinculoOutro, token: tokenOutro } = await criarVinculo(idEvento, "Bruno"));

    const app = express();
    app.use(express.json());
    app.post("/upload", (req, res, next) => per(req, res, next, Upload));
    servidor = app.listen(0);
    await new Promise((resolve) => servidor.once("listening", resolve));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

async function chamar(corpo: object) {
    const resposta = await fetch(`${base}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
    });
    return { status: resposta.status, corpo: (await resposta.json()) as Record<string, unknown> };
}

const hash = (letra: string) => letra.repeat(64);

describe("getSessao", () => {
    test("link válido devolve o evento, o fotógrafo e o tamanho do pedaço", async () => {
        const r = await chamar({ call: "getSessao", token });

        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual(r.corpo.evento, { nome: "Corrida Upload" });
        assert.deepStrictEqual(r.corpo.fotografo, { nome: "Ana" });
        assert.strictEqual(r.corpo.pedaco_bytes, 8 * 1024 * 1024);
    });

    test("token que não existe não abre o envio", async () => {
        const r = await chamar({ call: "getSessao", token: "nao-existe" });
        assert.strictEqual(r.status, 422);
        assert.strictEqual(r.corpo.codigo, "link_invalido");
    });

    test("vínculo desativado no admin para de aceitar", async () => {
        const { token: desativado } = await criarVinculo(idEvento, "Carla", "N");
        const r = await chamar({ call: "getSessao", token: desativado });
        assert.strictEqual(r.corpo.codigo, "link_invalido");
    });

    test("evento encerrado na estação para de aceitar", async () => {
        const encerrado = await criarEvento("Evento Encerrado", true);
        const { token: doEncerrado } = await criarVinculo(encerrado, "Davi");
        const r = await chamar({ call: "getSessao", token: doEncerrado });
        assert.strictEqual(r.status, 422);
        assert.strictEqual(r.corpo.codigo, "evento_encerrado");
    });
});

describe("iniciarUpload", () => {
    test("foto nova ganha um upload começando do zero", async () => {
        const r = await chamar({ call: "iniciarUpload", token, nome_arquivo: "IMG_1.JPG", tamanho: 1000, hash_arquivo: hash("1") });

        assert.strictEqual(r.corpo.situacao, "novo");
        assert.strictEqual(r.corpo.bytes_recebidos, 0);
        const [linha] = await conexao.queryParam<{ id_evento_fotografo: number; status: string }>(
            "SELECT id_evento_fotografo, status FROM upload WHERE id_upload = ?",
            [r.corpo.id_upload]
        );
        assert.deepStrictEqual(linha, { id_evento_fotografo: idVinculo, status: "recebendo" });
    });

    test("a mesma foto de novo continua o mesmo upload, do tamanho que está em disco", async () => {
        const primeiro = await chamar({ call: "iniciarUpload", token, nome_arquivo: "IMG_2.JPG", tamanho: 1000, hash_arquivo: hash("2") });
        await fs.mkdir(raizUploads, { recursive: true });
        await fs.writeFile(path.join(raizUploads, `${primeiro.corpo.id_upload}.part`), Buffer.alloc(5));

        const segundo = await chamar({ call: "iniciarUpload", token, nome_arquivo: "IMG_2.JPG", tamanho: 1000, hash_arquivo: hash("2") });

        assert.strictEqual(segundo.corpo.situacao, "continuar");
        assert.strictEqual(segundo.corpo.id_upload, primeiro.corpo.id_upload);
        assert.strictEqual(segundo.corpo.bytes_recebidos, 5);
    });

    test("foto que já está no evento, mesmo mandada por outro fotógrafo, é pulada", async () => {
        await conexao.executeParamCount(
            "INSERT INTO foto (id_evento, id_evento_fotografo, hash_arquivo, nome_arquivo) VALUES (?, ?, ?, 'do-bruno.jpg')",
            [idEvento, idVinculoOutro, hash("3")]
        );
        const r = await chamar({ call: "iniciarUpload", token, nome_arquivo: "IMG_3.JPG", tamanho: 1000, hash_arquivo: hash("3") });
        assert.deepStrictEqual(r.corpo, { situacao: "ja_existe" });
    });

    test("arquivo que não é JPEG é recusado antes de subir qualquer byte", async () => {
        const r = await chamar({ call: "iniciarUpload", token, nome_arquivo: "IMG_4.CR3", tamanho: 1000, hash_arquivo: hash("4") });
        assert.strictEqual(r.status, 422);
        assert.strictEqual(r.corpo.msg, "Não é JPEG — exporte em JPEG para enviar.");
    });
});

describe("statusUpload", () => {
    test("conta só as fotos do próprio fotógrafo e traduz os erros", async () => {
        const inserir = (vinculo: number, h: string, etapa: string, erro: string | null, erroEtapa: string | null) =>
            conexao.executeParamCount(
                "INSERT INTO foto (id_evento, id_evento_fotografo, hash_arquivo, nome_arquivo, etapa, erro, erro_etapa) VALUES (?, ?, ?, ?, ?, ?, ?)",
                [idEvento, vinculo, h, `${h.slice(0, 4)}.jpg`, etapa, erro, erroEtapa]
            );
        await inserir(idVinculo, hash("5"), "publicada", null, null);
        await inserir(idVinculo, hash("6"), "rostos", null, null);
        await inserir(idVinculo, hash("7"), "original", "[ProcessarFoto] vision recusou a imagem: decode", "original");
        await inserir(idVinculoOutro, hash("8"), "publicada", null, null);
        await conexao.executeParamCount(
            "INSERT INTO upload (id_evento_fotografo, nome_arquivo, tamanho, hash_arquivo, bytes_recebidos, status) VALUES (?, 'x.jpg', 10, ?, 10, 'completo')",
            [idVinculo, hash("5")]
        );

        const r = await chamar({ call: "statusUpload", token });

        assert.strictEqual(r.corpo.enviadas, 1);
        assert.strictEqual(r.corpo.prontas, 1);
        assert.strictEqual(r.corpo.processando, 1);
        assert.strictEqual(r.corpo.com_erro, 1);
        assert.deepStrictEqual(r.corpo.erros, [{ nome_arquivo: "7777.jpg", mensagem: "A estação não conseguiu ler esta foto (arquivo corrompido)." }]);
    });
});

after(async () => {
    servidor?.close();
    await conexao?.close();
    await fecharFila();
    await fecharBanco();
    await fs.rm(raizUploads, { recursive: true, force: true });
});
