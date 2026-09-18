import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import { Router } from "express";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import { criarApp } from "./servidor";

let servidor: Server;
let base: string;

before(async () => {
    const area = Router();
    area.post("/eco", (req, res) => {
        res.send(req.body);
    });
    servidor = criarApp([{ caminho: "teste", router: area }]).listen(0);
    await new Promise((resolve) => servidor.once("listening", resolve));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

after(() => {
    servidor.close();
});

function postar(caminho: string, corpo: string) {
    return fetch(base + caminho, { method: "POST", headers: { "Content-Type": "application/json" }, body: corpo });
}

describe("criarApp", () => {
    test("monta a área em /api/<area>/<modulo>", async () => {
        const resposta = await postar("/api/teste/eco", JSON.stringify({ a: 1 }));

        assert.strictEqual(resposta.status, 200);
        assert.deepStrictEqual(await resposta.json(), { a: 1 });
    });

    test("rota desconhecida vira 404 em JSON", async () => {
        const resposta = await postar("/api/fotografo/upload", "{}");

        assert.strictEqual(resposta.status, 404);
        assert.deepStrictEqual(await resposta.json(), { msg: "Rota não encontrada" });
    });

    test("JSON malformado vira 400 em JSON", async () => {
        const resposta = await postar("/api/teste/eco", "{ruim");

        assert.strictEqual(resposta.status, 400);
        assert.deepStrictEqual(await resposta.json(), { msg: "JSON inválido" });
    });

    test("não expõe o X-Powered-By", async () => {
        const resposta = await postar("/api/teste/eco", "{}");

        assert.strictEqual(resposta.headers.get("x-powered-by"), null);
    });
});
