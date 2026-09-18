import { test, describe, before, after, beforeEach, mock } from "node:test";
import assert from "node:assert";
import express, { NextFunction, Request, Response } from "express";
import fileUpload from "express-fileupload";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import per, { chamadaValida, iContexto } from "./per";
import { ErroTratado } from "./erro";

let eventos: string[] = [];

class RotaFalsa {
    conexao = {
        close: async () => {
            eventos.push("close");
            return true;
        },
    };

    constructor(private contexto: iContexto) {}

    async init() {
        eventos.push("init");
    }

    async ola(req: Request) {
        return { ola: req.body.nome, authorization: this.contexto.authorization ?? null };
    }

    async negocio() {
        return { msg: "Nome já existe", error: true };
    }

    async tratado() {
        throw new ErroTratado("Evento encerrado");
    }

    async quebrado() {
        throw new Error("detalhe interno");
    }

    async vazio() {
        return null;
    }

    async comStatus() {
        return { status: 202, data: { aceito: true } };
    }

    async comData() {
        return { data: { ok: true } };
    }

    async comDetalheSensivel() {
        const erro = new Error('duplicate key value violates unique constraint "favorecido_telefone_key"') as Error & {
            detail?: string;
        };
        erro.detail = "Key (telefone)=(+5511999998888) already exists.";
        throw erro;
    }
}

class RotaInitFalha {
    conexao = {
        close: async () => {
            eventos.push("close");
            return true;
        },
    };

    async init() {
        throw new Error("banco fora");
    }

    async ola() {
        return {};
    }
}

let servidor: Server;
let base: string;

before(async () => {
    const app = express();
    app.use(express.json());
    app.use(fileUpload());
    app.post("/rota", (req: Request, res: Response, next: NextFunction) => per(req, res, next, RotaFalsa));
    app.post("/init-falha", (req: Request, res: Response, next: NextFunction) =>
        per(req, res, next, RotaInitFalha)
    );
    servidor = app.listen(0);
    await new Promise((resolve) => servidor.once("listening", resolve));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

after(() => {
    servidor.close();
});

beforeEach(() => {
    eventos = [];
});

async function chamar(caminho: string, corpo: object, headers: Record<string, string> = {}) {
    const resposta = await fetch(base + caminho, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(corpo),
    });
    return { status: resposta.status, corpo: await resposta.json() };
}

describe("per", () => {
    test("despacha o call e repassa o contexto", async () => {
        const r = await chamar("/rota", { call: "ola", nome: "Ana" }, { Authorization: "tok" });

        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual(r.corpo, { ola: "Ana", authorization: "tok" });
        assert.deepStrictEqual(eventos, ["init", "close"]);
    });

    test("erro de negócio sai com 200 e o corpo da ctrl", async () => {
        const r = await chamar("/rota", { call: "negocio" });

        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual(r.corpo, { msg: "Nome já existe", error: true });
    });

    test("ErroTratado vira 422 com a mensagem", async () => {
        const r = await chamar("/rota", { call: "tratado" });

        assert.strictEqual(r.status, 422);
        assert.deepStrictEqual(r.corpo, { msg: "Evento encerrado" });
    });

    test("erro inesperado vira 500 sem detalhe interno e fecha a conexão", async () => {
        const r = await chamar("/rota", { call: "quebrado" });

        assert.strictEqual(r.status, 500);
        assert.deepStrictEqual(r.corpo, { msg: "Erro ao processar sua solicitação" });
        assert.deepStrictEqual(eventos, ["init", "close"]);
    });

    test("fecha a conexão mesmo quando init falha", async () => {
        const r = await chamar("/init-falha", { call: "ola" });

        assert.strictEqual(r.status, 500);
        assert.deepStrictEqual(eventos, ["close"]);
    });

    test("retorno nulo vira lista vazia", async () => {
        assert.deepStrictEqual((await chamar("/rota", { call: "vazio" })).corpo, []);
    });

    test("retorno com status e data define o HTTP", async () => {
        const r = await chamar("/rota", { call: "comStatus" });

        assert.strictEqual(r.status, 202);
        assert.deepStrictEqual(r.corpo, { aceito: true });
    });

    test("retorno só com data (sem status numérico) envia rs.data", async () => {
        const r = await chamar("/rota", { call: "comData" });

        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual(r.corpo, { ok: true });
    });

    test("erro com detail sensível: resposta genérica e log sem o dado pessoal", async () => {
        const logs: unknown[][] = [];
        const consoleErrorMock = mock.method(console, "error", (...args: unknown[]) => {
            logs.push(args);
        });

        try {
            const r = await chamar("/rota", { call: "comDetalheSensivel" });

            assert.strictEqual(r.status, 500);
            assert.deepStrictEqual(r.corpo, { msg: "Erro ao processar sua solicitação" });
        } finally {
            consoleErrorMock.mock.restore();
        }

        const textoLogado = JSON.stringify(logs);
        assert.ok(!textoLogado.includes("+5511999998888"), "telefone não deveria aparecer no log");
    });

    for (const call of [undefined, "init", "constructor", "toString", "conexao", "naoExiste", "_privado"]) {
        test(`recusa call ${String(call)} com 400 sem instanciar a rota`, async () => {
            const r = await chamar("/rota", { call });

            assert.strictEqual(r.status, 400);
            assert.deepStrictEqual(r.corpo, { msg: "Chamada inválida" });
            assert.deepStrictEqual(eventos, []);
        });
    }

    test("aceita call em formulário multipart", async () => {
        const form = new FormData();
        form.append("call", "ola");
        form.append("nome", "Bia");

        const resposta = await fetch(base + "/rota", { method: "POST", body: form });

        assert.deepStrictEqual(await resposta.json(), { ola: "Bia", authorization: null });
    });
});

describe("chamadaValida", () => {
    test("aceita método próprio da classe", () => {
        assert.strictEqual(chamadaValida(RotaFalsa, "ola"), true);
    });

    test("recusa valor que não é texto", () => {
        assert.strictEqual(chamadaValida(RotaFalsa, 42), false);
    });
});
