import ConexaoPostgres from "../../db/conexaoPostgres";

export interface LinhaUltimoSinal {
    endereco_lan: string | null;
    endereco_tunel: string | null;
    recebido_em: string;
}

export async function ultimoSinal(conexao: ConexaoPostgres): Promise<LinhaUltimoSinal | undefined> {
    return conexao.queryOneParam<LinhaUltimoSinal>(
        `SELECT dados->>'endereco_lan' AS endereco_lan, dados->>'endereco_tunel' AS endereco_tunel, recebido_em
           FROM estacao_sinal
          ORDER BY id_estacao_sinal DESC
          LIMIT 1`,
        []
    );
}
