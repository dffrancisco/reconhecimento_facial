import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import { createHash } from "node:crypto";
import express from "express";
import fileUpload from "express-fileupload";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { iniciarConfig, config } from "../src/services/config";
import EventoCtrl from "../src/_ADMIN/evento/ctrl.evento";
import per from "../src/services/per";
import Foto from "../src/_ESTACAO/foto/route.foto";

before(() => {
    iniciarConfig({
        PAPEL: "vps",
        POSTGRES_HOST: "127.0.0.1",
        POSTGRES_PORT: "5433",
        POSTGRES_USER: "fotos",
        POSTGRES_PASSWORD: "fotos",
        POSTGRES_DB: "fotos_vps",
        REDIS_URL: "redis://127.0.0.1:6380",
        ESTACAO_CHAVE: "a".repeat(32),
        ARQUIVO_SEGREDO: "x",
        OPERADOR_SEGREDO: "a".repeat(32),
        VISION_URL: "http://127.0.0.1:1",
        RAIZ_FOTOS: "/tmp/fotos-teste-estacao-foto",
    });
});

let conexao: ConexaoPostgres;
let servidor: Server;
let base: string;
let idEvento: number;

before(async () => {
    conexao = new ConexaoPostgres();
    await conexao.open();
    const evento = await new EventoCtrl(conexao).criarEvento({
        nome: "Evento Publicação",
        slug: `evento-publicacao-${Date.now()}`,
        tipo: "esportivo",
        data_fim: "2026-12-31",
    });
    idEvento = evento.id_evento;

    const app = express();
    app.use(fileUpload({ limits: { fileSize: 25 * 1024 * 1024, files: 5 } }));
    app.post("/foto", (req, res, next) => per(req, res, next, Foto));
    servidor = app.listen(0);
    await new Promise((resolve) => servidor.once("listening", resolve));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

// A VPS agora exige SHA-256 em hex: os testes usam hashes do mesmo formato que a estação manda.
function hashFalso(sufixo: string): string {
    return createHash("sha256").update(`${sufixo}-${Date.now()}-${Math.random()}`).digest("hex");
}

function corpoPadrao(hash: string) {
    return {
        id_evento: idEvento,
        id_evento_fotografo: null,
        hash_arquivo: hash,
        largura: 4000,
        altura: 3000,
        bytes_web: 12345,
        capturada_em: "2026-11-01T10:00:00-03:00",
        camera: "Canon EOS R6",
        rostos: [{ embedding: new Array(512).fill(0.01), bbox: [10, 20, 110, 220], det_score: 0.93, area_px: 20000 }],
    };
}

async function publicar(hash: string, dados = corpoPadrao(hash)) {
    const forma = new FormData();
    forma.append("call", "publicarFoto");
    forma.append("dados", JSON.stringify(dados));
    forma.append("web", new Blob([Buffer.from("fake-web")]), "web.jpg");
    forma.append("thumb", new Blob([Buffer.from("fake-thumb")]), "thumb.jpg");
    forma.append("previa", new Blob([Buffer.from("fake-previa")]), "previa.jpg");
    const resposta = await fetch(`${base}/foto`, { method: "POST", headers: { Authorization: config.estacaoChave }, body: forma });
    return { status: resposta.status, corpo: await resposta.json() };
}

describe("publicarFoto", () => {
    test("grava a foto, os rostos e os 3 arquivos", async () => {
        const hash = hashFalso("basico");
        const r = await publicar(hash);

        assert.deepStrictEqual(r.corpo, { ok: true });
        const [foto] = await conexao.queryParam<{ id_foto: number; qtd_rostos: number; situacao: string }>(
            "SELECT id_foto, qtd_rostos, situacao FROM foto WHERE id_evento = ? AND hash_arquivo = ?",
            [idEvento, hash]
        );
        assert.strictEqual(foto.qtd_rostos, 1);
        assert.strictEqual(foto.situacao, "visivel");

        const rostos = await conexao.queryParam("SELECT * FROM rosto WHERE id_foto = ?", [foto.id_foto]);
        assert.strictEqual(rostos.length, 1);

        const fs = await import("node:fs/promises");
        const conteudo = await fs.readFile(`${config.raizFotos}/${idEvento}/${hash}_web.jpg`, "utf8");
        assert.strictEqual(conteudo, "fake-web");
    });


    test("hash fora do formato é recusado, sem gravar arquivo fora da raiz", async () => {
        const fs = await import("node:fs/promises");
        const base = "/tmp/fotos-teste-escapou";
        for (const tipo of ["web", "thumb", "previa"]) await fs.rm(`${base}_${tipo}.jpg`, { force: true });

        const dados = corpoPadrao("x");
        dados.hash_arquivo = "../../../../tmp/fotos-teste-escapou";
        const r = await publicar(dados.hash_arquivo, dados);

        assert.strictEqual(r.status, 200);
        assert.ok((r.corpo as { error?: boolean }).error, "deveria ser recusado como erro de negócio");
        await assert.rejects(() => fs.access(`${base}_web.jpg`));
    });

    test("id_evento que não é inteiro é recusado", async () => {
        const dados = corpoPadrao(hashFalso("id-invalido")) as unknown as { id_evento: unknown };
        dados.id_evento = "1; DROP";
        const r = await publicar(hashFalso("id-invalido"), dados as never);
        assert.ok((r.corpo as { error?: boolean }).error);
    });

    test("republicar a mesma foto é idempotente: mesmo id_foto, rostos substituídos", async () => {
        const hash = hashFalso("repub");
        const primeira = await publicar(hash);
        const [antes] = await conexao.queryParam<{ id_foto: number }>("SELECT id_foto FROM foto WHERE id_evento = ? AND hash_arquivo = ?", [
            idEvento,
            hash,
        ]);

        const dados2 = corpoPadrao(hash);
        dados2.rostos = [dados2.rostos[0], dados2.rostos[0]];
        await publicar(hash, dados2);
        const [depois] = await conexao.queryParam<{ id_foto: number; qtd_rostos: number }>(
            "SELECT id_foto, qtd_rostos FROM foto WHERE id_evento = ? AND hash_arquivo = ?",
            [idEvento, hash]
        );

        assert.strictEqual(primeira.corpo.ok, true);
        assert.strictEqual(depois.id_foto, antes.id_foto);
        assert.strictEqual(depois.qtd_rostos, 2);
    });

    test("foto excluída ignora o envio e responde ok, sem recriar", async () => {
        const hash = hashFalso("excluida");
        await publicar(hash);
        const [linha] = await conexao.queryParam<{ id_foto: number }>("SELECT id_foto FROM foto WHERE id_evento = ? AND hash_arquivo = ?", [
            idEvento,
            hash,
        ]);
        await conexao.executeParamCount("UPDATE foto SET situacao = 'excluida' WHERE id_foto = ?", [linha.id_foto]);

        const r = await publicar(hash);
        assert.deepStrictEqual(r.corpo, { ok: true });
        const [depois] = await conexao.queryParam<{ situacao: string }>("SELECT situacao FROM foto WHERE id_foto = ?", [linha.id_foto]);
        assert.strictEqual(depois.situacao, "excluida");
    });

    test("republicar não reverte uma foto oculta para visível", async () => {
        const hash = hashFalso("oculta");
        await publicar(hash);
        await conexao.executeParamCount("UPDATE foto SET situacao = 'oculta' WHERE id_evento = ? AND hash_arquivo = ?", [idEvento, hash]);

        await publicar(hash);
        const [linha] = await conexao.queryParam<{ situacao: string }>("SELECT situacao FROM foto WHERE id_evento = ? AND hash_arquivo = ?", [
            idEvento,
            hash,
        ]);
        assert.strictEqual(linha.situacao, "oculta");
    });
});

after(async () => {
    servidor?.close();
    await conexao?.close();
});

// Fecha o pool: sem isso o processo de teste fica ~30s ocioso antes de sair.
after(async () => {
    await fecharBanco();
});
