import { createInterface } from "node:readline/promises";
import "../loadEnv";
import { iniciarConfig } from "../services/config";
import ConexaoPostgres from "../db/conexaoPostgres";
import { gerarHashSenha } from "../services/senha";

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

async function main(): Promise<void> {
    const nome = argumento("nome");
    const login = argumento("login");
    if (!nome || !login) {
        console.error("[CriarOperador] Uso: npm run criar-operador -w apps/api -- --nome \"Ana\" --login ana");
        process.exit(1);
    }

    iniciarConfig(process.env);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const senha = await rl.question("Senha: ");
    rl.close();
    if (senha.length < 8) {
        console.error("[CriarOperador] A senha deve ter pelo menos 8 caracteres.");
        process.exit(1);
    }

    const conexao = new ConexaoPostgres();
    await conexao.open();
    try {
        const resultado = await criarOperador(conexao, nome, login, senha);
        console.log(`[CriarOperador] Operador ${resultado.criado ? "criado" : "atualizado"}: id_operador=${resultado.id_operador}`);
    } finally {
        await conexao.close();
    }
}

if (require.main === module) {
    main().catch((erro) => {
        console.error("[CriarOperador] Falhou:", erro instanceof Error ? erro.message : erro);
        process.exit(1);
    });
}
