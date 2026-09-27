import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { config, iniciarConfig } from "../src/services/config";
import { criarFila, fecharFila } from "../src/services/fila";
import { gerarToken } from "../src/services/token";
import per from "../src/services/per";
import Painel from "../src/_PAINEL/painel/route.painel";
import Upload from "../src/_FOTOGRAFO/upload/route.upload";
import { limparUploadsAbandonados } from "../src/jobs/limparUploads";
import { DadosProcessarFoto, NOME_FILA } from "../src/jobs/processarFoto";
import { NOME_FILA as FILA_PUBLICAR } from "../src/jobs/publicarFoto";
import { envTeste } from "./ambiente";

let servidor: Server;
let base: string;
let conexao: ConexaoPostgres;
let pasta: string;
let idEvento: number;
let idEventoAntigo: number;
let idVinculo: number;
let tokenUpload: string;
let sessao: string;
const sufixo = Date.now();
const jobs: string[] = [];

async function proximoId(tabela: string, coluna: string): Promise<number> {
    const [linha] = await conexao.queryParam<{ id: number }>(`SELECT COALESCE(MAX(${coluna}), 0) + 1 AS id FROM ${tabela}`);
    return linha.id;
}

async function criarEvento(nome: string, criadoEm: string): Promise<number> {
    const id = await proximoId("evento", "id_evento");
    await conexao.executeParamCount(
        `INSERT INTO evento (id_evento, nome, slug, tipo, privado, chave_anfitriao, data_fim, config, criado_em)
         VALUES (?, ?, ?, 'esportivo', 'N', ?, '2026-12-31', '{}', now() + ?::interval)`,
        [id, nome, `acoes-${sufixo}-${id}`, `anf-acoes-${sufixo}-${id}`, criadoEm]
    );
    return id;
}

async function inserirFoto(idEv: number, hash: string, etapa: string, erro: string | null, caminho: string | null): Promise<number> {
    const [linha] = await conexao.queryParam<{ id_foto: number }>(
        `INSERT INTO foto (id_evento, id_evento_fotografo, hash_arquivo, nome_arquivo, etapa, erro, erro_etapa, caminho_original)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id_foto`,
        [idEv, idEv === idEvento ? idVinculo : null, hash, `${hash}.jpg`, etapa, erro, erro ? etapa : null, caminho]
    );
    jobs.push(`${idEv}_${hash}`);
    return linha.id_foto;
}

before(async () => {
    pasta = await fs.mkdtemp(path.join(os.tmpdir(), "acoes-"));
    iniciarConfig({ ...envTeste("estacao"), RAIZ_UPLOADS: path.join(pasta, "_uploads") });
    conexao = new ConexaoPostgres();
    await conexao.open();

    idEventoAntigo = await criarEvento("Evento Antigo", "1 day");
    idEvento = await criarEvento("Evento Atual", "2 days");
    const idFotografo = await proximoId("fotografo", "id_fotografo");
    await conexao.executeParamCount("INSERT INTO fotografo (id_fotografo, nome) VALUES (?, 'Ana')", [idFotografo]);
    idVinculo = await proximoId("evento_fotografo", "id_evento_fotografo");
    tokenUpload = `acoes-${sufixo}`;
    await conexao.executeParamCount(
        "INSERT INTO evento_fotografo (id_evento_fotografo, id_evento, id_fotografo, token_upload) VALUES (?, ?, ?, ?)",
        [idVinculo, idEvento, idFotografo, tokenUpload]
    );
    sessao = gerarToken(1, config.operadorSegredo);

    const app = express();
    app.use(express.json());
    app.post("/painel", (req, res, next) => per(req, res, next, Painel));
    app.post("/upload", (req, res, next) => per(req, res, next, Upload));
    servidor = app.listen(0);
    await new Promise((resolve) => servidor.once("listening", resolve));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

async function chamar(rota: string, corpo: object, autenticar = true) {
    const resposta = await fetch(`${base}/${rota}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(autenticar ? { Authorization: sessao } : {}) },
        body: JSON.stringify(corpo),
    });
    return { status: resposta.status, corpo: (await resposta.json()) as Record<string, unknown> };
}

describe("reprocessar", () => {
    test("foto com erro e original em disco volta para a fila, no lugar do job que falhou", async () => {
        const original = path.join(pasta, "a.jpg");
        await fs.writeFile(original, "x");
        const idFoto = await inserirFoto(idEvento, "reproc-a", "rostos", "vision recusou a imagem", original);
        // O job que falhou continua na fila com o mesmo id: sem removê-lo, o novo seria ignorado.
        await criarFila<DadosProcessarFoto>(NOME_FILA).add(
            NOME_FILA,
            { id_evento: idEvento, id_evento_fotografo: idVinculo, hash_arquivo: "reproc-a", nome_arquivo: "x", origem: "/velho", copiar: true },
            { jobId: `${idEvento}_reproc-a` }
        );

        const r = await chamar("painel", { call: "reprocessar", id_foto: idFoto });

        assert.deepStrictEqual(r.corpo, { reenfileiradas: 1, sem_arquivo: 0 });
        const [foto] = await conexao.queryParam<{ erro: string | null }>("SELECT erro FROM foto WHERE id_foto = ?", [idFoto]);
        assert.strictEqual(foto.erro, null);
        const job = await criarFila<DadosProcessarFoto>(NOME_FILA).getJob(`${idEvento}_reproc-a`);
        assert.strictEqual(job?.data.origem, original);
    });

    test("foto sem arquivo em disco não é mexida e conta como sem arquivo", async () => {
        const idFoto = await inserirFoto(idEvento, "reproc-b", "registrada", "falhou", null);

        const r = await chamar("painel", { call: "reprocessar", id_foto: idFoto });

        assert.deepStrictEqual(r.corpo, { reenfileiradas: 0, sem_arquivo: 1 });
        const [foto] = await conexao.queryParam<{ erro: string | null }>("SELECT erro FROM foto WHERE id_foto = ?", [idFoto]);
        assert.strictEqual(foto.erro, "falhou");
    });

    test("com id_evento, reprocessa só as fotos com erro daquele evento", async () => {
        const original = path.join(pasta, "c.jpg");
        await fs.writeFile(original, "x");
        await inserirFoto(idEvento, "reproc-c", "rostos", "erro", original);
        const idDoAntigo = await inserirFoto(idEventoAntigo, "reproc-d", "rostos", "erro", original);

        await chamar("painel", { call: "reprocessar", id_evento: idEvento });

        const [antigo] = await conexao.queryParam<{ erro: string | null }>("SELECT erro FROM foto WHERE id_foto = ?", [idDoAntigo]);
        assert.strictEqual(antigo.erro, "erro", "o outro evento fica de fora");
        const job = await criarFila<DadosProcessarFoto>(NOME_FILA).getJob(`${idEvento}_reproc-c`);
        assert.ok(job);
    });
});

describe("reprocessar erro de publicação", () => {
    test("tira o job de publicação que falhou, senão a foto nunca publica e trava o encerrar", async () => {
        const original = path.join(pasta, "pub.jpg");
        await fs.writeFile(original, "x");
        const [linha] = await conexao.queryParam<{ id_foto: number }>(
            `INSERT INTO foto (id_evento, id_evento_fotografo, hash_arquivo, nome_arquivo, etapa, erro, erro_etapa, caminho_original)
             VALUES (?, ?, 'reproc-pub', 'pub.jpg', 'derivados', 'VPS respondeu 502', 'publicacao', ?) RETURNING id_foto`,
            [idEvento, idVinculo, original]
        );
        jobs.push(`${idEvento}_reproc-pub`);
        const publicar = criarFila(FILA_PUBLICAR);
        await publicar.add(FILA_PUBLICAR, { id_evento: idEvento, hash_arquivo: "reproc-pub" }, { jobId: `${idEvento}_reproc-pub` });

        await chamar("painel", { call: "reprocessar", id_foto: linha.id_foto });

        assert.strictEqual(await publicar.getJob(`${idEvento}_reproc-pub`), undefined, "o job velho sai, e o processamento enfileira um novo");
    });

    test("versão web que sumiu volta a ser gerada", async () => {
        const original = path.join(pasta, "sumiu.jpg");
        await fs.writeFile(original, "x");
        const [linha] = await conexao.queryParam<{ id_foto: number }>(
            `INSERT INTO foto (id_evento, id_evento_fotografo, hash_arquivo, nome_arquivo, etapa, erro, erro_etapa, caminho_original)
             VALUES (?, ?, 'reproc-sumiu', 'sumiu.jpg', 'derivados', '[PublicarFoto] derivado ausente: /data/publicar/x_web.jpg', 'publicacao', ?)
             RETURNING id_foto`,
            [idEvento, idVinculo, original]
        );
        jobs.push(`${idEvento}_reproc-sumiu`);

        await chamar("painel", { call: "reprocessar", id_foto: linha.id_foto });

        const [foto] = await conexao.queryParam<{ etapa: string }>("SELECT etapa FROM foto WHERE id_foto = ?", [linha.id_foto]);
        assert.strictEqual(foto.etapa, "rostos");
    });
});

describe("encerrarEvento", () => {
    test("foto que chegou mas ainda não começou a processar também segura o encerrar", async () => {
        // A linha em `foto` só nasce quando o worker pega o job: com fila grande (ou worker
        // parado), o upload completo é tudo o que existe da foto.
        await conexao.executeParamCount("UPDATE foto SET etapa = 'publicada', erro = NULL WHERE id_evento = ? AND erro IS NULL", [idEvento]);
        const [upload] = await conexao.queryParam<{ id_upload: number }>(
            `INSERT INTO upload (id_evento_fotografo, nome_arquivo, tamanho, hash_arquivo, bytes_recebidos, status)
             VALUES (?, 'na-fila.jpg', 10, 'upload-sem-foto', 10, 'completo') RETURNING id_upload`,
            [idVinculo]
        );

        const r = await chamar("painel", { call: "encerrarEvento", id_evento: idEvento });

        assert.strictEqual(r.corpo.codigo, "em_processamento");
        await conexao.executeParamCount("UPDATE upload SET status = 'cancelado' WHERE id_upload = ?", [upload.id_upload]);
    });

    test("com foto em processamento, recusa e diz por quê", async () => {
        const idFoto = await inserirFoto(idEvento, "enc-a", "rostos", null, null);

        const r = await chamar("painel", { call: "encerrarEvento", id_evento: idEvento });

        assert.strictEqual(r.status, 422);
        assert.strictEqual(r.corpo.codigo, "em_processamento");
        await conexao.executeParamCount("UPDATE foto SET etapa = 'publicada' WHERE id_foto = ?", [idFoto]);
    });

    test("só com publicadas e erros, encerra, apaga os rostos e fecha os links", async () => {
        // Deixa as fotos de testes anteriores deste arquivo fora de processamento.
        await conexao.executeParamCount("UPDATE foto SET etapa = 'publicada', erro = NULL WHERE id_evento = ? AND erro IS NULL", [idEvento]);
        const idFoto = await inserirFoto(idEvento, "enc-b", "publicada", null, null);
        await conexao.executeParamCount(
            "INSERT INTO rosto (id_foto, id_evento, embedding, bbox, det_score, area_px) VALUES (?, ?, ?, '[0,0,1,1]', 0.9, 100)",
            [idFoto, idEvento, `[${new Array(512).fill(0).join(",")}]`]
        );

        const r = await chamar("painel", { call: "encerrarEvento", id_evento: idEvento });

        assert.deepStrictEqual(r.corpo, { encerrado: true });
        const [rostos] = await conexao.queryParam<{ n: number }>("SELECT count(*)::int AS n FROM rosto WHERE id_evento = ?", [idEvento]);
        assert.strictEqual(rostos.n, 0);
        const sessaoUpload = await chamar("upload", { call: "getSessao", token: tokenUpload }, false);
        assert.strictEqual(sessaoUpload.corpo.codigo, "evento_encerrado");
    });
});

describe("limparUploadsAbandonados", () => {
    test("apaga o que parou há mais de 24 h e deixa em paz o que está andando", async () => {
        const inserir = async (horas: number) => {
            const [linha] = await conexao.queryParam<{ id_upload: number }>(
                `INSERT INTO upload (id_evento_fotografo, nome_arquivo, tamanho, hash_arquivo, updated_at)
                 VALUES (?, 'x.jpg', 100, 'h', now() - (? || ' hours')::interval) RETURNING id_upload`,
                [idVinculo, String(horas)]
            );
            await fs.mkdir(config.raizUploads, { recursive: true });
            await fs.writeFile(path.join(config.raizUploads, `${linha.id_upload}.part`), "parcial");
            return linha.id_upload;
        };
        const velho = await inserir(25);
        const recente = await inserir(1);

        await limparUploadsAbandonados(conexao);

        const status = async (id: number) =>
            (await conexao.queryParam<{ status: string }>("SELECT status FROM upload WHERE id_upload = ?", [id]))[0].status;
        const existe = (id: number) => fs.access(path.join(config.raizUploads, `${id}.part`)).then(() => true, () => false);
        assert.strictEqual(await status(velho), "cancelado");
        assert.strictEqual(await existe(velho), false);
        assert.strictEqual(await status(recente), "recebendo");
        assert.strictEqual(await existe(recente), true);
    });
});

after(async () => {
    const fila = criarFila(NOME_FILA);
    for (const id of jobs) await (await fila.getJob(id))?.remove();
    await conexao?.executeParamCount("UPDATE evento SET encerrado_em = now() WHERE id_evento IN (?, ?) AND encerrado_em IS NULL", [
        idEvento,
        idEventoAntigo,
    ]);
    servidor?.close();
    await conexao?.close();
    await fecharFila();
    await fecharBanco();
    await fs.rm(pasta, { recursive: true, force: true });
});
