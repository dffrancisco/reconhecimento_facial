import { test, before, after } from "node:test";
import assert from "node:assert";
import ConexaoPostgres from "../src/db/conexaoPostgres";
import { iniciarConfig } from "../src/services/config";
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
    });
});

let conexao: ConexaoPostgres;
let ctrl: EventoCtrl;

before(async () => {
    conexao = new ConexaoPostgres();
    await conexao.open();
    ctrl = new EventoCtrl(conexao);
});

test("cria evento social como privado por padrão, com chave de acesso", async () => {
    const evento = await ctrl.criarEvento({ nome: "Festa Y", slug: `festa-${Date.now()}`, tipo: "social", data_fim: "2026-12-31" });
    assert.strictEqual(evento.privado, "S");
    assert.ok(evento.chave_acesso);
    assert.ok(evento.chave_anfitriao);
    assert.strictEqual(evento.config.exigir_whatsapp, false);
});

test("edita a config sem apagar os campos não informados", async () => {
    const evento = await ctrl.criarEvento({ nome: "Corrida X", slug: `corrida-${Date.now()}`, tipo: "esportivo", data_fim: "2026-12-31" });
    const editado = await ctrl.editarEvento({ id_evento: evento.id_evento, config: { limiar: 0.5 } });
    assert.strictEqual(editado.config.limiar, 0.5);
    assert.strictEqual(editado.config.max_selfies, 3);
});

test("evento privado que vira público perde a chave de acesso", async () => {
    const evento = await ctrl.criarEvento({ nome: "Festa Z", slug: `festa-z-${Date.now()}`, tipo: "social", data_fim: "2026-12-31" });
    const editado = await ctrl.editarEvento({ id_evento: evento.id_evento, privado: false });
    assert.strictEqual(editado.privado, "N");
    assert.strictEqual(editado.chave_acesso, null);
});

test("obterEvento com id inexistente lança ErroTratado", async () => {
    await assert.rejects(() => ctrl.obterEvento(999_999), ErroTratado);
});

test("recusa slug inválido", async () => {
    await assert.rejects(
        () => ctrl.criarEvento({ nome: "X", slug: "Slug Com Espaço", tipo: "esportivo", data_fim: "2026-12-31" }),
        ErroTratado
    );
});

after(async () => {
    await conexao?.close();
});
