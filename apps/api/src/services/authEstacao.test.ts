import { test } from "node:test";
import assert from "node:assert";
import { autorizarEstacao } from "./authEstacao";
import { config } from "./config";
import { ErroTratado } from "./erro";

test("autoriza quando a chave bate", () => {
    config.estacaoChave = "chave-compartilhada-com-32-caracteres-ou-mais";
    assert.doesNotThrow(() => autorizarEstacao({ authorization: config.estacaoChave }));
});

test("recusa chave errada ou ausente", () => {
    config.estacaoChave = "chave-compartilhada-com-32-caracteres-ou-mais";
    assert.throws(() => autorizarEstacao({ authorization: "chave-errada" }), ErroTratado);
    assert.throws(() => autorizarEstacao({}), ErroTratado);
});
