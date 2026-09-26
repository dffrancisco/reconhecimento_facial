import { test, before, after } from "node:test";
import assert from "node:assert";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { iniciarConfig } from "../src/services/config";
import { conferirSenha } from "../src/services/senha";
import { criarOperador } from "../src/scripts/criarOperador";

before(() => {
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
});

let conexao: ConexaoPostgres;

test("cria e depois atualiza o mesmo operador", async () => {
    conexao = new ConexaoPostgres();
    await conexao.open();

    const login = `teste-${Date.now()}`;
    const primeira = await criarOperador(conexao, "Ana", login, "senha-inicial");
    assert.strictEqual(primeira.criado, true);

    const [linha] = await conexao.queryParam<{ senha_hash: string }>("SELECT senha_hash FROM operador WHERE id_operador = ?", [
        primeira.id_operador,
    ]);
    assert.strictEqual(await conferirSenha("senha-inicial", linha.senha_hash), true);

    const segunda = await criarOperador(conexao, "Ana Paula", login, "senha-nova");
    assert.strictEqual(segunda.criado, false);
    assert.strictEqual(segunda.id_operador, primeira.id_operador);

    const [atualizado] = await conexao.queryParam<{ nome: string; senha_hash: string }>(
        "SELECT nome, senha_hash FROM operador WHERE id_operador = ?",
        [primeira.id_operador]
    );
    assert.strictEqual(atualizado.nome, "Ana Paula");
    assert.strictEqual(await conferirSenha("senha-nova", atualizado.senha_hash), true);
});

after(async () => {
    await conexao?.close();
});

// Fecha o pool: sem isso o processo de teste fica ~30s ocioso antes de sair.
after(async () => {
    await fecharBanco();
});
