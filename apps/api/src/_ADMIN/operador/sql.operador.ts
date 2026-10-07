// CONTRATO: alterarOperadorSql grava com SET fixo (nome e login): a tela manda os dois sempre.
import ConexaoPostgres from "../../db/conexaoPostgres";

export interface LinhaOperadorLista {
    id_operador: number;
    nome: string;
    login: string;
    criado_em: string;
}

export async function listarOperadoresSql(conexao: ConexaoPostgres): Promise<LinhaOperadorLista[]> {
    return conexao.queryParam<LinhaOperadorLista>(
        "SELECT id_operador, nome, login, criado_em FROM operador WHERE deletado = 'N' ORDER BY nome, id_operador"
    );
}

// Com os excluídos: o login é único na tabela inteira, não só entre os ativos.
export async function buscarPorLogin(conexao: ConexaoPostgres, login: string): Promise<{ id_operador: number; deletado: string } | undefined> {
    return conexao.queryOneParam<{ id_operador: number; deletado: string }>("SELECT id_operador, deletado FROM operador WHERE login = ?", [login]);
}

export async function inserirOperador(conexao: ConexaoPostgres, nome: string, login: string, senhaHash: string): Promise<{ id_operador: number }> {
    const [linha] = await conexao.queryParam<{ id_operador: number }>(
        "INSERT INTO operador (nome, login, senha_hash) VALUES (?, ?, ?) RETURNING id_operador",
        [nome, login, senhaHash]
    );
    return linha;
}

export async function reativarOperador(conexao: ConexaoPostgres, idOperador: number, nome: string, senhaHash: string): Promise<void> {
    await conexao.executeParamCount("UPDATE operador SET nome = ?, senha_hash = ?, deletado = 'N' WHERE id_operador = ?", [
        nome,
        senhaHash,
        idOperador,
    ]);
}

export async function alterarOperadorSql(conexao: ConexaoPostgres, idOperador: number, nome: string, login: string): Promise<number> {
    return conexao.executeParamCount("UPDATE operador SET nome = ?, login = ? WHERE id_operador = ? AND deletado = 'N'", [
        nome,
        login,
        idOperador,
    ]);
}

export async function trocarSenhaSql(conexao: ConexaoPostgres, idOperador: number, senhaHash: string): Promise<number> {
    return conexao.executeParamCount("UPDATE operador SET senha_hash = ? WHERE id_operador = ? AND deletado = 'N'", [senhaHash, idOperador]);
}

// FOR UPDATE: duas exclusões ao mesmo tempo esperam uma pela outra, e a segunda conta os
// ativos já sem o que a primeira tirou.
export async function travarAtivos(conexao: ConexaoPostgres): Promise<number[]> {
    const linhas = await conexao.queryParam<{ id_operador: number }>(
        "SELECT id_operador FROM operador WHERE deletado = 'N' ORDER BY id_operador FOR UPDATE"
    );
    return linhas.map((l) => l.id_operador);
}

export async function excluirOperadorSql(conexao: ConexaoPostgres, idOperador: number): Promise<void> {
    await conexao.executeParamCount("UPDATE operador SET deletado = 'S' WHERE id_operador = ?", [idOperador]);
}
