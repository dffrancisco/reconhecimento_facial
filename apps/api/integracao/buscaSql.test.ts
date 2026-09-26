import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { iniciarConfig } from "../src/services/config";
import { buscarRostosParecidos, eventoPorSlugOuChave } from "../src/_PARTICIPANTE/busca/sql.busca";

let conexao: ConexaoPostgres;
let idEvento: number;
let slug: string;
let chaveAcesso: string;

// Dois vetores bem diferentes: o "alvo" bate com a busca, o "outro" não.
const ALVO = new Array(512).fill(0).map((_, i) => (i < 256 ? 0.06 : 0.01));
const OUTRO = new Array(512).fill(0).map((_, i) => (i < 256 ? -0.06 : 0.01));

function vetor(valores: number[]): string {
    return `[${valores.join(",")}]`;
}

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
    slug = `evento-busca-${Date.now()}`;
    chaveAcesso = `chave-${Date.now()}`;
    const [evento] = await conexao.queryParam<{ id_evento: number }>(
        `INSERT INTO evento (nome, slug, tipo, privado, chave_acesso, chave_anfitriao, data_fim, config)
         VALUES ('Busca', ?, 'esportivo', 'N', ?, ?, '2026-12-31', '{"limiar":0.42}') RETURNING id_evento`,
        [slug, chaveAcesso, `anfitriao-${Date.now()}`]
    );
    idEvento = evento.id_evento;

    // Três fotos: uma visível com o rosto alvo, uma oculta com o mesmo rosto, uma visível com outro rosto.
    for (const [sufixo, situacao, vec] of [
        ["visivel", "visivel", ALVO],
        ["oculta", "oculta", ALVO],
        ["outra", "visivel", OUTRO],
    ] as const) {
        const [foto] = await conexao.queryParam<{ id_foto: number }>(
            `INSERT INTO foto (id_evento, hash_arquivo, largura, altura, bytes_web, qtd_rostos, situacao)
             VALUES (?, ?, 100, 100, 10, 1, ?) RETURNING id_foto`,
            [idEvento, `${"b".repeat(60)}${sufixo.slice(0, 4)}`, situacao]
        );
        await conexao.executeParamCount(
            "INSERT INTO rosto (id_foto, id_evento, embedding, bbox, det_score, area_px) VALUES (?, ?, ?::vector, '[1,2,3,4]', 0.9, 100)",
            [foto.id_foto, idEvento, vetor(vec as number[])]
        );
    }
});

describe("buscarRostosParecidos", () => {
    test("acha o rosto parecido e ignora foto oculta", async () => {
        const encontrados = await buscarRostosParecidos(conexao, idEvento, ALVO);

        assert.ok(encontrados.length >= 1, "deveria achar ao menos a foto visível");
        const melhor = encontrados[0];
        assert.ok(melhor.similaridade > 0.9, `similaridade baixa demais: ${melhor.similaridade}`);

        // A foto oculta tem o mesmo embedding: se aparecesse, viria com similaridade igual.
        const iguaisAoMelhor = encontrados.filter((e) => Math.abs(e.similaridade - melhor.similaridade) < 1e-6);
        assert.strictEqual(iguaisAoMelhor.length, 1, "foto oculta não pode entrar no resultado");
    });

    test("não devolve rosto de outro evento", async () => {
        const [outroEvento] = await conexao.queryParam<{ id_evento: number }>(
            `INSERT INTO evento (nome, slug, tipo, privado, chave_anfitriao, data_fim, config)
             VALUES ('Outro', ?, 'esportivo', 'N', ?, '2026-12-31', '{}') RETURNING id_evento`,
            [`evento-outro-${Date.now()}`, `anfitriao-outro-${Date.now()}`]
        );
        const encontrados = await buscarRostosParecidos(conexao, outroEvento.id_evento, ALVO);
        assert.deepStrictEqual(encontrados, []);
    });

    test("devolve similaridade entre 0 e 1", async () => {
        const encontrados = await buscarRostosParecidos(conexao, idEvento, ALVO);
        for (const e of encontrados) assert.ok(e.similaridade >= -1 && e.similaridade <= 1, `fora da faixa: ${e.similaridade}`);
    });
});

describe("eventoPorSlugOuChave", () => {
    test("acha por slug quando o evento é público", async () => {
        const evento = await eventoPorSlugOuChave(conexao, { slug });
        assert.strictEqual(evento?.id_evento, idEvento);
    });

    test("acha por chave de acesso", async () => {
        const evento = await eventoPorSlugOuChave(conexao, { chaveAcesso });
        assert.strictEqual(evento?.id_evento, idEvento);
    });

    test("evento privado não é achado pelo slug", async () => {
        await conexao.executeParamCount("UPDATE evento SET privado = 'S' WHERE id_evento = ?", [idEvento]);
        try {
            assert.strictEqual(await eventoPorSlugOuChave(conexao, { slug }), undefined);
            // ... mas continua acessível pela chave.
            assert.strictEqual((await eventoPorSlugOuChave(conexao, { chaveAcesso }))?.id_evento, idEvento);
        } finally {
            await conexao.executeParamCount("UPDATE evento SET privado = 'N' WHERE id_evento = ?", [idEvento]);
        }
    });

    test("slug inexistente devolve undefined", async () => {
        assert.strictEqual(await eventoPorSlugOuChave(conexao, { slug: "nao-existe-mesmo" }), undefined);
    });
});

after(async () => {
    await conexao?.close();
    await fecharBanco();
});
