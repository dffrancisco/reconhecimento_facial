import ConexaoPostgres from "../../db/conexaoPostgres";
import { ConfigEvento, LinhaEvento } from "./i.evento";

export async function inserirEvento(
    conexao: ConexaoPostgres,
    dados: {
        nome: string;
        slug: string;
        tipo: string;
        privado: string;
        chave_acesso: string | null;
        chave_anfitriao: string;
        data_inicio: string | null;
        data_fim: string;
        config: ConfigEvento;
    }
): Promise<LinhaEvento> {
    const [linha] = await conexao.queryParam<LinhaEvento>(
        `INSERT INTO evento (nome, slug, tipo, privado, chave_acesso, chave_anfitriao, data_inicio, data_fim, config)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
        [dados.nome, dados.slug, dados.tipo, dados.privado, dados.chave_acesso, dados.chave_anfitriao, dados.data_inicio, dados.data_fim, JSON.stringify(dados.config)]
    );
    return linha;
}

export async function listarEventosSql(conexao: ConexaoPostgres): Promise<LinhaEvento[]> {
    return conexao.queryParam<LinhaEvento>(
        "SELECT id_evento, nome, slug, tipo, privado, chave_anfitriao, data_inicio, data_fim, ativo, criado_em FROM evento WHERE deletado = 'N' ORDER BY criado_em DESC"
    );
}

export async function obterEventoSql(conexao: ConexaoPostgres, idEvento: number): Promise<LinhaEvento | undefined> {
    return conexao.queryOneParam<LinhaEvento>("SELECT * FROM evento WHERE id_evento = ? AND deletado = 'N'", [idEvento]);
}

export async function atualizarEventoSql(
    conexao: ConexaoPostgres,
    idEvento: number,
    dados: { nome: string; data_inicio: string | null; data_fim: string; ativo: string; privado: string; chave_acesso: string | null; config: ConfigEvento }
): Promise<void> {
    await conexao.executeParamCount(
        `UPDATE evento SET nome = ?, data_inicio = ?, data_fim = ?, ativo = ?, privado = ?, chave_acesso = ?, config = ?, updated_at = now()
         WHERE id_evento = ?`,
        [dados.nome, dados.data_inicio, dados.data_fim, dados.ativo, dados.privado, dados.chave_acesso, JSON.stringify(dados.config), idEvento]
    );
}
