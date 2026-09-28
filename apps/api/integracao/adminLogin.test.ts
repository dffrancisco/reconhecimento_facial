import { test, before, after } from "node:test";
import assert from "node:assert";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { iniciarConfig, config } from "../src/services/config";
import { criarOperador } from "../src/scripts/criarOperador";
import { conferirToken } from "../src/services/token";
import per from "../src/services/per";
import { fecharFila, obterRedis } from "../src/services/fila";
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
        VISION_URL: "http://127.0.0.1:1",
        REDIS_PREFIXO: "fotos:teste:vps:",
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
    const redis = obterRedis();
    const chaves = await redis.keys(`${config.redis.prefixo}limite:admin-login:*`);
    if (chaves.length) await redis.del(...chaves);
});

test("login com senha certa devolve token válido", async () => {
    const res = resFalso();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await per({ headers: {}, body: { call: "login", login, senha: "senha-correta" } } as any, res as any, () => {}, Login);

    const corpo = res.chamadas.body as { token: string; nome: string; id_operador: number };
    assert.strictEqual(corpo.nome, "Operadora");
    assert.strictEqual(conferirToken(corpo.token, config.operadorSegredo), corpo.id_operador);
});

test("login com senha errada devolve 422", async () => {
    const res = resFalso();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await per({ headers: {}, body: { call: "login", login, senha: "senha-errada" } } as any, res as any, () => {}, Login);

    assert.strictEqual(res.chamadas.status, 422);
});

test("login com usuário inexistente devolve 422 com a mesma mensagem (não vaza quem existe)", async () => {
    const res = resFalso();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await per(
        { headers: {}, body: { call: "login", login: "ninguem-aqui", senha: "qualquer" } } as any,
        res as any,
        () => {},
        Login
    );

    assert.strictEqual(res.chamadas.status, 422);
    assert.strictEqual((res.chamadas.body as { msg: string }).msg, "Login ou senha inválidos.");
});

test("a 11ª tentativa do mesmo IP em 10 minutos é recusada, mesmo com a senha certa", async () => {
    const tentar = async (senha: string) => {
        const res = resFalso();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await per({ headers: {}, ip: "10.9.8.7", body: { call: "login", login, senha } } as any, res as any, () => {}, Login);
        return res.chamadas;
    };
    for (let i = 0; i < 10; i++) await tentar("senha-errada");

    const r = await tentar("senha-correta");

    assert.strictEqual(r.status, 422);
    assert.match(String((r.body as { msg: string }).msg), /Muitas tentativas/);
});

after(async () => {
    await conexao?.close();
    await fecharFila();
});

// Fecha o pool: sem isso o processo de teste fica ~30s ocioso antes de sair.
after(async () => {
    await fecharBanco();
});
