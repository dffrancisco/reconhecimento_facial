import { test, describe, afterEach } from "node:test";
import assert from "node:assert";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import { iniciarConfig } from "./config";
import StartApp from "./server";

const BASE = {
    POSTGRES_HOST: "127.0.0.1",
    POSTGRES_USER: "x",
    POSTGRES_PASSWORD: "x",
    POSTGRES_DB: "x",
    REDIS_URL: "redis://127.0.0.1:1",
    ESTACAO_CHAVE: "k".repeat(32),
    VPS_URL: "http://127.0.0.1:9",
    ARQUIVO_SEGREDO: "s",
    OPERADOR_SEGREDO: "o".repeat(32),
};

let servidor: Server | undefined;

afterEach(() => {
    servidor?.close();
});

async function subir(papel: "estacao" | "vps"): Promise<string> {
    iniciarConfig({ ...BASE, PAPEL: papel });
    servidor = new StartApp().app.listen(0);
    await new Promise((resolve) => servidor!.once("listening", resolve));
    return `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
}

describe("StartApp", () => {
    for (const papel of ["estacao", "vps"] as const) {
        test(`GET /test responde com o papel ${papel} e a versão`, async () => {
            const base = await subir(papel);
            const resposta = await fetch(`${base}/test`);

            assert.strictEqual(resposta.status, 200);
            assert.deepStrictEqual(await resposta.json(), { msg: "Teste funcionando!", papel, versao: "0.1.0" });
        });
    }
});
