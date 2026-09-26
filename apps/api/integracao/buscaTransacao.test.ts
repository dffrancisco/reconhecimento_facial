import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { iniciarConfig } from "../src/services/config";
import { buscarRostosParecidos } from "../src/_PARTICIPANTE/busca/sql.busca";

let conexao: ConexaoPostgres;
let observador: ConexaoPostgres;
let idEvento: number;

const ALVO = new Array(512).fill(0.02);

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
    observador = new ConexaoPostgres();
    await observador.open();

    const [evento] = await conexao.queryParam<{ id_evento: number }>(
        `INSERT INTO evento (nome, slug, tipo, privado, chave_anfitriao, data_fim, config)
         VALUES ('Transacao', ?, 'esportivo', 'N', ?, '2026-12-31', '{}') RETURNING id_evento`,
        [`evento-tx-${Date.now()}`, `anfitriao-tx-${Date.now()}`]
    );
    idEvento = evento.id_evento;

    // Um rosto de verdade: sem linha para comparar, o operador `<=>` nem chega a validar a
    // dimensão do vetor e a consulta de dimensão errada não falharia.
    const [foto] = await conexao.queryParam<{ id_foto: number }>(
        `INSERT INTO foto (id_evento, hash_arquivo, largura, altura, bytes_web, qtd_rostos, situacao)
         VALUES (?, ?, 100, 100, 10, 1, 'visivel') RETURNING id_foto`,
        [idEvento, "7".repeat(64)]
    );
    await conexao.executeParamCount(
        "INSERT INTO rosto (id_foto, id_evento, embedding, bbox, det_score, area_px) VALUES (?, ?, ?::vector, '[1,2,3,4]', 0.9, 100)",
        [foto.id_foto, idEvento, `[${ALVO.join(",")}]`]
    );
});

async function contarPresos(): Promise<number> {
    const [linha] = await observador.queryParam<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE datname = current_database() AND state = 'idle in transaction' AND application_name = ?`,
        ["fotos-api:vps"]
    );
    return linha.n;
}

describe("buscarRostosParecidos", () => {
    // A consulta abre transação para usar SET LOCAL. Se o BEGIN for por `pool.query`, o
    // backend volta ao pool com a transação aberta e o pedido seguinte cai dentro dela:
    // `now()` congela no instante do BEGIN alheio, e um ROLLBACK daquela busca descarta o que
    // este pedido gravou. Várias rodadas porque a corrida depende do tempo da consulta.
    // Um embedding de dimensão errada (vision trocado de modelo, por exemplo) faz o SELECT
    // falhar no meio da transação. Se o BEGIN e o ROLLBACK forem por `pool.query`, eles caem
    // em backends diferentes e sobra um preso em "idle in transaction" — que volta ao pool e
    // engole as gravações do próximo pedido que cair nele.
    test("erro na consulta não deixa backend preso em transação", async () => {
        const presosAntes = await contarPresos();

        await assert.rejects(() => buscarRostosParecidos(conexao, idEvento, [1, 2, 3]));

        assert.strictEqual(await contarPresos(), presosAntes, "a transação da consulta vazou para o pool");
    });

    test("a consulta continua devolvendo resultado", async () => {
        const encontrados = await buscarRostosParecidos(conexao, idEvento, ALVO);
        assert.ok(Array.isArray(encontrados));
    });
});

after(async () => {
    await conexao?.close();
    await observador?.close();
    await fecharBanco();
});
