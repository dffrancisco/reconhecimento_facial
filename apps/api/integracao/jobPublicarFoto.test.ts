import { test, before, after } from "node:test";
import assert from "node:assert";
import express from "express";
import fileUpload from "express-fileupload";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ConexaoPostgres from "../src/db/conexaoPostgres";
import { iniciarConfig, config } from "../src/services/config";
import { publicarFoto } from "../src/jobs/publicarFoto";
import { caminhoPublicar } from "../src/services/caminhos";

let servidorVps: Server;
let ultimoRecebido: { dados: unknown; arquivos: string[] } | undefined;
let conexao: ConexaoPostgres;
let idEvento: number;

before(async () => {
    const app = express();
    app.use(fileUpload());
    app.post("/api/estacao/foto", (req, res) => {
        ultimoRecebido = { dados: JSON.parse(req.body.dados), arquivos: Object.keys(req.files ?? {}) };
        res.json({ ok: true });
    });
    servidorVps = app.listen(0);
    await new Promise((resolve) => servidorVps.once("listening", resolve));

    const raizPublicar = await fs.mkdtemp(path.join(os.tmpdir(), "publicar-job-teste-"));

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
        RAIZ_PUBLICAR: raizPublicar,
    });

    conexao = new ConexaoPostgres();
    await conexao.open();
    const slug = `evento-publicar-job-${Date.now()}`;
    // Id explícito: na estação todo evento vem da VPS com o id de lá (a sequence do serial não é usada).
    const [evento] = await conexao.queryParam<{ id_evento: number }>(
        `INSERT INTO evento (id_evento, nome, slug, tipo, privado, chave_anfitriao, data_fim, config)
         VALUES ((SELECT COALESCE(MAX(id_evento), 0) + 1 FROM evento), 'Teste', ?, 'esportivo', 'N', ?, '2026-12-31', '{}') RETURNING id_evento`,
        [slug, `anfitriao-${Date.now()}`]
    );
    idEvento = evento.id_evento;
});

test("lê os rostos locais, envia o multipart e marca como publicada", async () => {
    const hash = `hash-publicar-${Date.now()}`;
    const [foto] = await conexao.queryParam<{ id_foto: number }>(
        `INSERT INTO foto (id_evento, hash_arquivo, nome_arquivo, largura, altura, bytes_web, capturada_em, camera, qtd_rostos, etapa)
         VALUES (?, ?, 'x.jpg', 4000, 3000, 12345, now(), 'Canon', 1, 'derivados') RETURNING id_foto`,
        [idEvento, hash]
    );
    await conexao.executeParamCount("INSERT INTO rosto (id_foto, id_evento, embedding, bbox, det_score, area_px) VALUES (?, ?, ?::vector, ?, ?, ?)", [
        foto.id_foto,
        idEvento,
        `[${new Array(512).fill(0.03).join(",")}]`,
        JSON.stringify([1, 2, 3, 4]),
        0.88,
        4000,
    ]);

    const pasta = path.dirname(caminhoPublicar(config.raizPublicar, idEvento, hash, "web"));
    await fs.mkdir(pasta, { recursive: true });
    for (const tipo of ["web", "thumb", "previa"] as const) await fs.writeFile(caminhoPublicar(config.raizPublicar, idEvento, hash, tipo), `conteudo-${tipo}`);

    await publicarFoto({ id_evento: idEvento, hash_arquivo: hash });

    assert.deepStrictEqual(ultimoRecebido?.arquivos.sort(), ["previa", "thumb", "web"]);
    const dadosRecebidos = ultimoRecebido?.dados as { rostos: { embedding: number[] }[]; camera: string };
    assert.strictEqual(dadosRecebidos.rostos.length, 1);
    assert.strictEqual(dadosRecebidos.rostos[0].embedding.length, 512);
    assert.strictEqual(dadosRecebidos.camera, "Canon");

    const [depois] = await conexao.queryParam<{ etapa: string; publicada_em: string }>("SELECT etapa, publicada_em FROM foto WHERE id_foto = ?", [foto.id_foto]);
    assert.strictEqual(depois.etapa, "publicada");
    assert.ok(depois.publicada_em);

    for (const tipo of ["web", "thumb", "previa"] as const)
        await assert.rejects(() => fs.access(caminhoPublicar(config.raizPublicar, idEvento, hash, tipo)));
});

after(async () => {
    servidorVps?.close();
    await conexao?.close();
});
