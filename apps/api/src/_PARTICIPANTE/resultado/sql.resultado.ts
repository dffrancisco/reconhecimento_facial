import ConexaoPostgres from "../../db/conexaoPostgres";

export interface LinhaBuscaResultado {
    id_busca: number;
    id_evento: number;
    status: string;
    criado_em: string;
    nome: string;
    slug: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: any;
}

export async function buscaComEvento(conexao: ConexaoPostgres, token: string): Promise<LinhaBuscaResultado | undefined> {
    return conexao.queryOneParam<LinhaBuscaResultado>(
        `SELECT b.id_busca, b.id_evento, b.status, b.criado_em, e.nome, e.slug, e.config
           FROM busca b JOIN evento e ON e.id_evento = b.id_evento
          WHERE b.token = ?`,
        [token]
    );
}

// Só fotos que continuam visíveis: a moderação pode ter ocultado alguma depois da busca.
export async function fotosDaBusca(
    conexao: ConexaoPostgres,
    idBusca: number
): Promise<{ id_foto: number; hash_arquivo: string; similaridade: number }[]> {
    return conexao.queryParam(
        `SELECT f.id_foto, f.hash_arquivo, bf.similaridade
           FROM busca_foto bf JOIN foto f ON f.id_foto = bf.id_foto
          WHERE bf.id_busca = ? AND f.situacao = 'visivel'
          ORDER BY bf.similaridade DESC, f.id_foto ASC`,
        [idBusca]
    );
}

export async function fotosDaBuscaPorIds(
    conexao: ConexaoPostgres,
    idBusca: number,
    ids: number[]
): Promise<{ id_foto: number; hash_arquivo: string }[]> {
    if (ids.length === 0) return [];
    return conexao.queryParam(
        `SELECT f.id_foto, f.hash_arquivo
           FROM busca_foto bf JOIN foto f ON f.id_foto = bf.id_foto
          WHERE bf.id_busca = ? AND f.situacao = 'visivel' AND f.id_foto = ANY(?::int[])`,
        [idBusca, `{${ids.join(",")}}`]
    );
}

export async function somarDownloads(conexao: ConexaoPostgres, idBusca: number, quantos: number): Promise<void> {
    await conexao.executeParamCount("UPDATE busca SET qtd_downloads = qtd_downloads + ? WHERE id_busca = ?", [quantos, idBusca]);
}
