import { test, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ConexaoPostgres from "../src/db/conexaoPostgres";
import { iniciarConfig } from "../src/services/config";
import { criarFila, fecharFila } from "../src/services/fila";
import { NOME_FILA } from "../src/jobs/processarFoto";
import { ingerir } from "../src/scripts/ingerir";

let conexao: ConexaoPostgres;
let pasta: string;
let slug: string;

before(async () => {
    iniciarConfig({
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
    });

    conexao = new ConexaoPostgres();
    await conexao.open();
    slug = `evento-ingerir-${Date.now()}`;
    // Id explícito: na estação todo evento vem da VPS com o id de lá (a sequence do serial não é usada).
    await conexao.executeParamCount(
        `INSERT INTO evento (id_evento, nome, slug, tipo, privado, chave_anfitriao, data_fim, config)
         VALUES ((SELECT COALESCE(MAX(id_evento), 0) + 1 FROM evento), 'Teste', ?, 'esportivo', 'N', ?, '2026-12-31', '{}')`,
        [slug, `anfitriao-${Date.now()}`]
    );

    pasta = await fs.mkdtemp(path.join(os.tmpdir(), "ingerir-teste-"));
    await fs.writeFile(path.join(pasta, "a.jpg"), "conteudo-a");
    await fs.writeFile(path.join(pasta, "b.JPG"), "conteudo-b");
    await fs.writeFile(path.join(pasta, "nao-e-foto.txt"), "ignorar");
    await fs.mkdir(path.join(pasta, "subpasta"));
    await fs.writeFile(path.join(pasta, "subpasta", "c.jpg"), "nao deve entrar");
});

test("enfileira só os JPEGs do nível raiz", async () => {
    const [evento] = await conexao.queryParam<{ id_evento: number }>("SELECT id_evento FROM evento WHERE slug = ?", [slug]);
    const resultado = await ingerir(conexao, { slug, pasta, idEventoFotografo: null });

    assert.strictEqual(resultado.enfileiradas, 2);

    const fila = criarFila<{ id_evento: number; copiar: boolean }>(NOME_FILA);
    const aguardando = await fila.getWaiting();
    const jobsDoEvento = aguardando.filter((job) => job.data.id_evento === evento.id_evento);
    assert.strictEqual(jobsDoEvento.length, 2);
    assert.ok(jobsDoEvento.every((job) => job.data.copiar === true));
});

test("recusa evento inexistente", async () => {
    await assert.rejects(() => ingerir(conexao, { slug: "nao-existe-mesmo", pasta, idEventoFotografo: null }));
});

after(async () => {
    await conexao?.close();
    await fs.rm(pasta, { recursive: true, force: true });
    // Sem fechar a conexão Redis da fila, o processo de teste não encerra.
    await fecharFila();
});
