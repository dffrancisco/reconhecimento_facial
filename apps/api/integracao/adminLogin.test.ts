import { test, before, after } from "node:test";
import assert from "node:assert";
import ConexaoPostgres from "../src/db/conexaoPostgres";
import { iniciarConfig, config } from "../src/services/config";
import { criarOperador } from "../src/scripts/criarOperador";
import { conferirToken } from "../src/services/token";
import per from "../src/services/per";
import Login from "../src/_ADMIN/login/route.login";

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
    });
});

function resFalso() {
    const chamadas: { status?: number; body?: unknown } = {};
    return {
        chamadas,
        status(codigo: number) {
            chamadas.status = codigo;
            return this;
        },
        send(corpo: unknown) {
            chamadas.body = corpo;
        },
    };
}

let conexao: ConexaoPostgres;
let login: string;

before(async () => {
    conexao = new ConexaoPostgres();
    await conexao.open();
    login = `login-teste-${Date.now()}`;
    await criarOperador(conexao, "Operadora", login, "senha-correta");
});

test("login com senha certa devolve token válido", async () => {
    const res = resFalso();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await per({ body: { call: "login", login, senha: "senha-correta" } } as any, res as any, () => {}, Login);

    const corpo = res.chamadas.body as { token: string; nome: string; id_operador: number };
    assert.strictEqual(corpo.nome, "Operadora");
    assert.strictEqual(conferirToken(corpo.token, config.operadorSegredo), corpo.id_operador);
});

test("login com senha errada devolve 422", async () => {
    const res = resFalso();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await per({ body: { call: "login", login, senha: "senha-errada" } } as any, res as any, () => {}, Login);

    assert.strictEqual(res.chamadas.status, 422);
});

test("login com usuário inexistente devolve 422 com a mesma mensagem (não vaza quem existe)", async () => {
    const res = resFalso();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await per({ body: { call: "login", login: "ninguem-aqui", senha: "qualquer" } } as any, res as any, () => {}, Login);

    assert.strictEqual(res.chamadas.status, 422);
    assert.strictEqual((res.chamadas.body as { msg: string }).msg, "Login ou senha inválidos.");
});

after(async () => {
    await conexao?.close();
});
