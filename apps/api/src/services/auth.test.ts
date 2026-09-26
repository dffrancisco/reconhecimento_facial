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

test("sem OPERADOR_SEGREDO forte, nenhuma sessão é aceita, nem assinada com o segredo vazio", async () => {
    // A estação não exige a variável; assinado com "", um token seria forjável por qualquer um.
    config.operadorSegredo = "";
    const forjado = gerarToken(7, "");
    await assert.rejects(() => autorizarOperador({ authorization: forjado }), /OPERADOR_SEGREDO/);
});
