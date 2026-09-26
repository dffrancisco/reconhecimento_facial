import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import express from "express";
import fileUpload from "express-fileupload";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { iniciarConfig, config } from "../src/services/config";
import { fecharFila } from "../src/services/fila";
import per from "../src/services/per";
import Busca from "../src/_PARTICIPANTE/busca/route.busca";

let servidorVision: Server;
let servidor: Server;
let base: string;
let conexao: ConexaoPostgres;
let raizSelfies: string;
let idEvento: number;
let slug: string;

const ALVO = new Array(512).fill(0).map((_, i) => (i < 256 ? 0.06 : 0.01));

before(async () => {
    raizSelfies = await fs.mkdtemp(path.join(os.tmpdir(), "selfies-teste-"));

    const appVision = express();
    appVision.use(express.json());
    appVision.post("/embed-selfie", async (req, res) => {
        // O teste controla a resposta pelo conteúdo do arquivo que a rota gravou.
        const conteudo = await fs.readFile(String(req.body.caminho), "utf8").catch(() => "");
        if (conteudo.includes("sem-rosto")) {
            res.status(422).json({ codigo: "sem_rosto", msg: "Não encontramos um rosto na foto. Tire outra selfie de frente." });
            return;
        }
        res.json({ embedding: ALVO, det_score: 0.9 });
    });
    servidorVision = appVision.listen(0);
    await new Promise((resolve) => servidorVision.once("listening", resolve));

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
        VISION_URL: `http://127.0.0.1:${(servidorVision.address() as AddressInfo).port}`,
        RAIZ_SELFIES: raizSelfies,
        BUSCA_LIMITE_IP: "3",
        CONFIAR_CLOUDFLARE: "true",
    });

    conexao = new ConexaoPostgres();
    await conexao.open();
    slug = `evento-buscar-${Date.now()}`;
    const [evento] = await conexao.queryParam<{ id_evento: number }>(
        `INSERT INTO evento (nome, slug, tipo, privado, chave_acesso, chave_anfitriao, data_fim, config)
         VALUES ('Buscar', ?, 'esportivo', 'N', ?, ?, '2026-12-31', '{"limiar":0.42,"exigir_whatsapp":false,"max_selfies":3}') RETURNING id_evento`,
        [slug, `chave-${Date.now()}`, `anfitriao-${Date.now()}`]
    );
    idEvento = evento.id_evento;

    const [foto] = await conexao.queryParam<{ id_foto: number }>(
        `INSERT INTO foto (id_evento, hash_arquivo, largura, altura, bytes_web, qtd_rostos, situacao)
         VALUES (?, ?, 100, 100, 10, 1, 'visivel') RETURNING id_foto`,
        [idEvento, "c".repeat(64)]
    );
    await conexao.executeParamCount(
        "INSERT INTO rosto (id_foto, id_evento, embedding, bbox, det_score, area_px) VALUES (?, ?, ?::vector, '[1,2,3,4]', 0.9, 100)",
        [foto.id_foto, idEvento, `[${ALVO.join(",")}]`]
    );

    const app = express();
    app.use(fileUpload({ limits: { fileSize: 25 * 1024 * 1024, files: 5 } }));
    app.post("/busca", (req, res, next) => per(req, res, next, Busca));
    servidor = app.listen(0);
    await new Promise((resolve) => servidor.once("listening", resolve));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

async function buscar(campos: Record<string, string>, conteudoSelfie = "selfie-boa", ip = `1.2.3.${Math.floor(Math.random() * 250)}`) {
    const forma = new FormData();
    forma.append("call", "buscar");
    for (const [chave, valor] of Object.entries(campos)) forma.append(chave, valor);
    forma.append("selfies", new Blob([Buffer.from(conteudoSelfie)]), "selfie.jpg");
    const resposta = await fetch(`${base}/busca`, { method: "POST", headers: { "CF-Connecting-IP": ip }, body: forma });
    return { status: resposta.status, corpo: (await resposta.json()) as Record<string, unknown> };
}

describe("buscar", () => {
    test("acha a foto e devolve token liberado com prévias assinadas", async () => {
        const r = await buscar({ slug, versao_termo: "v1", aceita_marketing: "N" });

        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.corpo.status, "liberada");
        assert.strictEqual(r.corpo.qtd_fotos, 1);
        assert.strictEqual((r.corpo.previas as string[]).length, 1);
        assert.match((r.corpo.previas as string[])[0], /^\/arquivos\/\d+\/[a-f0-9]{64}_previa\.jpg\?md5=.+&expires=\d+$/);

        const [gravada] = await conexao.queryParam<{ qtd_fotos: number; status: string }>(
            "SELECT qtd_fotos, status FROM busca WHERE token = ?",
            [r.corpo.token]
        );
        assert.strictEqual(gravada.qtd_fotos, 1);
        assert.strictEqual(gravada.status, "liberada");
    });

    test("a selfie não sobra em disco depois da busca", async () => {
        await buscar({ slug, versao_termo: "v1", aceita_marketing: "N" });
        assert.deepStrictEqual(await fs.readdir(config.raizSelfies), []);
    });

    test("selfie sem rosto responde 422 com a mensagem do vision, e não deixa arquivo", async () => {
        const r = await buscar({ slug, versao_termo: "v1", aceita_marketing: "N" }, "sem-rosto-aqui");

        assert.strictEqual(r.status, 422);
        assert.match(String(r.corpo.msg), /rosto/i);
        assert.deepStrictEqual(await fs.readdir(config.raizSelfies), []);
    });

    test("evento privado não abre pelo slug", async () => {
        await conexao.executeParamCount("UPDATE evento SET privado = 'S' WHERE id_evento = ?", [idEvento]);
        try {
            const r = await buscar({ slug, versao_termo: "v1", aceita_marketing: "N" });
            assert.strictEqual(r.status, 422);
            assert.match(String(r.corpo.msg), /evento/i);
        } finally {
            await conexao.executeParamCount("UPDATE evento SET privado = 'N' WHERE id_evento = ?", [idEvento]);
        }
    });

    test("evento sem nenhuma foto libera com zero e não pede código", async () => {
        const [vazio] = await conexao.queryParam<{ id_evento: number; slug: string }>(
            `INSERT INTO evento (nome, slug, tipo, privado, chave_anfitriao, data_fim, config)
             VALUES ('Vazio', ?, 'esportivo', 'N', ?, '2026-12-31', '{"exigir_whatsapp":true}') RETURNING id_evento, slug`,
            [`evento-vazio-${Date.now()}`, `anfitriao-vazio-${Date.now()}`]
        );

        const r = await buscar({ slug: vazio.slug, versao_termo: "v1", aceita_marketing: "N" });

        assert.strictEqual(r.corpo.status, "liberada");
        assert.strictEqual(r.corpo.qtd_fotos, 0);
        assert.strictEqual(r.corpo.codigo, undefined);
        assert.deepStrictEqual(r.corpo.previas, []);
    });

    test("evento que exige WhatsApp fica aguardando, com código e sem prévias", async () => {
        await conexao.executeParamCount(
            `UPDATE evento SET config = config || '{"exigir_whatsapp":true}'::jsonb WHERE id_evento = ?`,
            [idEvento]
        );
        try {
            const r = await buscar({ slug, versao_termo: "v1", aceita_marketing: "N" });

            assert.strictEqual(r.corpo.status, "aguardando");
            assert.match(String(r.corpo.codigo), /^\d{5}$/);
            assert.deepStrictEqual(r.corpo.previas, [], "aguardando não pode expor imagem nenhuma");
        } finally {
            await conexao.executeParamCount(
                `UPDATE evento SET config = config || '{"exigir_whatsapp":false}'::jsonb WHERE id_evento = ?`,
                [idEvento]
            );
        }
    });

    test("sem slug nem chave_acesso é erro de negócio", async () => {
        const r = await buscar({ versao_termo: "v1", aceita_marketing: "N" });
        assert.strictEqual(r.corpo.error, true);
    });

    test("sem versao_termo é erro de negócio: o consentimento é obrigatório", async () => {
        const r = await buscar({ slug, aceita_marketing: "N" });
        assert.strictEqual(r.corpo.error, true);
    });

    test("passa do limite de buscas do mesmo IP", async () => {
        const ip = `9.9.9.${Math.floor(Math.random() * 250)}`;
        for (let i = 0; i < 3; i++) {
            const ok = await buscar({ slug, versao_termo: "v1", aceita_marketing: "N" }, "selfie-boa", ip);
            assert.strictEqual(ok.status, 200, `tentativa ${i + 1} deveria passar`);
        }
        const excedeu = await buscar({ slug, versao_termo: "v1", aceita_marketing: "N" }, "selfie-boa", ip);
        assert.strictEqual(excedeu.status, 422);
        assert.match(String(excedeu.corpo.msg), /tente/i);
    });
});

after(async () => {
    servidor?.close();
    servidorVision?.close();
    await conexao?.close();
    await fs.rm(raizSelfies, { recursive: true, force: true });
    await fecharFila();
    await fecharBanco();
});
