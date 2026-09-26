import { test, before, after } from "node:test";
import assert from "node:assert";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { iniciarConfig } from "../src/services/config";

const executar = promisify(execFile);
let conexao: ConexaoPostgres;
let pasta: string;
let slug: string;

const ambiente = {
    PAPEL: "estacao",
    POSTGRES_HOST: "127.0.0.1",
    POSTGRES_PORT: "5433",
    POSTGRES_USER: "fotos",
    POSTGRES_PASSWORD: "fotos",
    POSTGRES_DB: "fotos_estacao",
    REDIS_URL: "redis://127.0.0.1:6380",
    ESTACAO_CHAVE: "a".repeat(32),
    VPS_URL: "http://127.0.0.1:1",
    VISION_URL: "http://127.0.0.1:1",
};

before(async () => {
    iniciarConfig(ambiente);
    conexao = new ConexaoPostgres();
    await conexao.open();
    slug = `evento-cli-${Date.now()}`;
    await conexao.executeParamCount(
        `INSERT INTO evento (id_evento, nome, slug, tipo, privado, chave_anfitriao, data_fim, config)
         VALUES ((SELECT COALESCE(MAX(id_evento), 0) + 1 FROM evento), 'Teste CLI', ?, 'esportivo', 'N', ?, '2026-12-31', '{}')`,
        [slug, `anfitriao-cli-${Date.now()}`]
    );
    pasta = await fs.mkdtemp(path.join(os.tmpdir(), "ingerir-cli-"));
    await fs.writeFile(path.join(pasta, "a.jpg"), `conteudo-cli-${Date.now()}`);
});

// O operador roda isto num terminal (ou num script): o comando tem que devolver o prompt.
test("o comando ingerir termina sozinho depois de enfileirar", async () => {
    const { stdout } = await executar(
        process.execPath,
        ["--import", "tsx", "src/scripts/ingerir.ts", "--evento", slug, "--pasta", pasta],
        { cwd: path.join(__dirname, ".."), env: { ...process.env, ...ambiente }, timeout: 25_000 }
    );
    assert.match(stdout, /1 fotos enfileiradas/);
});

after(async () => {
    await conexao?.close();
    await fs.rm(pasta, { recursive: true, force: true });
});

// Fecha o pool: sem isso o processo de teste fica ~30s ocioso antes de sair.
after(async () => {
    await fecharBanco();
});
