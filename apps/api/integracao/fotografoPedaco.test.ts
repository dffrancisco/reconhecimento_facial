import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { iniciarConfig } from "../src/services/config";
import { criarFila, fecharFila } from "../src/services/fila";
import per from "../src/services/per";
import Upload from "../src/_FOTOGRAFO/upload/route.upload";
import { criarRotaPedaco } from "../src/_FOTOGRAFO/upload/pedaco";
import { DadosProcessarFoto, NOME_FILA } from "../src/jobs/processarFoto";
import { envTeste } from "./ambiente";

const KB = 1024;
let servidor: Server;
let base: string;
let conexao: ConexaoPostgres;
let raizUploads: string;
let idEvento: number;
let token: string;
let tokenOutro: string;
let idVinculoOutro: number;
const sufixo = Date.now();
const jobsCriados: string[] = [];

async function proximoId(tabela: string, coluna: string): Promise<number> {
    const [linha] = await conexao.queryParam<{ id: number }>(`SELECT COALESCE(MAX(${coluna}), 0) + 1 AS id FROM ${tabela}`);
    return linha.id;
}

async function criarVinculo(nome: string): Promise<{ id: number; token: string }> {
    const idFotografo = await proximoId("fotografo", "id_fotografo");
    await conexao.executeParamCount("INSERT INTO fotografo (id_fotografo, nome) VALUES (?, ?)", [idFotografo, nome]);
    const id = await proximoId("evento_fotografo", "id_evento_fotografo");
    const tokenNovo = `pedaco-${nome}-${sufixo}`;
    await conexao.executeParamCount(
        "INSERT INTO evento_fotografo (id_evento_fotografo, id_evento, id_fotografo, token_upload) VALUES (?, ?, ?, ?)",
        [id, idEvento, idFotografo, tokenNovo]
    );
    return { id, token: tokenNovo };
}

function jpeg(bytes: number): Buffer {
    return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), randomBytes(bytes - 4)]);
}

const sha256 = (dados: Buffer) => createHash("sha256").update(dados).digest("hex");

before(async () => {
    raizUploads = await fs.mkdtemp(path.join(os.tmpdir(), "pedacos-"));
    iniciarConfig({ ...envTeste("estacao"), RAIZ_UPLOADS: raizUploads });

    conexao = new ConexaoPostgres();
    await conexao.open();
    idEvento = await proximoId("evento", "id_evento");
    await conexao.executeParamCount(
        `INSERT INTO evento (id_evento, nome, slug, tipo, privado, chave_anfitriao, data_fim, config)
         VALUES (?, 'Corrida Pedaços', ?, 'esportivo', 'N', ?, '2026-12-31', '{}')`,
        [idEvento, `pedacos-${sufixo}`, `anf-pedacos-${sufixo}`]
    );
    ({ token } = await criarVinculo("Ana"));
    ({ id: idVinculoOutro, token: tokenOutro } = await criarVinculo("Bruno"));

    const app = express();
    app.use(express.json());
    app.post("/upload", (req, res, next) => per(req, res, next, Upload));
    app.put("/upload/:id_upload", criarRotaPedaco({ limitePedaco: 8 * KB }));
    // Disco cheio: o escritor falha como o sistema de arquivos falharia.
    app.put(
        "/cheio/:id_upload",
        criarRotaPedaco({
            limitePedaco: 8 * KB,
            abrirEscrita: async () => ({
                escrever: async () => {
                    throw Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
                },
                fechar: async () => {},
            }),
        })
    );
    servidor = app.listen(0);
    await new Promise((resolve) => servidor.once("listening", resolve));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

async function iniciar(conteudo: Buffer, opcoes: { tok?: string; hash?: string; nome?: string } = {}) {
    const resposta = await fetch(`${base}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            call: "iniciarUpload",
            token: opcoes.tok ?? token,
            nome_arquivo: opcoes.nome ?? "IMG.JPG",
            tamanho: conteudo.length,
            hash_arquivo: opcoes.hash ?? sha256(conteudo),
        }),
    });
    const corpo = (await resposta.json()) as { id_upload: number; situacao: string };
    const hash = opcoes.hash ?? sha256(conteudo);
    jobsCriados.push(`${idEvento}_${hash}`);
    return corpo;
}

async function enviar(idUpload: number, offset: number, pedaco: Buffer, opcoes: { tok?: string; rota?: string } = {}) {
    const resposta = await fetch(`${base}/${opcoes.rota ?? "upload"}/${idUpload}`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream", "X-Token-Upload": opcoes.tok ?? token, "Upload-Offset": String(offset) },
        body: new Uint8Array(pedaco),
    });
    return { status: resposta.status, corpo: (await resposta.json()) as Record<string, unknown> };
}

const parcial = (idUpload: number) => path.join(raizUploads, `${idUpload}.part`);
const existe = (caminho: string) => fs.access(caminho).then(() => true, () => false);

describe("PUT dos pedaços", () => {
    test("foto em três pedaços chega inteira e entra no processamento sem copiar", async () => {
        const foto = jpeg(20 * KB);
        const { id_upload } = await iniciar(foto);

        const r1 = await enviar(id_upload, 0, foto.subarray(0, 8 * KB));
        const r2 = await enviar(id_upload, 8 * KB, foto.subarray(8 * KB, 16 * KB));
        const r3 = await enviar(id_upload, 16 * KB, foto.subarray(16 * KB));

        assert.deepStrictEqual(r1.corpo, { bytes_recebidos: 8 * KB, completo: false });
        assert.deepStrictEqual(r2.corpo, { bytes_recebidos: 16 * KB, completo: false });
        assert.deepStrictEqual(r3.corpo, { bytes_recebidos: 20 * KB, completo: true });

        const [upload] = await conexao.queryParam<{ status: string }>("SELECT status FROM upload WHERE id_upload = ?", [id_upload]);
        assert.strictEqual(upload.status, "completo");

        const job = await criarFila<DadosProcessarFoto>(NOME_FILA).getJob(`${idEvento}_${sha256(foto)}`);
        assert.ok(job, "o job de processamento foi criado");
        assert.strictEqual(job.data.origem, parcial(id_upload));
        assert.strictEqual(job.data.copiar, false);
        assert.strictEqual(job.data.nome_arquivo, "IMG.JPG");
        assert.ok(await existe(parcial(id_upload)), "o arquivo fica para o processamento renomear");
    });

    test("pedaço fora de ordem recebe o byte certo para continuar", async () => {
        const foto = jpeg(20 * KB);
        const { id_upload } = await iniciar(foto);
        await enviar(id_upload, 0, foto.subarray(0, 8 * KB));

        const r = await enviar(id_upload, 16 * KB, foto.subarray(16 * KB));

        assert.strictEqual(r.status, 409);
        assert.deepStrictEqual(r.corpo, { bytes_recebidos: 8 * KB });
    });

    test("estação que caiu no meio de um pedaço: o disco manda no offset", async () => {
        const foto = jpeg(20 * KB);
        const { id_upload } = await iniciar(foto);
        await enviar(id_upload, 0, foto.subarray(0, 8 * KB));
        // Meio pedaço gravado sem a coluna ter sido atualizada, como numa queda.
        await fs.appendFile(parcial(id_upload), foto.subarray(8 * KB, 8 * KB + 3));

        const r = await enviar(id_upload, 8 * KB, foto.subarray(8 * KB, 16 * KB));

        assert.strictEqual(r.status, 409);
        assert.deepStrictEqual(r.corpo, { bytes_recebidos: 8 * KB + 3 });
    });

    test("pedaço acima do limite é recusado sem gravar nada", async () => {
        const foto = jpeg(20 * KB);
        const { id_upload } = await iniciar(foto);

        const r = await enviar(id_upload, 0, foto.subarray(0, 9 * KB));

        assert.strictEqual(r.status, 413);
        assert.strictEqual(await existe(parcial(id_upload)) ? (await fs.stat(parcial(id_upload))).size : 0, 0);
    });

    test("pedaço que passaria do tamanho declarado é recusado", async () => {
        const foto = jpeg(10 * KB);
        const { id_upload } = await iniciar(foto);
        await enviar(id_upload, 0, foto.subarray(0, 8 * KB));

        const r = await enviar(id_upload, 8 * KB, jpeg(8 * KB));

        assert.strictEqual(r.status, 422);
        assert.strictEqual((await fs.stat(parcial(id_upload))).size, 8 * KB);
    });

    test("arquivo que não é JPEG pelos bytes é recusado no primeiro pedaço", async () => {
        const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), randomBytes(2 * KB)]);
        const { id_upload } = await iniciar(png, { nome: "disfarcado.jpg" });

        const r = await enviar(id_upload, 0, png);

        assert.strictEqual(r.status, 422);
        assert.strictEqual(r.corpo.codigo, "nao_e_jpeg");
        assert.strictEqual(await existe(parcial(id_upload)), false);
    });

    test("foto que chega diferente do original é descartada", async () => {
        const foto = jpeg(4 * KB);
        const { id_upload } = await iniciar(foto, { hash: "f".repeat(64) });

        const r = await enviar(id_upload, 0, foto);

        assert.strictEqual(r.status, 422);
        assert.strictEqual(r.corpo.codigo, "hash_diferente");
        assert.strictEqual(await existe(parcial(id_upload)), false);
        const [upload] = await conexao.queryParam<{ status: string }>("SELECT status FROM upload WHERE id_upload = ?", [id_upload]);
        assert.strictEqual(upload.status, "cancelado");
    });

    test("token de outro fotógrafo não escreve no envio alheio", async () => {
        const foto = jpeg(4 * KB);
        const { id_upload } = await iniciar(foto);

        const r = await enviar(id_upload, 0, foto, { tok: tokenOutro });

        assert.strictEqual(r.status, 422);
        assert.strictEqual(r.corpo.codigo, "link_invalido");
    });

    test("a mesma foto completada por dois fotógrafos entra uma vez só e não deixa arquivo órfão", async () => {
        const foto = jpeg(4 * KB);
        const hash = sha256(foto);
        const primeiro = await iniciar(foto);
        // Os dois começaram antes de qualquer um terminar, então nenhum recebeu "já tenho".
        const [segundo] = await conexao.queryParam<{ id_upload: number }>(
            "INSERT INTO upload (id_evento_fotografo, nome_arquivo, tamanho, hash_arquivo) VALUES (?, 'copia.jpg', ?, ?) RETURNING id_upload",
            [idVinculoOutro, foto.length, hash]
        );

        await enviar(primeiro.id_upload, 0, foto);
        const r = await enviar(segundo.id_upload, 0, foto, { tok: tokenOutro });

        assert.deepStrictEqual(r.corpo, { bytes_recebidos: foto.length, completo: true });
        assert.strictEqual(await existe(parcial(segundo.id_upload)), false, "o parcial de quem chegou depois é apagado");
        const job = await criarFila<DadosProcessarFoto>(NOME_FILA).getJob(`${idEvento}_${hash}`);
        assert.strictEqual(job?.data.origem, parcial(primeiro.id_upload));
    });

    test("estação sem espaço em disco para a fila inteira com um código próprio", async () => {
        const foto = jpeg(4 * KB);
        const { id_upload } = await iniciar(foto);

        const r = await enviar(id_upload, 0, foto, { rota: "cheio" });

        assert.strictEqual(r.status, 507);
        assert.strictEqual(r.corpo.codigo, "sem_espaco");
    });
});

after(async () => {
    const fila = criarFila(NOME_FILA);
    for (const id of jobsCriados) await (await fila.getJob(id))?.remove();
    servidor?.close();
    await conexao?.close();
    await fecharFila();
    await fecharBanco();
    await fs.rm(raizUploads, { recursive: true, force: true });
});
