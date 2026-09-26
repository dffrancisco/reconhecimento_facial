import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import express from "express";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { config, iniciarConfig } from "../src/services/config";
import { fecharFila, obterRedis } from "../src/services/fila";
import { gerarHashSenha } from "../src/services/senha";
import { registrarSincronizacao } from "../src/services/sincronizacaoEstacao";
import per from "../src/services/per";
import Login from "../src/_PAINEL/login/route.login";
import Painel from "../src/_PAINEL/painel/route.painel";
import { envTeste } from "./ambiente";

let servidor: Server;
let base: string;
let conexao: ConexaoPostgres;
let pasta: string;
let idEvento: number;
let idVinculoAna: number;
const sufixo = Date.now();
const login = `operador-painel-${sufixo}`;
const ENV = () => ({ ...envTeste("estacao"), RAIZ_UPLOADS: path.join(pasta, "_uploads"), ENDERECO_LAN: "http://192.168.0.10" });

async function proximoId(tabela: string, coluna: string): Promise<number> {
    const [linha] = await conexao.queryParam<{ id: number }>(`SELECT COALESCE(MAX(${coluna}), 0) + 1 AS id FROM ${tabela}`);
    return linha.id;
}

async function criarVinculo(nome: string): Promise<number> {
    const idFotografo = await proximoId("fotografo", "id_fotografo");
    await conexao.executeParamCount("INSERT INTO fotografo (id_fotografo, nome) VALUES (?, ?)", [idFotografo, nome]);
    const id = await proximoId("evento_fotografo", "id_evento_fotografo");
    await conexao.executeParamCount(
        "INSERT INTO evento_fotografo (id_evento_fotografo, id_evento, id_fotografo, token_upload) VALUES (?, ?, ?, ?)",
        [id, idEvento, idFotografo, `painel-${nome}-${sufixo}`]
    );
    return id;
}

before(async () => {
    pasta = await fs.mkdtemp(path.join(os.tmpdir(), "painel-"));
    iniciarConfig(ENV());
    conexao = new ConexaoPostgres();
    await conexao.open();

    // Limite de login é por IP e dura 10 min: execuções seguidas do teste não podem se somar.
    const redis = obterRedis();
    const chaves = await redis.keys(`${config.redis.prefixo}limite:painel-login:*`);
    if (chaves.length) await redis.del(...chaves);

    const idOperador = await proximoId("operador", "id_operador");
    await conexao.executeParamCount("INSERT INTO operador (id_operador, nome, login, senha_hash) VALUES (?, 'Ana Operadora', ?, ?)", [
        idOperador,
        login,
        await gerarHashSenha("senha-certa-123"),
    ]);

    // O mais recente não encerrado é o "em andamento": criado agora, ele vence os antigos.
    idEvento = await proximoId("evento", "id_evento");
    await conexao.executeParamCount(
        `INSERT INTO evento (id_evento, nome, slug, tipo, privado, chave_anfitriao, data_fim, config, criado_em)
         VALUES (?, 'Corrida do Painel', ?, 'esportivo', 'N', ?, '2026-12-31', '{}', now() + interval '1 day')`,
        [idEvento, `painel-${sufixo}`, `anf-painel-${sufixo}`]
    );
    idVinculoAna = await criarVinculo("Ana");
    await criarVinculo("Bruno");

    const original = path.join(pasta, "original.jpg");
    await fs.writeFile(original, "x");
    const inserir = (h: string, etapa: string, erro: string | null, caminho: string | null) =>
        conexao.executeParamCount(
            `INSERT INTO foto (id_evento, id_evento_fotografo, hash_arquivo, nome_arquivo, etapa, erro, erro_etapa, caminho_original, publicada_em)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [idEvento, idVinculoAna, h, `${h}.jpg`, etapa, erro, erro ? etapa : null, caminho, etapa === "publicada" ? new Date() : null]
        );
    await inserir("p1", "publicada", null, original);
    await inserir("r1", "registrada", null, null);
    await inserir("o1", "original", null, original);
    await inserir("e1", "rostos", "[ProcessarFoto] vision recusou a imagem: decode", original);
    await inserir("e2", "registrada", "falhou antes do original", null);

    const app = express();
    app.use(express.json());
    app.post("/login", (req, res, next) => per(req, res, next, Login));
    app.post("/painel", (req, res, next) => per(req, res, next, Painel));
    servidor = app.listen(0);
    await new Promise((resolve) => servidor.once("listening", resolve));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

async function chamar(rota: string, corpo: object, token?: string) {
    const resposta = await fetch(`${base}/${rota}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: token } : {}) },
        body: JSON.stringify(corpo),
    });
    return { status: resposta.status, corpo: (await resposta.json()) as Record<string, unknown> };
}

async function entrar(): Promise<string> {
    const r = await chamar("login", { call: "login", login, senha: "senha-certa-123" });
    return r.corpo.token as string;
}

describe("login do painel", () => {
    test("operador sincronizado entra com a mesma senha do admin", async () => {
        const r = await chamar("login", { call: "login", login, senha: "senha-certa-123" });

        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.corpo.nome, "Ana Operadora");
        assert.ok(typeof r.corpo.token === "string");
    });

    test("senha errada não entra", async () => {
        const r = await chamar("login", { call: "login", login, senha: "errada" });
        assert.strictEqual(r.status, 422);
    });

    test("sem sessão o painel pede login de novo", async () => {
        const r = await chamar("painel", { call: "getPainel" });
        assert.strictEqual(r.status, 422);
        assert.match(String(r.corpo.msg), /Sessão expirada/);
    });
});

describe("getPainel", () => {
    test("mostra o evento em andamento, a fila, os fotógrafos, os erros e os endereços", async () => {
        const token = await entrar();
        await registrarSincronizacao();

        const r = await chamar("painel", { call: "getPainel" }, token);
        const corpo = r.corpo as {
            evento: { id_evento: number; nome: string };
            fila: Record<string, number>;
            fotografos: { nome: string; enviadas: number; prontas: number; com_erro: number; token_upload: string }[];
            erros: { nome_arquivo: string; tem_arquivo: boolean; fotografo: string }[];
            enderecos: { lan: string | null };
            vps: { ultima_sincronizacao: string | null };
            em_processamento: number;
        };

        assert.strictEqual(r.status, 200);
        assert.strictEqual(corpo.evento.id_evento, idEvento);
        assert.strictEqual(corpo.evento.nome, "Corrida do Painel");
        // Cada contador é a etapa que a foto espera: "registrada" espera a cópia do original etc.
        assert.deepStrictEqual(
            { recebidas: corpo.fila.recebidas, rostos: corpo.fila.rostos, derivados: corpo.fila.derivados },
            { recebidas: 1, rostos: 1, derivados: 0 }
        );
        assert.strictEqual(corpo.em_processamento, 2, "fotos com erro não contam como em processamento");
        assert.deepStrictEqual(
            corpo.fotografos.map((f) => [f.nome, f.prontas, f.com_erro, f.token_upload]),
            [
                ["Ana", 1, 2, `painel-Ana-${sufixo}`],
                ["Bruno", 0, 0, `painel-Bruno-${sufixo}`],
            ]
        );
        const porNome = Object.fromEntries(corpo.erros.map((e) => [e.nome_arquivo, e]));
        assert.strictEqual(porNome["e1.jpg"].tem_arquivo, true);
        assert.strictEqual(porNome["e2.jpg"].tem_arquivo, false);
        assert.strictEqual(porNome["e1.jpg"].fotografo, "Ana");
        assert.strictEqual(corpo.enderecos.lan, "http://192.168.0.10");
        assert.ok(corpo.vps.ultima_sincronizacao, "a última sincronização aparece");
    });

    test("sem ENDERECO_LAN o painel recebe null, para avisar em vez de montar link com localhost", async () => {
        const token = await entrar();
        iniciarConfig({ ...ENV(), ENDERECO_LAN: "" });
        try {
            const r = await chamar("painel", { call: "getPainel" }, token);
            assert.strictEqual((r.corpo.enderecos as { lan: string | null }).lan, null);
        } finally {
            iniciarConfig(ENV());
        }
    });

    test("evento encerrado deixa de ser o evento em andamento", async () => {
        const token = await entrar();
        await conexao.executeParamCount("UPDATE evento SET encerrado_em = now() WHERE id_evento = ?", [idEvento]);
        try {
            const r = await chamar("painel", { call: "getPainel" }, token);
            assert.notStrictEqual((r.corpo.evento as { id_evento: number } | null)?.id_evento, idEvento);
        } finally {
            await conexao.executeParamCount("UPDATE evento SET encerrado_em = NULL WHERE id_evento = ?", [idEvento]);
        }
    });
});

describe("limite de tentativas de login", () => {
    test("a 11ª tentativa do mesmo IP em 10 minutos é recusada, mesmo com a senha certa", async () => {
        // O túnel deixa a estação na internet: sem limite, dá para tentar senhas sem parar.
        for (let i = 0; i < 10; i++) await chamar("login", { call: "login", login, senha: "errada" });
        const r = await chamar("login", { call: "login", login, senha: "senha-certa-123" });

        assert.strictEqual(r.status, 422);
        assert.match(String(r.corpo.msg), /Muitas tentativas/);
    });
});

after(async () => {
    await conexao?.executeParamCount("UPDATE evento SET encerrado_em = now() WHERE id_evento = ?", [idEvento]);
    servidor?.close();
    await conexao?.close();
    await fecharFila();
    await fecharBanco();
    await fs.rm(pasta, { recursive: true, force: true });
});
