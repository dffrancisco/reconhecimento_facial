import { test, before, describe } from "node:test";
import assert from "node:assert";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { iniciarConfig } from "../src/services/config";
import { assinarUrlArquivo } from "../src/services/linkArquivo";

const executar = promisify(execFile);

// O nginx do compose de dev publica em 127.0.0.1:8080 e lê o volume fotos-vps.
const BASE = "http://127.0.0.1:8080";
const SEGREDO = "dev-somente-local";
const ID_EVENTO = 999001;
const HASH = "a".repeat(64);

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
        ARQUIVO_SEGREDO: SEGREDO,
        OPERADOR_SEGREDO: "a".repeat(32),
        VISION_URL: "http://127.0.0.1:1",
    });

    // Grava o arquivo pelo container da api-vps, que monta o mesmo volume que o nginx lê.
    // A suíte roda com cwd em apps/api: o compose fica dois níveis acima.
    const compose = path.resolve(__dirname, "..", "..", "..", "docker-compose.dev.yml");
    await executar("docker", [
        "compose", "-f", compose, "exec", "-T", "api-vps",
        "sh", "-lc", `mkdir -p /data/fotos/${ID_EVENTO} && printf 'conteudo-da-foto' > /data/fotos/${ID_EVENTO}/${HASH}_web.jpg`,
    ]);
});

describe("nginx /arquivos", () => {
    test("link assinado válido entrega o arquivo", async () => {
        const expira = Math.floor(Date.now() / 1000) + 600;
        const url = assinarUrlArquivo(`/arquivos/${ID_EVENTO}/${HASH}_web.jpg`, expira, SEGREDO);
        const resposta = await fetch(BASE + url);

        assert.strictEqual(resposta.status, 200);
        assert.strictEqual(await resposta.text(), "conteudo-da-foto");
    });

    test("assinatura adulterada é recusada", async () => {
        const expira = Math.floor(Date.now() / 1000) + 600;
        const url = assinarUrlArquivo(`/arquivos/${ID_EVENTO}/${HASH}_web.jpg`, expira, SEGREDO);
        const adulterada = url.replace(/md5=./, "md5=Z");

        assert.strictEqual((await fetch(BASE + adulterada)).status, 403);
    });

    test("link vencido é recusado", async () => {
        const expira = Math.floor(Date.now() / 1000) - 10;
        const url = assinarUrlArquivo(`/arquivos/${ID_EVENTO}/${HASH}_web.jpg`, expira, SEGREDO);

        assert.strictEqual((await fetch(BASE + url)).status, 410);
    });

    test("sem assinatura nenhuma é recusado", async () => {
        assert.strictEqual((await fetch(`${BASE}/arquivos/${ID_EVENTO}/${HASH}_web.jpg`)).status, 403);
    });

    test("?dl=1 marca o download como anexo", async () => {
        const expira = Math.floor(Date.now() / 1000) + 600;
        const url = assinarUrlArquivo(`/arquivos/${ID_EVENTO}/${HASH}_web.jpg`, expira, SEGREDO);
        const resposta = await fetch(`${BASE}${url}&dl=1`);

        assert.match(resposta.headers.get("content-disposition") ?? "", /attachment/);
    });
});
