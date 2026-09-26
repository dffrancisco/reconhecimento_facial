import { test, before, after } from "node:test";
import assert from "node:assert";
import ConexaoPostgres from "../src/db/conexaoPostgres";
import { iniciarConfig, config } from "../src/services/config";
import per from "../src/services/per";
import Sinal from "../src/_ESTACAO/sinal/route.sinal";

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

before(async () => {
    conexao = new ConexaoPostgres();
    await conexao.open();
});

test("grava o sinal recebido", async () => {
    const dados = { fila: { processarFoto: 3 }, fotos_min: 12 };
    const res = resFalso();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await per({ body: { call: "registrarSinal", ...dados }, headers: { authorization: config.estacaoChave } } as any, res as any, () => {}, Sinal);

    assert.deepStrictEqual(res.chamadas.body, { ok: true });
    const [ultimo] = await conexao.queryParam<{ dados: typeof dados }>(
        "SELECT dados FROM estacao_sinal ORDER BY id_estacao_sinal DESC LIMIT 1"
    );
    assert.deepStrictEqual(ultimo.dados, dados);
});

after(async () => {
    await conexao?.close();
});
