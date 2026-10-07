import ConexaoPostgres from "../../db/conexaoPostgres";
import { LinhaEventoSync, LinhaFotografoSync, LinhaOperadorSync, LinhaVinculoSync } from "./i.sincronizacao";

export async function listarOperadoresSync(conexao: ConexaoPostgres): Promise<LinhaOperadorSync[]> {
    return conexao.queryParam<LinhaOperadorSync>("SELECT id_operador, nome, login, senha_hash, deletado FROM operador");
}

// Desativado há pouco também vai: só assim a estação sabe que ele foi desativado e para de
// aceitar fotos. 7 dias cobre a estação ficar desligada entre um evento e outro.
export async function listarEventosParaEstacao(conexao: ConexaoPostgres): Promise<Omit<LinhaEventoSync, "marca_dagua_caminho">[]> {
    return conexao.queryParam(
        `SELECT id_evento, nome, slug, tipo, privado, chave_acesso, chave_anfitriao, data_inicio, data_fim, ativo, config
           FROM evento
          WHERE deletado = 'N' AND (ativo = 'S' OR updated_at > now() - interval '7 days')`
    );
}

export async function listarEventosExcluidos(conexao: ConexaoPostgres): Promise<number[]> {
    const linhas = await conexao.queryParam<{ id_evento: number }>("SELECT id_evento FROM evento_excluido ORDER BY id_evento");
    return linhas.map((l) => l.id_evento);
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
