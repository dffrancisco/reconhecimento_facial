import ConexaoPostgres from "../../db/conexaoPostgres";

export async function inserirSinal(conexao: ConexaoPostgres, dados: unknown): Promise<void> {
    await conexao.executeParamCount("INSERT INTO estacao_sinal (dados) VALUES (?)", [JSON.stringify(dados)]);
}
