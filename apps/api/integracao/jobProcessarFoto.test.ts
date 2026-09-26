import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import express from "express";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { UnrecoverableError } from "bullmq";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { iniciarConfig, config } from "../src/services/config";
import { fecharFila } from "../src/services/fila";
import { processarFoto } from "../src/jobs/processarFoto";

let servidorVision: Server;
let conexao: ConexaoPostgres;
let pastaOrigem: string;
let idEvento: number;
let ambienteBase: Record<string, string>;

async function criarJpegDeTeste(caminho: string, corSemente: number): Promise<void> {
    await sharp({ create: { width: 200, height: 150, channels: 3, background: { r: corSemente, g: 10, b: 10 } } })
        .jpeg()
        .toFile(caminho);
}

before(async () => {
    const app = express();
    app.use(express.json());
    app.post("/detect", (req, res) => {
        const { caminhos } = req.body as { caminhos: string[] };
        res.json({
            resultados: caminhos.map((caminho) =>
                caminho.includes("ruim")
                    ? { caminho, erro: "arquivo não é um JPEG válido", rostos: [] }
                    : {
                          caminho,
                          largura: 200,
                          altura: 150,
                          rostos: [{ embedding: new Array(512).fill(0.02), bbox: [10, 10, 60, 70], det_score: 0.91, kps: [], area_px: 3000 }],
                      }
            ),
        });
    });
    servidorVision = app.listen(0);
    await new Promise((resolve) => servidorVision.once("listening", resolve));

    pastaOrigem = await fs.mkdtemp(path.join(os.tmpdir(), "processar-foto-teste-"));

    ambienteBase = {
        PAPEL: "estacao",
        POSTGRES_HOST: "127.0.0.1",
        POSTGRES_PORT: "5433",
        POSTGRES_USER: "fotos",
        POSTGRES_PASSWORD: "fotos",
        POSTGRES_DB: "fotos_estacao",
        REDIS_URL: "redis://127.0.0.1:6380",
        ESTACAO_CHAVE: "a".repeat(32),
        VPS_URL: "http://127.0.0.1:1",
        VISION_URL: `http://127.0.0.1:${(servidorVision.address() as AddressInfo).port}`,
        RAIZ_ORIGINAIS: await fs.mkdtemp(path.join(os.tmpdir(), "originais-teste-")),
        RAIZ_PUBLICAR: await fs.mkdtemp(path.join(os.tmpdir(), "publicar-teste-")),
    };
    iniciarConfig(ambienteBase);

    conexao = new ConexaoPostgres();
    await conexao.open();
    const slug = `evento-processar-${Date.now()}`;
    // O id vem explícito, como na sincronização: a estação nunca cria evento próprio, todo
    // evento chega da VPS com o id de lá — por isso a sequence do serial não é usada aqui.
    const [linha] = await conexao.queryParam<{ id_evento: number }>(
        `INSERT INTO evento (id_evento, nome, slug, tipo, privado, chave_anfitriao, data_fim, config)
         VALUES ((SELECT COALESCE(MAX(id_evento), 0) + 1 FROM evento), 'Teste', ?, 'esportivo', 'N', ?, '2026-12-31', ?) RETURNING id_evento`,
        [slug, `anfitriao-${Date.now()}`, JSON.stringify({ marca_dagua: false })]
    );
    idEvento = linha.id_evento;
});

describe("processarFoto", () => {
    test("processa do zero até derivados e enfileira a publicação", async () => {
        const origem = path.join(pastaOrigem, "boa1.jpg");
        await criarJpegDeTeste(origem, 200);
        const hash = "hash-boa-1";

        await processarFoto({ id_evento: idEvento, id_evento_fotografo: null, hash_arquivo: hash, nome_arquivo: "boa1.jpg", origem, copiar: true });

        const [foto] = await conexao.queryParam<{ etapa: string; qtd_rostos: number; caminho_original: string }>(
            "SELECT etapa, qtd_rostos, caminho_original FROM foto WHERE id_evento = ? AND hash_arquivo = ?",
            [idEvento, hash]
        );
        assert.strictEqual(foto.etapa, "derivados");
        assert.strictEqual(foto.qtd_rostos, 1);
        await fs.access(foto.caminho_original); // original copiado (copiar: true) — arquivo de origem continua existindo
        await fs.access(origem);

        const pastaPublicar = path.join(config.raizPublicar, String(idEvento));
        for (const tipo of ["web", "thumb", "previa"]) await fs.access(path.join(pastaPublicar, `${hash}_${tipo}.jpg`));
    });

    test("chamar de novo numa foto já em derivados não reprocessa nem duplica rostos", async () => {
        const origem = path.join(pastaOrigem, "boa2.jpg");
        await criarJpegDeTeste(origem, 210);
        const hash = "hash-boa-2";
        const dados = { id_evento: idEvento, id_evento_fotografo: null, hash_arquivo: hash, nome_arquivo: "boa2.jpg", origem, copiar: true };

        await processarFoto(dados);
        await processarFoto(dados);

        const [foto] = await conexao.queryParam<{ etapa: string }>("SELECT etapa FROM foto WHERE id_evento = ? AND hash_arquivo = ?", [idEvento, hash]);
        const rostos = await conexao.queryParam("SELECT * FROM rosto WHERE id_foto = (SELECT id_foto FROM foto WHERE id_evento = ? AND hash_arquivo = ?)", [
            idEvento,
            hash,
        ]);
        assert.strictEqual(foto.etapa, "derivados");
        assert.strictEqual(rostos.length, 1);
    });

    test("move em vez de copiar quando copiar é false", async () => {
        const origem = path.join(pastaOrigem, "mover.jpg");
        await criarJpegDeTeste(origem, 220);
        const hash = "hash-mover";

        await processarFoto({ id_evento: idEvento, id_evento_fotografo: null, hash_arquivo: hash, nome_arquivo: "mover.jpg", origem, copiar: false });

        await assert.rejects(() => fs.access(origem));
    });


    test("marca d'água maior que o thumb não derruba a foto", async () => {
        const raizMarcas = await fs.mkdtemp(path.join(os.tmpdir(), "marcas-teste-"));
        iniciarConfig({ ...ambienteBase, RAIZ_MARCAS: raizMarcas });

        const [comMarca] = await conexao.queryParam<{ id_evento: number }>(
            `INSERT INTO evento (id_evento, nome, slug, tipo, privado, chave_anfitriao, data_fim, config)
             VALUES ((SELECT COALESCE(MAX(id_evento), 0) + 1 FROM evento), 'Com marca', ?, 'esportivo', 'N', ?, '2026-12-31', ?) RETURNING id_evento`,
            [`evento-marca-${Date.now()}`, `anfitriao-marca-${Date.now()}`, JSON.stringify({ marca_dagua: true })]
        );
        // Logo de tamanho realista: mais largo que o thumb (400px), como qualquer marca de verdade.
        await sharp({ create: { width: 600, height: 120, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0.6 } } })
            .png()
            .toFile(path.join(raizMarcas, `${comMarca.id_evento}.png`));

        const origem = path.join(pastaOrigem, "com-marca.jpg");
        await criarJpegDeTeste(origem, 240);
        const hash = `hash-marca-${Date.now()}`;

        await processarFoto({ id_evento: comMarca.id_evento, id_evento_fotografo: null, hash_arquivo: hash, nome_arquivo: "com-marca.jpg", origem, copiar: true });

        const [foto] = await conexao.queryParam<{ etapa: string }>("SELECT etapa FROM foto WHERE id_evento = ? AND hash_arquivo = ?", [comMarca.id_evento, hash]);
        assert.strictEqual(foto.etapa, "derivados");
        for (const tipo of ["web", "thumb", "previa"])
            await fs.access(path.join(config.raizPublicar, String(comMarca.id_evento), `${hash}_${tipo}.jpg`));
    });

    test("erro do vision na própria imagem lança UnrecoverableError", async () => {
        const origem = path.join(pastaOrigem, "ruim.jpg");
        await criarJpegDeTeste(origem, 230);
        const hash = "hash-ruim";

        await assert.rejects(
            () => processarFoto({ id_evento: idEvento, id_evento_fotografo: null, hash_arquivo: hash, nome_arquivo: "ruim.jpg", origem, copiar: true }),
            UnrecoverableError
        );
    });
});

after(async () => {
    servidorVision?.close();
    await conexao?.close();
    // A fila de publicação abre uma conexão Redis que segura o event loop: sem fechar, o
    // processo de teste nunca termina.
    await fecharFila();
});

// Fecha o pool: sem isso o processo de teste fica ~30s ocioso antes de sair.
after(async () => {
    await fecharBanco();
});
