import ConexaoPostgres from "../../db/conexaoPostgres";

export interface LinhaOperador {
    id_operador: number;
    nome: string;
    senha_hash: string;
}

export async function buscarOperadorPorLogin(conexao: ConexaoPostgres, login: string): Promise<LinhaOperador | undefined> {
    return conexao.queryOneParam<LinhaOperador>(
        "SELECT id_operador, nome, senha_hash FROM operador WHERE login = ? AND deletado = 'N'",
        [login]
    );
}
