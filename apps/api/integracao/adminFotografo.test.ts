import { test, before, after } from "node:test";
import assert from "node:assert";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { iniciarConfig } from "../src/services/config";
import FotografoCtrl from "../src/_ADMIN/fotografo/ctrl.fotografo";
import EventoCtrl from "../src/_ADMIN/evento/ctrl.evento";
import { ErroTratado } from "../src/services/erro";

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
        VISION_URL: "http://127.0.0.1:1",
    });
});

let conexao: ConexaoPostgres;
let ctrl: FotografoCtrl;
let idEvento: number;

before(async () => {
    conexao = new ConexaoPostgres();
    await conexao.open();
    ctrl = new FotografoCtrl(conexao);
    const evento = await new EventoCtrl(conexao).criarEvento({
        nome: "Evento p/ fotógrafo",
        slug: `evento-fotografo-${Date.now()}`,
        tipo: "esportivo",
        data_fim: "2026-12-31",
    });
    idEvento = evento.id_evento;
});

test("cria e lista fotógrafos", async () => {
    const fotografo = await ctrl.criarFotografo({ nome: "João", telefone: "+5511999998888" });
    const lista = await ctrl.listarFotografos();
    assert.ok(lista.some((f) => f.id_fotografo === fotografo.id_fotografo && f.nome === "João"));
});

test("vincula um fotógrafo a um evento e gera token_upload", async () => {
    const fotografo = await ctrl.criarFotografo({ nome: "Maria", telefone: null });
    const vinculo = await ctrl.vincularFotografo(idEvento, fotografo.id_fotografo);
    assert.match(vinculo.token_upload, /^[0-9a-f]{40}$/);
    assert.strictEqual(vinculo.id_evento, idEvento);
});

test("vincular de novo é idempotente: mesmo token_upload", async () => {
    const fotografo = await ctrl.criarFotografo({ nome: "Pedro", telefone: null });
    const primeiro = await ctrl.vincularFotografo(idEvento, fotografo.id_fotografo);
    const segundo = await ctrl.vincularFotografo(idEvento, fotografo.id_fotografo);
    assert.strictEqual(primeiro.token_upload, segundo.token_upload);
    assert.strictEqual(primeiro.id_evento_fotografo, segundo.id_evento_fotografo);
});

test("vincular a um evento inexistente lança ErroTratado", async () => {
    const fotografo = await ctrl.criarFotografo({ nome: "Carla", telefone: null });
    await assert.rejects(() => ctrl.vincularFotografo(999_999, fotografo.id_fotografo), ErroTratado);
});

after(async () => {
    await conexao?.close();
});

// Fecha o pool: sem isso o processo de teste fica ~30s ocioso antes de sair.
after(async () => {
    await fecharBanco();
});
