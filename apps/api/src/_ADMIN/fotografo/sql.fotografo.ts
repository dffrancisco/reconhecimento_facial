import ConexaoPostgres from "../../db/conexaoPostgres";

export interface LinhaFotografo {
    id_fotografo: number;
    nome: string;
    telefone: string | null;
}

export interface LinhaVinculo {
    id_evento_fotografo: number;
    id_evento: number;
    id_fotografo: number;
    token_upload: string;
}

export async function inserirFotografo(conexao: ConexaoPostgres, nome: string, telefone: string | null): Promise<LinhaFotografo> {
    const [linha] = await conexao.queryParam<LinhaFotografo>(
        "INSERT INTO fotografo (nome, telefone) VALUES (?, ?) RETURNING id_fotografo, nome, telefone",
        [nome, telefone]
    );
    return linha;
}

export async function listarFotografosSql(conexao: ConexaoPostgres): Promise<LinhaFotografo[]> {
    return conexao.queryParam<LinhaFotografo>(
        "SELECT id_fotografo, nome, telefone FROM fotografo WHERE deletado = 'N' ORDER BY nome"
    );
}

export async function eventoExiste(conexao: ConexaoPostgres, idEvento: number): Promise<boolean> {
    const linha = await conexao.queryOneParam("SELECT 1 FROM evento WHERE id_evento = ? AND deletado = 'N'", [idEvento]);
    return !!linha;
}

export async function buscarVinculo(conexao: ConexaoPostgres, idEvento: number, idFotografo: number): Promise<LinhaVinculo | undefined> {
    return conexao.queryOneParam<LinhaVinculo>(
        "SELECT id_evento_fotografo, id_evento, id_fotografo, token_upload FROM evento_fotografo WHERE id_evento = ? AND id_fotografo = ?",
        [idEvento, idFotografo]
    );
}

export async function inserirVinculo(conexao: ConexaoPostgres, idEvento: number, idFotografo: number, tokenUpload: string): Promise<LinhaVinculo> {
    const [linha] = await conexao.queryParam<LinhaVinculo>(
        "INSERT INTO evento_fotografo (id_evento, id_fotografo, token_upload) VALUES (?, ?, ?) RETURNING id_evento_fotografo, id_evento, id_fotografo, token_upload",
        [idEvento, idFotografo, tokenUpload]
    );
    return linha;
}
