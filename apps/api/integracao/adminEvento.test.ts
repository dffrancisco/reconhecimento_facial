import { test, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { config, iniciarConfig } from "../src/services/config";
import EventoCtrl from "../src/_ADMIN/evento/ctrl.evento";
import { ErroTratado } from "../src/services/erro";

const raizMarcasTeste = mkdtempSync(path.join(os.tmpdir(), "marcas-teste-"));

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
        RAIZ_MARCAS: raizMarcasTeste,
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

test("subirMarcaDagua com PNG válido grava o arquivo em config.raizMarcas", async () => {
    const evento = await ctrl.criarEvento({ nome: "Marca A", slug: `marca-${Date.now()}`, tipo: "esportivo", data_fim: "2026-12-31" });
    const png = await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .png()
        .toBuffer();

    const resultado = await ctrl.subirMarcaDagua(evento.id_evento, { data: png, mimetype: "image/png", size: png.length });
    assert.deepStrictEqual(resultado, { ok: true });

    const caminho = path.join(config.raizMarcas, `${evento.id_evento}.png`);
    const info = await fs.stat(caminho);
    assert.ok(info.isFile());
    assert.ok(info.size > 0);
});

test("subirMarcaDagua recusa mimetype que não é PNG", async () => {
    const evento = await ctrl.criarEvento({ nome: "Marca B", slug: `marca-b-${Date.now()}`, tipo: "esportivo", data_fim: "2026-12-31" });
    const falsoPng = Buffer.from("não é um png de verdade");

    await assert.rejects(
        () => ctrl.subirMarcaDagua(evento.id_evento, { data: falsoPng, mimetype: "image/jpeg", size: falsoPng.length }),
        ErroTratado
    );
});

test("subirMarcaDagua recusa arquivo maior que 2 MB", async () => {
    const evento = await ctrl.criarEvento({ nome: "Marca C", slug: `marca-c-${Date.now()}`, tipo: "esportivo", data_fim: "2026-12-31" });
    const grande = Buffer.alloc(2 * 1024 * 1024 + 1);

    await assert.rejects(
        () => ctrl.subirMarcaDagua(evento.id_evento, { data: grande, mimetype: "image/png", size: grande.length }),
        ErroTratado
    );
});

test("cria já com a config informada, mesclada sobre o padrão do tipo", async () => {
    const evento = await ctrl.criarEvento({
        nome: "Corrida W",
        slug: `corrida-w-${Date.now()}`,
        tipo: "esportivo",
        data_inicio: "2026-10-10",
        data_fim: "2026-10-11",
        config: { exigir_whatsapp: false },
    });
    assert.strictEqual(evento.config.exigir_whatsapp, false);
    assert.strictEqual(evento.config.max_selfies, 3);
    assert.strictEqual(evento.config.organizador, "Corrida W");
});

test("devolve as datas como texto, sem escorregar de dia pelo fuso", async () => {
    const evento = await ctrl.criarEvento({
        nome: "Datas",
        slug: `datas-texto-${Date.now()}`,
        tipo: "esportivo",
        data_inicio: "2026-10-10",
        data_fim: "2026-10-11",
    });
    assert.strictEqual(evento.data_inicio, "2026-10-10");
    assert.strictEqual(evento.data_fim, "2026-10-11");
    assert.strictEqual((await ctrl.obterEvento(evento.id_evento)).data_inicio, "2026-10-10");
    const naLista = (await ctrl.listarEventos()).find((e) => e.id_evento === evento.id_evento);
    assert.strictEqual(naLista?.data_fim, "2026-10-11");
});

test("endereço repetido vira mensagem clara, não erro 500", async () => {
    const slug = `repetido-${Date.now()}`;
    await ctrl.criarEvento({ nome: "A", slug, tipo: "esportivo", data_fim: "2026-12-31" });
    await assert.rejects(
        () => ctrl.criarEvento({ nome: "B", slug, tipo: "esportivo", data_fim: "2026-12-31" }),
        (erro: unknown) =>
            erro instanceof ErroTratado && erro.message === "Esse endereço já é de outro evento." && erro.codigo === "endereco_repetido"
    );
});

test("recusa fim antes do início, na criação e na edição", async () => {
    await assert.rejects(
        () => ctrl.criarEvento({ nome: "C", slug: `datas-c-${Date.now()}`, tipo: "esportivo", data_inicio: "2026-10-11", data_fim: "2026-10-10" }),
        /O fim do evento não pode ser antes do início/
    );
    const evento = await ctrl.criarEvento({ nome: "D", slug: `datas-d-${Date.now()}`, tipo: "esportivo", data_inicio: "2026-10-10", data_fim: "2026-10-10" });
    await assert.rejects(() => ctrl.editarEvento({ id_evento: evento.id_evento, data_fim: "2026-10-09" }), /O fim do evento não pode ser antes do início/);
});

test("editar com config fora da faixa recusa e não grava nada", async () => {
    const evento = await ctrl.criarEvento({ nome: "E", slug: `faixa-${Date.now()}`, tipo: "esportivo", data_fim: "2026-12-31" });
    await assert.rejects(() => ctrl.editarEvento({ id_evento: evento.id_evento, nome: "Outro", config: { max_selfies: 9 } }), /máximo de selfies/);
    const lido = await ctrl.obterEvento(evento.id_evento);
    assert.strictEqual(lido.nome, "E");
    assert.strictEqual(lido.config.max_selfies, 3);
});

test("campo desconhecido na config é ignorado", async () => {
    const evento = await ctrl.criarEvento({ nome: "F", slug: `extra-${Date.now()}`, tipo: "social", data_fim: "2026-12-31", config: { hackeado: true } });
    assert.strictEqual("hackeado" in evento.config, false);
});

test("editar com data de início vazia grava o evento sem início", async () => {
    const evento = await ctrl.criarEvento({ nome: "G", slug: `sem-inicio-${Date.now()}`, tipo: "esportivo", data_inicio: "2026-10-10", data_fim: "2026-10-10" });
    const editado = await ctrl.editarEvento({ id_evento: evento.id_evento, data_inicio: "" });
    assert.strictEqual(editado.data_inicio, null);
});

after(async () => {
    await conexao?.close();
    await fs.rm(raizMarcasTeste, { recursive: true, force: true });
});

// Fecha o pool: sem isso o processo de teste fica ~30s ocioso antes de sair.
after(async () => {
    await fecharBanco();
});
