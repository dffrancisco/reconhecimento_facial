import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import express, { Request } from "express";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import { iniciarConfig } from "../src/services/config";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import per, { iContexto } from "../src/services/per";
import { ErroTratado } from "../src/services/erro";
import { envTeste } from "./ambiente";

// Confirma que um erro lançado DEPOIS de uma query bem-sucedida dentro de uma transação
// não vira COMMIT: sem `marcarErro()`, `close()` só faz rollback quando a própria query falhou.
const TABELA = `teste_per_transacao_${process.pid}`;

class RotaTransacao {
    conexao = new ConexaoPostgres();

    constructor(_contexto: iContexto) {}

    async init() {
        await this.conexao.openTransaction();
    }

    async inserirEFalhar(req: Request) {
        await this.conexao.executeParamCount(`INSERT INTO ${TABELA} (nome) VALUES (?)`, [req.body.nome]);
        throw new ErroTratado("Falha proposital depois do insert");
    }
}

let servidor: Server;
let base: string;

before(async () => {
    iniciarConfig(envTeste("vps"));

    const setup = new ConexaoPostgres();
    await setup.open();
    await setup.queryParam(`CREATE TABLE IF NOT EXISTS ${TABELA} (id serial PRIMARY KEY, nome varchar(60))`, []);
    await setup.close();

    const app = express();
    app.use(express.json());
    app.post("/rota", (req, res, next) => per(req, res, next, RotaTransacao));
    servidor = app.listen(0);
    await new Promise((resolve) => servidor.once("listening", resolve));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

after(async () => {
    const limpeza = new ConexaoPostgres();
    await limpeza.open();
    await limpeza.queryParam(`DROP TABLE IF EXISTS ${TABELA}`, []);
    await limpeza.close();
    servidor.close();
    await fecharBanco();
});

describe("per + openTransaction: erro depois do insert não commita", () => {
    test("ErroTratado depois do INSERT reverte a transação (422 e linha não gravada)", async () => {
        const resposta = await fetch(base + "/rota", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ call: "inserirEFalhar", nome: "teste" }),
        });

        assert.strictEqual(resposta.status, 422);
        assert.deepStrictEqual(await resposta.json(), { msg: "Falha proposital depois do insert" });

        const conferencia = new ConexaoPostgres();
        await conferencia.open();
        const linha = await conferencia.queryOneParam<{ n: number }>(`SELECT count(*)::int AS n FROM ${TABELA}`, []);
        await conferencia.close();

        assert.strictEqual(linha?.n, 0);
    });
});
