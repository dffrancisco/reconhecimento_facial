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
    ativo: "S" | "N";
}

export interface LinhaVinculoDoEvento {
    id_evento_fotografo: number;
    id_fotografo: number;
    nome: string;
    telefone: string | null;
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
        "SELECT id_evento_fotografo, id_evento, id_fotografo, token_upload, ativo FROM evento_fotografo WHERE id_evento = ? AND id_fotografo = ?",
        [idEvento, idFotografo]
    );
}

export async function inserirVinculo(conexao: ConexaoPostgres, idEvento: number, idFotografo: number, tokenUpload: string): Promise<LinhaVinculo> {
    const [linha] = await conexao.queryParam<LinhaVinculo>(
        "INSERT INTO evento_fotografo (id_evento, id_fotografo, token_upload) VALUES (?, ?, ?) RETURNING id_evento_fotografo, id_evento, id_fotografo, token_upload, ativo",
        [idEvento, idFotografo, tokenUpload]
    );
    return linha;
}

export async function fotografoExiste(conexao: ConexaoPostgres, idFotografo: number): Promise<boolean> {
    const linha = await conexao.queryOneParam("SELECT 1 FROM fotografo WHERE id_fotografo = ? AND deletado = 'N'", [idFotografo]);
    return !!linha;
}

export async function reativarVinculo(conexao: ConexaoPostgres, idEventoFotografo: number, tokenUpload: string): Promise<LinhaVinculo> {
    const [linha] = await conexao.queryParam<LinhaVinculo>(
        `UPDATE evento_fotografo SET ativo = 'S', token_upload = ? WHERE id_evento_fotografo = ?
         RETURNING id_evento_fotografo, id_evento, id_fotografo, token_upload, ativo`,
        [tokenUpload, idEventoFotografo]
    );
    return linha;
}

export async function listarVinculosSql(conexao: ConexaoPostgres, idEvento: number): Promise<LinhaVinculoDoEvento[]> {
    return conexao.queryParam<LinhaVinculoDoEvento>(
        `SELECT ef.id_evento_fotografo, ef.id_fotografo, f.nome, f.telefone
           FROM evento_fotografo ef
           JOIN fotografo f ON f.id_fotografo = ef.id_fotografo
          WHERE ef.id_evento = ? AND ef.ativo = 'S'
          ORDER BY f.nome, ef.id_evento_fotografo`,
        [idEvento]
    );
}

export async function desativarVinculo(conexao: ConexaoPostgres, idEventoFotografo: number): Promise<number> {
    return conexao.executeParamCount("UPDATE evento_fotografo SET ativo = 'N' WHERE id_evento_fotografo = ?", [idEventoFotografo]);
}
