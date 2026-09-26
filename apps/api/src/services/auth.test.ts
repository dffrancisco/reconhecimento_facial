import { test } from "node:test";
import assert from "node:assert";
import { autorizarOperador } from "./auth";
import { gerarToken } from "./token";
import { config } from "./config";
import { ErroTratado } from "./erro";

test("autoriza com um token válido", async () => {
    config.operadorSegredo = "segredo-de-teste-com-pelo-menos-32-caracteres";
    const token = gerarToken(7, config.operadorSegredo);
    assert.strictEqual(await autorizarOperador({ authorization: token }), 7);
});

test("recusa sem header", async () => {
    config.operadorSegredo = "segredo-de-teste-com-pelo-menos-32-caracteres";
    await assert.rejects(() => autorizarOperador({}), ErroTratado);
});

test("recusa token inválido", async () => {
    config.operadorSegredo = "segredo-de-teste-com-pelo-menos-32-caracteres";
    await assert.rejects(() => autorizarOperador({ authorization: "invalido" }), ErroTratado);
});
