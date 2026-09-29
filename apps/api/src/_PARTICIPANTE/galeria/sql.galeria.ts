import ConexaoPostgres from "../../db/conexaoPostgres";

export const FOTOS_POR_PAGINA = 60;
// Evento é sempre no Brasil nesta etapa: o dia do chip é o dia local do evento,
// não o dia UTC do servidor (spec §3).
export const FUSO_EVENTO = "America/Sao_Paulo";

export interface LinhaEventoPublico {
    id_evento: number;
    nome: string;
    data_inicio: string | null;
    data_fim: string;
    ativo: "S" | "N";
}

// Evento privado nunca abre pelo slug, como na busca (spec do app §3.1).
// to_char nas datas: o driver devolveria Date, que vira ISO com fuso no JSON e
// quebraria o split("-") do front.
export async function eventoPublico(
    conexao: ConexaoPostgres,
    entrada: { slug?: string; chaveAcesso?: string }
): Promise<LinhaEventoPublico | undefined> {
    const colunas = `id_evento, nome, to_char(data_inicio, 'YYYY-MM-DD') AS data_inicio,
                     to_char(data_fim, 'YYYY-MM-DD') AS data_fim, ativo`;
    if (entrada.chaveAcesso)
        return conexao.queryOneParam<LinhaEventoPublico>(
            `SELECT ${colunas} FROM evento WHERE chave_acesso = ? AND deletado = 'N'`,
            [entrada.chaveAcesso]
        );
    if (entrada.slug)
        return conexao.queryOneParam<LinhaEventoPublico>(
            `SELECT ${colunas} FROM evento WHERE slug = ? AND privado = 'N' AND deletado = 'N'`,
            [entrada.slug]
        );
    return undefined;
}

// Foto sem EXIF ganha a hora do processamento em capturada_em (processarFoto), mas a
// coluna é anulável: o COALESCE com publicada_em garante que nenhuma foto fique fora
// de todos os dias.
export async function diasDoEvento(conexao: ConexaoPostgres, idEvento: number): Promise<{ dia: string; qtd: number }[]> {
    return conexao.queryParam(
        `SELECT to_char(COALESCE(capturada_em, publicada_em) AT TIME ZONE '${FUSO_EVENTO}', 'YYYY-MM-DD') AS dia,
                count(*)::int AS qtd
           FROM foto
          WHERE id_evento = ? AND situacao = 'visivel'
          GROUP BY 1
          ORDER BY 1`,
        [idEvento]
    );
}

export async function fotosDoEvento(
    conexao: ConexaoPostgres,
    idEvento: number,
    offset: number,
    dia: string | null
): Promise<{ id_foto: number; hash_arquivo: string }[]> {
    if (dia !== null)
        return conexao.queryParam(
            `SELECT id_foto, hash_arquivo FROM foto
              WHERE id_evento = ? AND situacao = 'visivel'
                AND to_char(COALESCE(capturada_em, publicada_em) AT TIME ZONE '${FUSO_EVENTO}', 'YYYY-MM-DD') = ?
              ORDER BY capturada_em ASC NULLS LAST, id_foto ASC LIMIT ? OFFSET ?`,
            [idEvento, dia, FOTOS_POR_PAGINA, offset]
        );
    return conexao.queryParam(
        `SELECT id_foto, hash_arquivo FROM foto
          WHERE id_evento = ? AND situacao = 'visivel'
          ORDER BY capturada_em ASC NULLS LAST, id_foto ASC LIMIT ? OFFSET ?`,
        [idEvento, FOTOS_POR_PAGINA, offset]
    );
}
