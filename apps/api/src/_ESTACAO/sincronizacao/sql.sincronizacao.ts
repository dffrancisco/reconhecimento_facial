import ConexaoPostgres from "../../db/conexaoPostgres";
import { LinhaEventoSync, LinhaFotografoSync, LinhaOperadorSync, LinhaVinculoSync } from "./i.sincronizacao";

export async function listarOperadoresSync(conexao: ConexaoPostgres): Promise<LinhaOperadorSync[]> {
    return conexao.queryParam<LinhaOperadorSync>("SELECT id_operador, nome, login, senha_hash, deletado FROM operador");
}

export async function listarEventosAtivosSync(conexao: ConexaoPostgres): Promise<Omit<LinhaEventoSync, "marca_dagua_caminho">[]> {
    return conexao.queryParam(
        `SELECT id_evento, nome, slug, tipo, privado, chave_acesso, chave_anfitriao, data_inicio, data_fim, ativo, config
           FROM evento WHERE ativo = 'S' AND deletado = 'N'`
    );
}

export async function listarFotografosSync(conexao: ConexaoPostgres): Promise<LinhaFotografoSync[]> {
    return conexao.queryParam<LinhaFotografoSync>("SELECT id_fotografo, nome, telefone, deletado FROM fotografo");
}

export async function listarVinculosSync(conexao: ConexaoPostgres, idsEvento: number[]): Promise<LinhaVinculoSync[]> {
    if (idsEvento.length === 0) return [];
    return conexao.queryParam<LinhaVinculoSync>(
        "SELECT id_evento_fotografo, id_evento, id_fotografo, token_upload, ativo FROM evento_fotografo WHERE id_evento = ANY(?::int[])",
        [idsEvento]
    );
}
