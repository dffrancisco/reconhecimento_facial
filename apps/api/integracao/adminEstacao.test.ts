import { test, before, after } from "node:test";
import assert from "node:assert";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { iniciarConfig } from "../src/services/config";
import EstacaoCtrl from "../src/_ADMIN/estacao/ctrl.estacao";

// Lê o último sinal da estação: o worker-estacao de dev não pode estar rodando junto,
// senão um sinal dele chega entre o INSERT e a leitura (ver docs/desenvolvimento.md).
let conexao: ConexaoPostgres;
let ctrl: EstacaoCtrl;

before(async () => {
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
    });
    conexao = new ConexaoPostgres();
    await conexao.open();
    ctrl = new EstacaoCtrl(conexao);
});

async function sinal(dados: object): Promise<void> {
    await conexao.executeParamCount("INSERT INTO estacao_sinal (dados) VALUES (?)", [JSON.stringify(dados)]);
}

test("o último sinal com endereço vira o link do painel da estação", async () => {
    await sinal({ endereco_lan: "http://10.0.0.5:8090", endereco_tunel: "https://estacao.exemplo.com" });

    const estacao = await ctrl.obterEstacao();

    assert.strictEqual(estacao?.painel, "http://10.0.0.5:8090/#/estacao");
    assert.strictEqual(estacao?.painel_tunel, "https://estacao.exemplo.com/#/estacao");
    assert.ok(estacao?.ultimo_sinal_em);
});

test("estação sem ENDERECO_LAN (ou de versão antiga) dá sinal, mas sem link", async () => {
    await sinal({ fila_bullmq: {} });

    const estacao = await ctrl.obterEstacao();

    assert.strictEqual(estacao?.painel, null);
    assert.strictEqual(estacao?.painel_tunel, null);
    assert.ok(estacao?.ultimo_sinal_em);
});

after(async () => {
    await conexao?.close();
    await fecharBanco();
});
