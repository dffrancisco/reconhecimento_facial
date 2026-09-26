import ConexaoPostgres from "../../db/conexaoPostgres";

export interface LinhaEventoAndamento {
    id_evento: number;
    nome: string;
    criado_em: string;
}

// Uma estação atende um evento por vez: o mais recente ainda aberto é o que está acontecendo.
export async function eventoEmAndamento(conexao: ConexaoPostgres): Promise<LinhaEventoAndamento | undefined> {
    return conexao.queryOneParam<LinhaEventoAndamento>(
        `SELECT id_evento, nome, criado_em FROM evento
          WHERE ativo = 'S' AND deletado = 'N' AND encerrado_em IS NULL
          ORDER BY criado_em DESC, id_evento DESC LIMIT 1`
    );
}

// `etapa` é a última concluída; cada contador é a etapa que a foto está esperando.
export async function filaDoEvento(
    conexao: ConexaoPostgres,
    idEvento: number
): Promise<{ recebidas: number; rostos: number; derivados: number; esperando_publicar: number }> {
    const linha = await conexao.queryOneParam<{ recebidas: number; rostos: number; derivados: number; esperando_publicar: number }>(
        `SELECT count(*) FILTER (WHERE etapa = 'registrada')::int AS recebidas,
                count(*) FILTER (WHERE etapa = 'original')::int AS rostos,
                count(*) FILTER (WHERE etapa = 'rostos')::int AS derivados,
                count(*) FILTER (WHERE etapa = 'derivados')::int AS esperando_publicar
           FROM foto WHERE id_evento = ? AND erro IS NULL AND etapa <> 'publicada'`,
        [idEvento]
    );
    return linha ?? { recebidas: 0, rostos: 0, derivados: 0, esperando_publicar: 0 };
}

export async function fotografosDoEvento(
    conexao: ConexaoPostgres,
    idEvento: number
): Promise<{ id_evento_fotografo: number; nome: string; token_upload: string; enviadas: number; prontas: number; com_erro: number }[]> {
    return conexao.queryParam(
        `SELECT ef.id_evento_fotografo, f.nome, ef.token_upload,
                (SELECT count(*)::int FROM upload u WHERE u.id_evento_fotografo = ef.id_evento_fotografo AND u.status = 'completo') AS enviadas,
                (SELECT count(*)::int FROM foto fo WHERE fo.id_evento_fotografo = ef.id_evento_fotografo AND fo.etapa = 'publicada') AS prontas,
                (SELECT count(*)::int FROM foto fo WHERE fo.id_evento_fotografo = ef.id_evento_fotografo AND fo.erro IS NOT NULL) AS com_erro
           FROM evento_fotografo ef
           JOIN fotografo f ON f.id_fotografo = ef.id_fotografo
          WHERE ef.id_evento = ? AND ef.ativo = 'S'
          ORDER BY f.nome, ef.id_evento_fotografo`,
        [idEvento]
    );
}

export interface LinhaErro {
    id_foto: number;
    nome_arquivo: string;
    fotografo: string | null;
    etapa: string | null;
    erro: string;
    caminho_original: string | null;
    id_upload: number | null;
}

export async function errosDoEvento(conexao: ConexaoPostgres, idEvento: number): Promise<LinhaErro[]> {
    return conexao.queryParam<LinhaErro>(
        `SELECT fo.id_foto, fo.nome_arquivo, f.nome AS fotografo, fo.erro_etapa AS etapa, fo.erro, fo.caminho_original,
                (SELECT u.id_upload FROM upload u
                  WHERE u.id_evento_fotografo = fo.id_evento_fotografo AND u.hash_arquivo = fo.hash_arquivo
                  ORDER BY u.id_upload DESC LIMIT 1) AS id_upload
           FROM foto fo
           LEFT JOIN evento_fotografo ef ON ef.id_evento_fotografo = fo.id_evento_fotografo
           LEFT JOIN fotografo f ON f.id_fotografo = ef.id_fotografo
          WHERE fo.id_evento = ? AND fo.erro IS NOT NULL
          ORDER BY fo.id_foto DESC LIMIT 50`,
        [idEvento]
    );
}

export interface LinhaFotoComErro {
    id_foto: number;
    id_evento: number;
    id_evento_fotografo: number | null;
    hash_arquivo: string;
    nome_arquivo: string;
    etapa: string;
    caminho_original: string | null;
    id_upload: number | null;
}

const SELECT_FOTO_COM_ERRO = `SELECT fo.id_foto, fo.id_evento, fo.id_evento_fotografo, fo.hash_arquivo, fo.nome_arquivo, fo.etapa, fo.caminho_original,
        (SELECT u.id_upload FROM upload u
          WHERE u.id_evento_fotografo = fo.id_evento_fotografo AND u.hash_arquivo = fo.hash_arquivo
          ORDER BY u.id_upload DESC LIMIT 1) AS id_upload
   FROM foto fo`;

export async function fotoComErro(conexao: ConexaoPostgres, idFoto: number): Promise<LinhaFotoComErro[]> {
    return conexao.queryParam<LinhaFotoComErro>(`${SELECT_FOTO_COM_ERRO} WHERE fo.id_foto = ? AND fo.erro IS NOT NULL`, [idFoto]);
}

export async function fotosComErroDoEvento(conexao: ConexaoPostgres, idEvento: number): Promise<LinhaFotoComErro[]> {
    return conexao.queryParam<LinhaFotoComErro>(`${SELECT_FOTO_COM_ERRO} WHERE fo.id_evento = ? AND fo.erro IS NOT NULL`, [idEvento]);
}

export async function limparErro(conexao: ConexaoPostgres, idFoto: number): Promise<void> {
    await conexao.executeParamCount("UPDATE foto SET erro = NULL, erro_etapa = NULL WHERE id_foto = ?", [idFoto]);
}

export async function contarEmProcessamento(conexao: ConexaoPostgres, idEvento: number): Promise<number> {
    const linha = await conexao.queryOneParam<{ n: number }>(
        "SELECT count(*)::int AS n FROM foto WHERE id_evento = ? AND etapa <> 'publicada' AND erro IS NULL",
        [idEvento]
    );
    return linha?.n ?? 0;
}

export async function eventoAberto(conexao: ConexaoPostgres, idEvento: number): Promise<boolean> {
    const linha = await conexao.queryOneParam<{ id_evento: number }>(
        "SELECT id_evento FROM evento WHERE id_evento = ? AND encerrado_em IS NULL AND deletado = 'N'",
        [idEvento]
    );
    return Boolean(linha);
}

// Plataforma §10: os rostos locais são apagados no encerramento. As fotos publicadas seguem
// no VPS; os originais ficam como acervo do operador.
export async function encerrar(conexao: ConexaoPostgres, idEvento: number): Promise<void> {
    await conexao.executeParamCount("UPDATE evento SET encerrado_em = now() WHERE id_evento = ?", [idEvento]);
    await conexao.executeParamCount("DELETE FROM numero_peito WHERE id_evento = ?", [idEvento]);
    await conexao.executeParamCount("DELETE FROM rosto WHERE id_evento = ?", [idEvento]);
}
