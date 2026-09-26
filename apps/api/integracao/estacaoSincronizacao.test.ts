import { test, before, after } from "node:test";
import assert from "node:assert";
import ConexaoPostgres from "../src/db/conexaoPostgres";
import { iniciarConfig, config } from "../src/services/config";
import EventoCtrl from "../src/_ADMIN/evento/ctrl.evento";
import FotografoCtrl from "../src/_ADMIN/fotografo/ctrl.fotografo";
import { criarOperador } from "../src/scripts/criarOperador";
import per from "../src/services/per";
import Sincronizacao from "../src/_ESTACAO/sincronizacao/route.sincronizacao";

before(() => {
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
    });
});

function resFalso() {
    const chamadas: { status?: number; body?: unknown } = {};
    return {
        chamadas,
        status(codigo: number) {
            chamadas.status = codigo;
            return this;
        },
        send(corpo: unknown) {
            chamadas.body = corpo;
        },
    };
}

let conexao: ConexaoPostgres;

before(async () => {
    conexao = new ConexaoPostgres();
    await conexao.open();
});

test("devolve operadores, eventos ativos, fotógrafos e vínculos", async () => {
    await criarOperador(conexao, "Ana", `sync-op-${Date.now()}`, "senha-123456");
    const evento = await new EventoCtrl(conexao).criarEvento({
        nome: "Evento Sync",
        slug: `evento-sync-${Date.now()}`,
        tipo: "esportivo",
        data_fim: "2026-12-31",
    });
    const fotografoCtrl = new FotografoCtrl(conexao);
    const fotografo = await fotografoCtrl.criarFotografo({ nome: "Fotógrafo Sync", telefone: null });
    await fotografoCtrl.vincularFotografo(evento.id_evento, fotografo.id_fotografo);

    const res = resFalso();
    await per(
        { body: { call: "getSincronizacao" }, headers: { authorization: config.estacaoChave } } as any,
        res as never,
        () => {},
        Sincronizacao
    );

    const corpo = res.chamadas.body as {
        operadores: unknown[];
        eventos: { id_evento: number }[];
        fotografos: { id_fotografo: number }[];
        vinculos: { id_evento: number; id_fotografo: number }[];
    };
    assert.ok(corpo.operadores.length > 0);
    assert.ok(corpo.eventos.some((e) => e.id_evento === evento.id_evento));
    assert.ok(corpo.fotografos.some((f) => f.id_fotografo === fotografo.id_fotografo));
    assert.ok(corpo.vinculos.some((v) => v.id_evento === evento.id_evento && v.id_fotografo === fotografo.id_fotografo));
});

test("recusa sem a chave da estação", async () => {
    const res = resFalso();
    await per({ body: { call: "getSincronizacao" }, headers: {} } as any, res as never, () => {}, Sincronizacao);
    assert.strictEqual(res.chamadas.status, 422);
});

after(async () => {
    await conexao?.close();
});
