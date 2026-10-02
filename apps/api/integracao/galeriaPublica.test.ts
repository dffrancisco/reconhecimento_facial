import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import express from "express";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { iniciarConfig } from "../src/services/config";
import { fecharFila } from "../src/services/fila";
import per from "../src/services/per";
import Galeria from "../src/_PARTICIPANTE/galeria/route.galeria";

let servidor: Server;
let base: string;
let conexao: ConexaoPostgres;
let slugComFotos: string;
let slugSemFotos: string;
const visiveis = ["1".repeat(64), "2".repeat(64)];
const oculta = "3".repeat(64);

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
    slugComFotos = `capa-${Date.now()}`;
    slugSemFotos = `capa-vazio-${Date.now()}`;
    const ids: number[] = [];
    for (const slug of [slugComFotos, slugSemFotos]) {
        const [evento] = await conexao.queryParam<{ id_evento: number }>(
            `INSERT INTO evento (nome, slug, tipo, privado, chave_anfitriao, data_fim, config)
             VALUES ('Capa', ?, 'esportivo', 'N', ?, '2026-12-31', '{}') RETURNING id_evento`,
            [slug, `anfitriao-${slug}`]
        );
        ids.push(evento.id_evento);
    }

    for (const [hash, situacao] of [[visiveis[0], "visivel"], [visiveis[1], "visivel"], [oculta, "oculta"]]) {
        await conexao.executeParamCount(
            `INSERT INTO foto (id_evento, hash_arquivo, largura, altura, bytes_web, qtd_rostos, situacao, capturada_em)
             VALUES (?, ?, 100, 100, 10, 1, ?, now())`,
            [ids[0], hash, situacao]
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

describe("getEvento — capa da home", () => {
    test("traz o thumb assinado de uma foto visível, nunca da oculta", async () => {
        // A capa é sorteada: várias chamadas para a oculta ter chance de aparecer, se escapasse.
        for (let i = 0; i < 12; i++) {
            const r = await chamar({ call: "getEvento", slug: slugComFotos });
            assert.strictEqual(r.status, 200);
            const capa = String(r.corpo.capa);
            assert.match(capa, /_thumb\.jpg\?md5=.+&expires=\d+$/);
            assert.ok(visiveis.some((hash) => capa.includes(hash)), `capa fora das visíveis: ${capa}`);
        }
    });

    test("evento sem foto publicada vem sem capa", async () => {
        const r = await chamar({ call: "getEvento", slug: slugSemFotos });
        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.corpo.capa, null);
    });
});

after(async () => {
    servidor?.close();
    await conexao?.close();
    await fecharFila();
    await fecharBanco();
});
