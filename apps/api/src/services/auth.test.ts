import { test } from "node:test";
import assert from "node:assert";
import { autorizarOperador } from "./auth";
import { gerarToken } from "./token";
import { config } from "./config";
import { ErroTratado } from "./erro";
import { versaoDaSenha } from "./senha";
import type ConexaoPostgres from "../db/conexaoPostgres";

const SEGREDO = "segredo-de-teste-com-pelo-menos-32-caracteres";
const HASH = "scrypt$aaaa$bbbb";

// O banco devolve o operador ativo pelo id, ou nada quando ele foi excluído.
function bancoCom(operadores: Record<number, string>): ConexaoPostgres {
    return {
        queryOneParam: async (_sql: string, [id]: unknown[]) => (operadores[Number(id)] ? { senha_hash: operadores[Number(id)] } : undefined),
    } as unknown as ConexaoPostgres;
}

test("autoriza com um token válido de um operador ativo", async () => {
    config.operadorSegredo = SEGREDO;
    const token = gerarToken(7, SEGREDO, versaoDaSenha(HASH));
    assert.strictEqual(await autorizarOperador({ authorization: token }, bancoCom({ 7: HASH })), 7);
});

test("recusa sem header", async () => {
    config.operadorSegredo = SEGREDO;
    await assert.rejects(() => autorizarOperador({}, bancoCom({ 7: HASH })), ErroTratado);
});

test("recusa token inválido", async () => {
    config.operadorSegredo = SEGREDO;
    await assert.rejects(() => autorizarOperador({ authorization: "invalido" }, bancoCom({ 7: HASH })), ErroTratado);
});

test("recusa o token de um operador excluído", async () => {
    config.operadorSegredo = SEGREDO;
    const token = gerarToken(7, SEGREDO, versaoDaSenha(HASH));
    await assert.rejects(() => autorizarOperador({ authorization: token }, bancoCom({})), /Sessão expirada/);
});

test("recusa o token emitido antes da troca de senha", async () => {
    config.operadorSegredo = SEGREDO;
    const token = gerarToken(7, SEGREDO, versaoDaSenha(HASH));
    await assert.rejects(() => autorizarOperador({ authorization: token }, bancoCom({ 7: "scrypt$cccc$dddd" })), /Sessão expirada/);
});

test("sem OPERADOR_SEGREDO forte, nenhuma sessão é aceita, nem assinada com o segredo vazio", async () => {
    // A estação não exige a variável; assinado com "", um token seria forjável por qualquer um.
    config.operadorSegredo = "";
    const forjado = gerarToken(7, "", versaoDaSenha(HASH));
    await assert.rejects(() => autorizarOperador({ authorization: forjado }, bancoCom({ 7: HASH })), /OPERADOR_SEGREDO/);
});
