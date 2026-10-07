import { test, before, after } from "node:test";
import assert from "node:assert";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { iniciarConfig } from "../src/services/config";
import { autorizarOperador } from "../src/services/auth";
import { ErroTratado } from "../src/services/erro";
import per from "../src/services/per";
import LoginCtrl from "../src/_ADMIN/login/ctrl.login";
import OperadorCtrl from "../src/_ADMIN/operador/ctrl.operador";
import Operador from "../src/_ADMIN/operador/route.operador";

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
let sufixo = 0;
const loginNovo = () => `op-${Date.now()}-${++sufixo}`;

before(async () => {
    conexao = new ConexaoPostgres();
    await conexao.open();
});

// Um operador já cadastrado e a sessão dele, como o admin teria depois do login.
async function operadorLogado(): Promise<{ id: number; login: string; token: string; ctrl: OperadorCtrl }> {
    const login = loginNovo();
    const { id_operador } = await new OperadorCtrl(conexao, 0).criarOperador({ nome: "Quem está logado", login, senha: "senha-do-logado" });
    const { token } = await new LoginCtrl(conexao).login(login, "senha-do-logado");
    return { id: id_operador, login, token, ctrl: new OperadorCtrl(conexao, id_operador) };
}

async function recusado(promessa: Promise<unknown>, mensagem: RegExp): Promise<void> {
    await assert.rejects(promessa, (erro) => erro instanceof ErroTratado && mensagem.test(erro.message));
}

test("cria e lista, sem nunca devolver o hash da senha", async () => {
    const { ctrl } = await operadorLogado();
    const login = loginNovo();

    const { id_operador } = await ctrl.criarOperador({ nome: "Ana", login, senha: "senha-da-ana" });
    const lista = await ctrl.listarOperadores();

    const ana = lista.find((o) => o.id_operador === id_operador);
    assert.deepStrictEqual(Object.keys(ana ?? {}).sort(), ["criado_em", "id_operador", "login", "nome"]);
    assert.strictEqual(ana?.nome, "Ana");
});

test("guarda o login normalizado, e a pessoa entra digitando com maiúsculas", async () => {
    const { ctrl } = await operadorLogado();
    const login = loginNovo();

    await ctrl.criarOperador({ nome: "Bia", login: `  ${login.toUpperCase()} `, senha: "senha-da-bia" });

    assert.ok((await ctrl.listarOperadores()).some((o) => o.login === login));
    const entrada = await new LoginCtrl(conexao).login(` ${login.toUpperCase()}`, "senha-da-bia");
    assert.strictEqual(entrada.nome, "Bia");
});

test("recusa login que já é de outro usuário ativo", async () => {
    const { ctrl, login } = await operadorLogado();
    await recusado(ctrl.criarOperador({ nome: "Outro", login, senha: "senha-qualquer" }), /já é de outro usuário/);
});

test("recusa senha curta e login fora do formato", async () => {
    const { ctrl } = await operadorLogado();
    await recusado(ctrl.criarOperador({ nome: "Ana", login: loginNovo(), senha: "curta" }), /pelo menos 8/);
    await recusado(ctrl.criarOperador({ nome: "Ana", login: "ana paula", senha: "senha-longa" }), /letras minúsculas/);
});

test("criar com o login de alguém excluído traz aquele cadastro de volta, com nome e senha novos", async () => {
    const { ctrl } = await operadorLogado();
    const login = loginNovo();
    const { id_operador } = await ctrl.criarOperador({ nome: "Carla", login, senha: "senha-antiga" });
    await ctrl.excluirOperador(id_operador);

    const volta = await ctrl.criarOperador({ nome: "Carla Souza", login, senha: "senha-nova-1" });

    assert.strictEqual(volta.id_operador, id_operador);
    assert.ok((await ctrl.listarOperadores()).some((o) => o.id_operador === id_operador && o.nome === "Carla Souza"));
    await recusado(new LoginCtrl(conexao).login(login, "senha-antiga"), /inválidos/);
    assert.strictEqual((await new LoginCtrl(conexao).login(login, "senha-nova-1")).nome, "Carla Souza");
});

test("altera nome e login", async () => {
    const { ctrl } = await operadorLogado();
    const { id_operador } = await ctrl.criarOperador({ nome: "Davi", login: loginNovo(), senha: "senha-do-davi" });
    const novoLogin = loginNovo();

    await ctrl.alterarOperador(id_operador, { nome: "Davi Lima", login: novoLogin });

    assert.ok((await ctrl.listarOperadores()).some((o) => o.id_operador === id_operador && o.nome === "Davi Lima" && o.login === novoLogin));
});

test("não altera para o login de outro cadastro, nem de um excluído", async () => {
    const { ctrl, login } = await operadorLogado();
    const { id_operador } = await ctrl.criarOperador({ nome: "Eva", login: loginNovo(), senha: "senha-da-eva" });
    const excluido = await ctrl.criarOperador({ nome: "Fábio", login: loginNovo(), senha: "senha-do-fabio" });
    const loginDoExcluido = (await ctrl.listarOperadores()).find((o) => o.id_operador === excluido.id_operador)!.login;
    await ctrl.excluirOperador(excluido.id_operador);

    await recusado(ctrl.alterarOperador(id_operador, { nome: "Eva", login }), /já é de outro usuário/);
    await recusado(ctrl.alterarOperador(id_operador, { nome: "Eva", login: loginDoExcluido }), /já é de outro usuário/);
});

test("alterar mantendo o próprio login não acusa repetido", async () => {
    const { ctrl, id, login } = await operadorLogado();
    await ctrl.alterarOperador(id, { nome: "Nome novo", login });
    assert.ok((await ctrl.listarOperadores()).some((o) => o.id_operador === id && o.nome === "Nome novo"));
});

test("excluir tira da lista e derruba a sessão do excluído", async () => {
    const { ctrl } = await operadorLogado();
    const outro = await operadorLogado();
    assert.strictEqual(await autorizarOperador({ authorization: outro.token }, conexao), outro.id);

    await ctrl.excluirOperador(outro.id);

    assert.ok(!(await ctrl.listarOperadores()).some((o) => o.id_operador === outro.id));
    await recusado(autorizarOperador({ authorization: outro.token }, conexao), /Sessão expirada/);
    await recusado(new LoginCtrl(conexao).login(outro.login, "senha-do-logado"), /inválidos/);
});

test("ninguém exclui a si mesmo", async () => {
    const { ctrl, id } = await operadorLogado();
    await recusado(ctrl.excluirOperador(id), /a si mesmo/);
});

test("excluir quem não existe avisa", async () => {
    const { ctrl } = await operadorLogado();
    await recusado(ctrl.excluirOperador(999_999_999), /não encontrado/);
});

test("dois excluindo um ao outro ao mesmo tempo não zeram a lista", async () => {
    // O estado em que o segundo chega depois do primeiro gravar: quem pede já foi excluído e o
    // alvo é o único que sobrou. Numa transação desfeita no fim, para não mexer no banco de dev.
    const a = await operadorLogado();
    const b = await operadorLogado();
    const transacao = new ConexaoPostgres();
    await transacao.openTransaction();
    try {
        await transacao.executeParamCount("UPDATE operador SET deletado = 'S' WHERE id_operador <> ?", [b.id]);
        await recusado(new OperadorCtrl(transacao, a.id).excluirOperador(b.id), /pelo menos um usuário/);
    } finally {
        await transacao.rollback();
        await transacao.close();
    }
});

test("trocar a senha de outro derruba as sessões dele com a senha antiga", async () => {
    const { ctrl } = await operadorLogado();
    const outro = await operadorLogado();

    const resposta = await ctrl.trocarSenha(outro.id, "senha-trocada-1");

    assert.deepStrictEqual(resposta, { ok: true });
    await recusado(autorizarOperador({ authorization: outro.token }, conexao), /Sessão expirada/);
    assert.ok((await new LoginCtrl(conexao).login(outro.login, "senha-trocada-1")).token);
});

test("trocar a própria senha devolve uma sessão nova, e a antiga cai", async () => {
    const eu = await operadorLogado();

    const resposta = await eu.ctrl.trocarSenha(eu.id, "minha-senha-nova");

    assert.ok(resposta.token);
    assert.strictEqual(await autorizarOperador({ authorization: resposta.token }, conexao), eu.id);
    await recusado(autorizarOperador({ authorization: eu.token }, conexao), /Sessão expirada/);
});

test("trocar senha recusa a curta e quem não existe", async () => {
    const { ctrl } = await operadorLogado();
    const outro = await operadorLogado();
    await recusado(ctrl.trocarSenha(outro.id, "curta"), /pelo menos 8/);
    await recusado(ctrl.trocarSenha(999_999_999, "senha-longa-ok"), /não encontrado/);
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

async function chamar(token: string | undefined, body: object) {
    const res = resFalso();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await per({ headers: { authorization: token }, body } as any, res as any, () => {}, Operador);
    return res.chamadas;
}

test("a rota lista para quem está logado e recusa sem sessão", async () => {
    const { token, id } = await operadorLogado();

    const ok = await chamar(token, { call: "listarOperadores" });
    const sem = await chamar(undefined, { call: "listarOperadores" });

    assert.ok((ok.body as { id_operador: number }[]).some((o) => o.id_operador === id));
    assert.strictEqual(sem.status, 422);
    assert.strictEqual((sem.body as { codigo: string }).codigo, "sessao_expirada");
});

test("a rota pede os campos obrigatórios", async () => {
    const { token } = await operadorLogado();
    const resposta = await chamar(token, { call: "criarOperador", nome: "Sem login" });
    assert.strictEqual((resposta.body as { error: boolean }).error, true);
});

after(async () => {
    await conexao?.close();
});

// Fecha o pool: sem isso o processo de teste fica ~30s ocioso antes de sair.
after(async () => {
    await fecharBanco();
});
