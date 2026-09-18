import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import path from "node:path";
import { Client } from "pg";
import { aplicarPendentes, listarMigracoes, reverterUltima } from "../migrador";
import { tPapel } from "../migrateParse";
import { criarBancoTeste, tabelas } from "./bancoTeste";

const MIGRACOES = listarMigracoes(path.join(__dirname, "..", "migrations"));
const CONTROLE = ["schema_migrations", "schema_papel"];

const TABELAS_VPS = [
    "aparelho", "arquivo_zip", "busca", "busca_foto", "calibracao", "estacao_sinal", "evento",
    "evento_fotografo", "evento_patrocinador", "evento_resumo", "foto", "fotografo", "log",
    "numero_peito", "operador", "participante", "participante_evento", "rosto",
];
const TABELAS_ESTACAO = ["evento", "evento_fotografo", "foto", "fotografo", "numero_peito", "operador", "rosto", "upload"];

function vetor(posicao: number): string {
    const v = new Array(512).fill(0);
    v[posicao] = 1;
    return `[${v.join(",")}]`;
}

async function novoEvento(client: Client, slug: string): Promise<number> {
    const { rows } = await client.query(
        `INSERT INTO evento (nome, slug, tipo, chave_anfitriao, data_fim)
         VALUES ($1, $1, 'esportivo', $2, '2026-12-31') RETURNING id_evento`,
        [slug, `anf-${slug}`]
    );
    return rows[0].id_evento;
}

async function novaFotoVps(client: Client, idEvento: number, hash: string, situacao = "visivel"): Promise<number> {
    const { rows } = await client.query(
        `INSERT INTO foto (id_evento, hash_arquivo, largura, altura, bytes_web, situacao)
         VALUES ($1, $2, 2048, 1365, 500000, $3) RETURNING id_foto`,
        [idEvento, hash, situacao]
    );
    return rows[0].id_foto;
}

async function novoRosto(client: Client, idFoto: number, idEvento: number, embedding: string): Promise<void> {
    await client.query(
        `INSERT INTO rosto (id_foto, id_evento, embedding, bbox, det_score, area_px)
         VALUES ($1, $2, $3::vector, '[0,0,10,10]', 0.9, 100)`,
        [idFoto, idEvento, embedding]
    );
}

async function desfazerTudo(client: Client, papel: tPapel): Promise<void> {
    while (await reverterUltima(client, MIGRACOES, papel)) {}
}

describe("schema da VPS", () => {
    let banco: { client: Client; remover(): Promise<void> };

    before(async () => {
        banco = await criarBancoTeste();
        await aplicarPendentes(banco.client, MIGRACOES, "vps");
    });

    after(async () => {
        await banco.remover();
    });

    test("cria exatamente as tabelas da VPS", async () => {
        assert.deepStrictEqual(await tabelas(banco.client), [...TABELAS_VPS, ...CONTROLE].sort());
    });

    test("pgvector é 0.8 ou mais novo", async () => {
        const { rows } = await banco.client.query("SELECT extversion FROM pg_extension WHERE extname = 'vector'");
        const [maior, menor] = String(rows[0].extversion).split(".").map(Number);

        assert.ok(maior > 0 || menor >= 8, `pgvector ${rows[0].extversion}`);
    });

    test("rosto tem índice HNSW por cosseno", async () => {
        const { rows } = await banco.client.query("SELECT indexdef FROM pg_indexes WHERE indexname = 'ix_rosto_embedding'");

        assert.match(rows[0].indexdef, /USING hnsw \(embedding vector_cosine_ops\)/);
        assert.match(rows[0].indexdef, /m='16'/);
        assert.match(rows[0].indexdef, /ef_construction='200'/);
    });

    test("a consulta do spec filtra evento e foto oculta", async () => {
        const a = await novoEvento(banco.client, "corrida-a");
        const b = await novoEvento(banco.client, "corrida-b");
        const visivel = await novaFotoVps(banco.client, a, "h1");
        const oculta = await novaFotoVps(banco.client, a, "h2", "oculta");
        const outroEvento = await novaFotoVps(banco.client, b, "h3");
        const outraPessoa = await novaFotoVps(banco.client, a, "h4");
        await novoRosto(banco.client, visivel, a, vetor(0));
        await novoRosto(banco.client, oculta, a, vetor(0));
        await novoRosto(banco.client, outroEvento, b, vetor(0));
        await novoRosto(banco.client, outraPessoa, a, vetor(1));

        await banco.client.query("BEGIN");
        await banco.client.query("SET LOCAL hnsw.ef_search = 100");
        await banco.client.query("SET LOCAL hnsw.iterative_scan = relaxed_order");
        const { rows } = await banco.client.query(
            `SELECT r.id_foto, 1 - (r.embedding <=> $1::vector) AS similaridade
               FROM rosto r
               JOIN foto f ON f.id_foto = r.id_foto AND f.situacao = 'visivel'
              WHERE r.id_evento = $2
              ORDER BY r.embedding <=> $1::vector
              LIMIT 400`,
            [vetor(0), a]
        );
        await banco.client.query("COMMIT");

        assert.deepStrictEqual(
            rows.map((r) => [r.id_foto, Math.round(r.similaridade)]),
            [[visivel, 1], [outraPessoa, 0]]
        );
    });

    test("foto é única por evento e hash", async () => {
        const e = await novoEvento(banco.client, "unica");
        await novaFotoVps(banco.client, e, "repetido");

        await assert.rejects(novaFotoVps(banco.client, e, "repetido"), /ux_foto_evento_hash/);
    });

    test("apagar a foto leva rostos e vínculos de busca junto", async () => {
        const e = await novoEvento(banco.client, "cascata");
        const foto = await novaFotoVps(banco.client, e, "c1");
        await novoRosto(banco.client, foto, e, vetor(2));
        const { rows } = await banco.client.query(
            `INSERT INTO busca (id_evento, token, status, consentimento_em, versao_termo)
             VALUES ($1, 'tok-cascata', 'liberada', now(), 'v1') RETURNING id_busca`,
            [e]
        );
        await banco.client.query("INSERT INTO busca_foto (id_busca, id_foto, similaridade) VALUES ($1, $2, 0.9)", [
            rows[0].id_busca,
            foto,
        ]);

        await banco.client.query("DELETE FROM foto WHERE id_foto = $1", [foto]);

        const rostos = await banco.client.query("SELECT 1 FROM rosto WHERE id_foto = $1", [foto]);
        const vinculos = await banco.client.query("SELECT 1 FROM busca_foto WHERE id_foto = $1", [foto]);
        assert.strictEqual(rostos.rowCount, 0);
        assert.strictEqual(vinculos.rowCount, 0);
    });

    test("código de busca é único só entre as aguardando", async () => {
        const e = await novoEvento(banco.client, "codigos");
        const inserir = (token: string) =>
            banco.client.query(
                `INSERT INTO busca (id_evento, token, codigo, status, consentimento_em, versao_termo)
                 VALUES ($1, $2, '12345', 'aguardando', now(), 'v1')`,
                [e, token]
            );

        await inserir("t1");
        await assert.rejects(inserir("t2"), /ux_busca_codigo_aguardando/);

        await banco.client.query("UPDATE busca SET status = 'expirada' WHERE token = 't1'");
        await inserir("t2");
    });

    test("evento privado exige chave de acesso", async () => {
        await assert.rejects(
            banco.client.query(
                `INSERT INTO evento (nome, slug, tipo, privado, chave_anfitriao, data_fim)
                 VALUES ('Casamento', 'casamento', 'social', 'S', 'anf-cas', '2026-12-31')`
            ),
            /violates check constraint/
        );
    });

    test("índices de exclusão em lote existem", async () => {
        const { rows } = await banco.client.query(
            "SELECT indexname FROM pg_indexes WHERE indexname = ANY($1)",
            [
                [
                    "ix_busca_origem",
                    "ix_arquivo_zip_busca",
                    "ix_arquivo_zip_evento",
                    "ix_participante_evento_evento",
                    "ix_aparelho_participante_evento",
                    "ix_calibracao_evento",
                ],
            ]
        );
        assert.strictEqual(rows.length, 6);
    });

    test("desfazer tudo volta ao banco vazio e refazer funciona", async () => {
        await desfazerTudo(banco.client, "vps");
        assert.deepStrictEqual(await tabelas(banco.client), CONTROLE);

        const feitas = await aplicarPendentes(banco.client, MIGRACOES, "vps");
        assert.strictEqual(feitas.length, 6);
    });
});

describe("schema da estação", () => {
    let banco: { client: Client; remover(): Promise<void> };

    before(async () => {
        banco = await criarBancoTeste();
        await aplicarPendentes(banco.client, MIGRACOES, "estacao");
    });

    after(async () => {
        await banco.remover();
    });

    test("cria exatamente as tabelas da estação", async () => {
        assert.deepStrictEqual(await tabelas(banco.client), [...TABELAS_ESTACAO, ...CONTROLE].sort());
    });

    test("evento ganha encerrado_em", async () => {
        const { rowCount } = await banco.client.query(
            "SELECT 1 FROM information_schema.columns WHERE table_name = 'evento' AND column_name = 'encerrado_em'"
        );
        assert.strictEqual(rowCount, 1);
    });

    test("rosto não tem índice HNSW", async () => {
        const { rowCount } = await banco.client.query(
            "SELECT 1 FROM pg_indexes WHERE tablename = 'rosto' AND indexdef ILIKE '%hnsw%'"
        );
        assert.strictEqual(rowCount, 0);
    });

    test("foto nasce na etapa registrada e recusa etapa desconhecida", async () => {
        const e = await novoEvento(banco.client, "estacao-etapa");
        const { rows } = await banco.client.query(
            "INSERT INTO foto (id_evento, hash_arquivo, nome_arquivo) VALUES ($1, 'h1', 'IMG_0001.JPG') RETURNING etapa",
            [e]
        );
        assert.strictEqual(rows[0].etapa, "registrada");

        await assert.rejects(
            banco.client.query(
                "INSERT INTO foto (id_evento, hash_arquivo, nome_arquivo, etapa) VALUES ($1, 'h2', 'x.jpg', 'pronta')",
                [e]
            ),
            /violates check constraint/
        );
    });

    test("índice de exclusão em lote existe", async () => {
        const { rowCount } = await banco.client.query(
            "SELECT 1 FROM pg_indexes WHERE indexname = 'ix_rosto_evento'"
        );
        assert.strictEqual(rowCount, 1);
    });

    test("desfazer tudo volta ao banco vazio e refazer funciona", async () => {
        await desfazerTudo(banco.client, "estacao");
        assert.deepStrictEqual(await tabelas(banco.client), CONTROLE);

        const feitas = await aplicarPendentes(banco.client, MIGRACOES, "estacao");
        assert.strictEqual(feitas.length, 4);
    });
});
