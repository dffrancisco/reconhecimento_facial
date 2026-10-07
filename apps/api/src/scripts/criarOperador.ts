import { createInterface } from "node:readline/promises";
import "../loadEnv";
import { iniciarConfig } from "../services/config";
import ConexaoPostgres, { fecharBanco } from "../db/conexaoPostgres";
import { gerarHashSenha } from "../services/senha";
import { normalizarLogin, validarLogin, validarSenha } from "../_ADMIN/operador/regras";

export async function criarOperador(
    conexao: ConexaoPostgres,
    nome: string,
    login: string,
    senha: string
): Promise<{ id_operador: number; criado: boolean }> {
    const senhaHash = await gerarHashSenha(senha);
    const existente = await conexao.queryOneParam<{ id_operador: number }>("SELECT id_operador FROM operador WHERE login = ?", [
        login,
    ]);

    if (existente) {
        await conexao.executeParamCount("UPDATE operador SET nome = ?, senha_hash = ?, deletado = 'N' WHERE id_operador = ?", [
            nome,
            senhaHash,
            existente.id_operador,
        ]);
        return { id_operador: existente.id_operador, criado: false };
    }

    const [linha] = await conexao.queryParam<{ id_operador: number }>(
        "INSERT INTO operador (nome, login, senha_hash) VALUES (?, ?, ?) RETURNING id_operador",
        [nome, login, senhaHash]
    );
    return { id_operador: linha.id_operador, criado: true };
}

function argumento(nome: string): string | undefined {
    const idx = process.argv.indexOf(`--${nome}`);
    return idx >= 0 ? process.argv[idx + 1] : undefined;
}

// readline não tem opção nativa para ocultar o que é digitado. O truque conhecido de sobrescrever
// `_writeToOutput` só existe na interface legada de callback de `node:readline` — a interface de
// `node:readline/promises` (usada aqui) não expõe esse método (verificado em runtime). Em vez
// disso, interceptamos o `write` do stream de saída: deixamos a pergunta em si passar normalmente
// e suprimimos tudo que o readline escrever depois disso (o eco de cada tecla e o \n do Enter),
// restaurando o `write` original assim que a resposta chega.
async function perguntarSenha(pergunta: string): Promise<string> {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const escritaOriginal = process.stdout.write.bind(process.stdout);
    let mascarando = false;
    process.stdout.write = ((chunk: unknown, ...args: unknown[]): boolean => {
        if (mascarando) return true;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (escritaOriginal as any)(chunk, ...args);
    }) as typeof process.stdout.write;

    try {
        const resposta = rl.question(pergunta);
        mascarando = true;
        return await resposta;
    } finally {
        process.stdout.write = escritaOriginal;
        rl.close();
        process.stdout.write("\n");
    }
}

async function main(): Promise<void> {
    const nome = argumento("nome");
    const login = argumento("login");
    if (!nome || !login) {
        console.error("[CriarOperador] Uso: npm run criar-operador -w apps/api -- --nome \"Ana\" --login ana");
        process.exit(1);
    }

    // As mesmas regras da tela de usuários do admin.
    const erroLogin = validarLogin(login);
    if (erroLogin) {
        console.error(`[CriarOperador] ${erroLogin}`);
        process.exit(1);
    }

    iniciarConfig(process.env);
    const senha = await perguntarSenha("Senha: ");
    const erroSenha = validarSenha(senha);
    if (erroSenha) {
        console.error(`[CriarOperador] ${erroSenha}`);
        process.exit(1);
    }

    const conexao = new ConexaoPostgres();
    await conexao.open();
    try {
        const resultado = await criarOperador(conexao, nome, normalizarLogin(login), senha);
        console.log(`[CriarOperador] Operador ${resultado.criado ? "criado" : "atualizado"}: id_operador=${resultado.id_operador}`);
    } finally {
        await conexao.close();
        // Sem fechar o pool, o processo só sai quando as conexões ociosas expiram.
        await fecharBanco();
    }
}

if (require.main === module) {
    main().catch((erro) => {
        console.error("[CriarOperador] Falhou:", erro instanceof Error ? erro.message : erro);
        process.exit(1);
    });
}
