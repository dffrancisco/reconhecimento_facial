import ConexaoPostgres from "../../db/conexaoPostgres";

export const FOTOS_POR_PAGINA = 60;

export interface LinhaEventoAnfitriao {
    id_evento: number;
    nome: string;
}

export async function eventoPorChaveAnfitriao(conexao: ConexaoPostgres, chave: string): Promise<LinhaEventoAnfitriao | undefined> {
    return conexao.queryOneParam<LinhaEventoAnfitriao>(
        "SELECT id_evento, nome FROM evento WHERE chave_anfitriao = ? AND deletado = 'N'",
        [chave]
    );
}

export async function fotosDoEvento(
    conexao: ConexaoPostgres,
    idEvento: number,
    offset: number,
    idEventoFotografo: number | null
): Promise<{ id_foto: number; hash_arquivo: string }[]> {
    if (idEventoFotografo !== null)
        return conexao.queryParam(
            `SELECT id_foto, hash_arquivo FROM foto
              WHERE id_evento = ? AND situacao = 'visivel' AND id_evento_fotografo = ?
              ORDER BY capturada_em ASC NULLS LAST, id_foto ASC LIMIT ? OFFSET ?`,
            [idEvento, idEventoFotografo, FOTOS_POR_PAGINA, offset]
        );
    return conexao.queryParam(
        `SELECT id_foto, hash_arquivo FROM foto
          WHERE id_evento = ? AND situacao = 'visivel'
          ORDER BY capturada_em ASC NULLS LAST, id_foto ASC LIMIT ? OFFSET ?`,
        [idEvento, FOTOS_POR_PAGINA, offset]
    );
}

export async function contarFotosVisiveis(conexao: ConexaoPostgres, idEvento: number): Promise<number> {
    const [linha] = await conexao.queryParam<{ total: number }>(
        "SELECT count(*)::int AS total FROM foto WHERE id_evento = ? AND situacao = 'visivel'",
        [idEvento]
    );
    return linha.total;
}

// Uma linha por parte: o spec limita o ZIP a 500 fotos, e um evento grande passa disso.
export async function criarZipsDoEvento(conexao: ConexaoPostgres, idEvento: number, partes: number): Promise<number[]> {
    const ids: number[] = [];
    for (let parte = 1; parte <= partes; parte++) {
        const [linha] = await conexao.queryParam<{ id_arquivo_zip: number }>(
            `INSERT INTO arquivo_zip (id_evento, id_busca, parte, status, expira_em)
             VALUES (?, NULL, ?, 'pendente', now() + interval '7 days') RETURNING id_arquivo_zip`,
            [idEvento, parte]
        );
        ids.push(linha.id_arquivo_zip);
    }
    return ids;
}

// ZIP do anfitrião já montado e ainda válido: reaproveita em vez de refazer o evento inteiro.
export async function zipsValidosDoEvento(conexao: ConexaoPostgres, idEvento: number): Promise<number[]> {
    const linhas = await conexao.queryParam<{ id_arquivo_zip: number }>(
        `SELECT id_arquivo_zip FROM arquivo_zip
          WHERE id_evento = ? AND id_busca IS NULL AND status <> 'erro' AND expira_em > now()
          ORDER BY parte`,
        [idEvento]
    );
    return linhas.map((l) => l.id_arquivo_zip);
}
