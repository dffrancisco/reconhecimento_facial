import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { iniciarConfig } from "../src/services/config";
import { codigoEmUso } from "../src/_PARTICIPANTE/busca/sql.busca";

let conexao: ConexaoPostgres;
let idEvento: number;

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
        ARQUIVO_SEGREDO: "x",
        OPERADOR_SEGREDO: "a".repeat(32),
        VISION_URL: "http://127.0.0.1:1",
    });
    conexao = new ConexaoPostgres();
    await conexao.open();
    const [evento] = await conexao.queryParam<{ id_evento: number }>(
        `INSERT INTO evento (nome, slug, tipo, privado, chave_anfitriao, data_fim, config)
         VALUES ('Codigo', ?, 'esportivo', 'N', ?, '2026-12-31', '{}') RETURNING id_evento`,
        [`evento-codigo-${Date.now()}`, `anfitriao-cod-${Date.now()}`]
    );
    idEvento = evento.id_evento;
});

describe("codigoEmUso", () => {
    // O índice único `ux_busca_codigo_aguardando` olha só `status = 'aguardando'`, sem a
    // expiração. Se a checagem for mais frouxa que o índice, o INSERT seguinte estoura com
    // 23505 e o participante recebe 500 — perdendo a busca e o consentimento.
    test("código de busca aguardando vencida continua em uso, como o índice cobra", async () => {
        const codigo = String(Math.floor(Math.random() * 90000) + 10000);
        await conexao.executeParamCount(
            `INSERT INTO busca (id_evento, token, codigo, status, qtd_fotos, consentimento_em, versao_termo, codigo_expira_em)
             VALUES (?, ?, ?, 'aguardando', 1, now(), 'v1', now() - interval '1 hour')`,
            [idEvento, `tok-cod-${Date.now()}`, codigo]
        );

        assert.strictEqual(await codigoEmUso(conexao, codigo), true, "o código vencido ainda ocupa o índice");
    });

    test("código que ninguém usou está livre", async () => {
        assert.strictEqual(await codigoEmUso(conexao, "00001"), false);
    });
});

after(async () => {
    await conexao?.close();
    await fecharBanco();
});
