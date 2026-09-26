import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import express from "express";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { iniciarConfig } from "../src/services/config";
import per from "../src/services/per";
import Resultado from "../src/_PARTICIPANTE/resultado/route.resultado";

let servidor: Server;
let base: string;
let conexao: ConexaoPostgres;
let idEvento: number;
let tokenLiberado: string;
let tokenAguardando: string;
let idFoto: number;

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
    const [evento] = await conexao.queryParam<{ id_evento: number }>(
        `INSERT INTO evento (nome, slug, tipo, privado, chave_anfitriao, data_fim, config)
         VALUES ('Resultado', ?, 'esportivo', 'N', ?, '2026-12-31', '{"validade_resultado_dias":7}') RETURNING id_evento`,
        [`evento-resultado-${Date.now()}`, `anfitriao-res-${Date.now()}`]
    );
    idEvento = evento.id_evento;

    const [foto] = await conexao.queryParam<{ id_foto: number }>(
        `INSERT INTO foto (id_evento, hash_arquivo, largura, altura, bytes_web, qtd_rostos, situacao)
         VALUES (?, ?, 100, 100, 10, 1, 'visivel') RETURNING id_foto`,
        [idEvento, "d".repeat(64)]
    );
    idFoto = foto.id_foto;

    tokenLiberado = `tok-lib-${Date.now()}`;
    tokenAguardando = `tok-agu-${Date.now()}`;
    for (const [token, status] of [
        [tokenLiberado, "liberada"],
        [tokenAguardando, "aguardando"],
    ] as const) {
        const [busca] = await conexao.queryParam<{ id_busca: number }>(
            `INSERT INTO busca (id_evento, token, status, qtd_fotos, consentimento_em, versao_termo)
             VALUES (?, ?, ?, 1, now(), 'v1') RETURNING id_busca`,
            [idEvento, token, status]
        );
        await conexao.executeParamCount(
            "INSERT INTO busca_foto (id_busca, id_foto, id_rosto, similaridade) VALUES (?, ?, NULL, 0.8)",
            [busca.id_busca, idFoto]
        );
    }

    const app = express();
    app.use(express.json());
    app.post("/resultado", (req, res, next) => per(req, res, next, Resultado));
    servidor = app.listen(0);
    await new Promise((resolve) => servidor.once("listening", resolve));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

async function chamar(corpo: object) {
    const resposta = await fetch(`${base}/resultado`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
    });
    return { status: resposta.status, corpo: (await resposta.json()) as Record<string, unknown> };
}

describe("getResultado", () => {
    test("busca liberada devolve as fotos com thumb assinado", async () => {
        const r = await chamar({ call: "getResultado", token: tokenLiberado });

        assert.strictEqual(r.status, 200);
        const fotos = r.corpo.fotos as { id_foto: number; thumb: string }[];
        assert.strictEqual(fotos.length, 1);
        assert.match(fotos[0].thumb, /_thumb\.jpg\?md5=.+&expires=\d+$/);
    });

    test("busca aguardando não entrega foto nenhuma", async () => {
        const r = await chamar({ call: "getResultado", token: tokenAguardando });

        assert.strictEqual(r.status, 422);
        assert.ok(!JSON.stringify(r.corpo).includes("_thumb.jpg"));
    });

    test("token inexistente é recusado com a mesma mensagem", async () => {
        const r = await chamar({ call: "getResultado", token: "nao-existe" });
        assert.strictEqual(r.status, 422);
    });

    test("foto oculta depois da busca some do resultado", async () => {
        await conexao.executeParamCount("UPDATE foto SET situacao = 'oculta' WHERE id_foto = ?", [idFoto]);
        try {
            const r = await chamar({ call: "getResultado", token: tokenLiberado });
            assert.strictEqual((r.corpo.fotos as unknown[]).length, 0);
        } finally {
            await conexao.executeParamCount("UPDATE foto SET situacao = 'visivel' WHERE id_foto = ?", [idFoto]);
        }
    });

    test("resultado fora da validade é recusado", async () => {
        await conexao.executeParamCount("UPDATE busca SET criado_em = now() - interval '30 days' WHERE token = ?", [tokenLiberado]);
        try {
            const r = await chamar({ call: "getResultado", token: tokenLiberado });
            assert.strictEqual(r.status, 422);
            assert.match(String(r.corpo.msg), /prazo|expir|venc/i);
        } finally {
            await conexao.executeParamCount("UPDATE busca SET criado_em = now() WHERE token = ?", [tokenLiberado]);
        }
    });
});

describe("situacao", () => {
    test("devolve o status sem expor foto", async () => {
        const r = await chamar({ call: "situacao", token: tokenAguardando });

        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.corpo.status, "aguardando");
        assert.ok(!JSON.stringify(r.corpo).includes("arquivos/"));
    });
});

describe("gerarLinks", () => {
    test("devolve link de download e soma no contador", async () => {
        const r = await chamar({ call: "gerarLinks", token: tokenLiberado, ids: [idFoto] });

        const links = r.corpo.links as { id_foto: number; url: string }[];
        assert.strictEqual(links.length, 1);
        assert.match(links[0].url, /_web\.jpg\?md5=.+&expires=\d+&dl=1$/);

        const [busca] = await conexao.queryParam<{ qtd_downloads: number }>("SELECT qtd_downloads FROM busca WHERE token = ?", [tokenLiberado]);
        assert.strictEqual(busca.qtd_downloads, 1);
    });

    test("não gera link para foto que não é da busca", async () => {
        const [outra] = await conexao.queryParam<{ id_foto: number }>(
            `INSERT INTO foto (id_evento, hash_arquivo, largura, altura, bytes_web, qtd_rostos, situacao)
             VALUES (?, ?, 100, 100, 10, 1, 'visivel') RETURNING id_foto`,
            [idEvento, "e".repeat(64)]
        );

        const r = await chamar({ call: "gerarLinks", token: tokenLiberado, ids: [outra.id_foto] });
        assert.deepStrictEqual(r.corpo.links, []);
    });
});

after(async () => {
    servidor?.close();
    await conexao?.close();
    await fecharBanco();
});
