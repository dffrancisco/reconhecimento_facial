import ConexaoPostgres from "../../db/conexaoPostgres";

export interface LinhaVinculo {
    id_evento_fotografo: number;
    id_evento: number;
    slug: string;
    nome_evento: string;
    nome_fotografo: string;
    ativo: string;
    evento_ativo: string;
    encerrado_em: string | null;
    deletado: string;
}

export interface LinhaUpload {
    id_upload: number;
    id_evento_fotografo: number;
    nome_arquivo: string;
    tamanho: number;
    hash_arquivo: string;
    status: string;
}

export async function vinculoPorToken(conexao: ConexaoPostgres, token: string): Promise<LinhaVinculo | undefined> {
    return conexao.queryOneParam<LinhaVinculo>(
        `SELECT ef.id_evento_fotografo, ef.id_evento, e.slug, e.nome AS nome_evento, f.nome AS nome_fotografo,
                ef.ativo, e.ativo AS evento_ativo, e.encerrado_em, e.deletado
           FROM evento_fotografo ef
           JOIN evento e ON e.id_evento = ef.id_evento
           JOIN fotografo f ON f.id_fotografo = ef.id_fotografo
          WHERE ef.token_upload = ?`,
        [token]
    );
}

// "Já tenho" vale para o evento inteiro: a foto pode ter vindo de outro fotógrafo, ou de um
// upload completo cujo processamento ainda não criou a linha em `foto`.
export async function fotoJaNoEvento(conexao: ConexaoPostgres, idEvento: number, hash: string): Promise<boolean> {
    const linha = await conexao.queryOneParam<{ existe: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM foto WHERE id_evento = ? AND hash_arquivo = ?)
             OR EXISTS (SELECT 1 FROM upload u JOIN evento_fotografo ef ON ef.id_evento_fotografo = u.id_evento_fotografo
                         WHERE ef.id_evento = ? AND u.hash_arquivo = ? AND u.status = 'completo') AS existe`,
        [idEvento, hash, idEvento, hash]
    );
    return Boolean(linha?.existe);
}

export async function uploadEmAndamento(conexao: ConexaoPostgres, idVinculo: number, hash: string): Promise<LinhaUpload | undefined> {
    return conexao.queryOneParam<LinhaUpload>(
        `SELECT id_upload, id_evento_fotografo, nome_arquivo, tamanho, hash_arquivo, status FROM upload
          WHERE id_evento_fotografo = ? AND hash_arquivo = ? AND status = 'recebendo'
          ORDER BY id_upload DESC LIMIT 1`,
        [idVinculo, hash]
    );
}

export async function inserirUpload(
    conexao: ConexaoPostgres,
    u: { id_evento_fotografo: number; nome_arquivo: string; tamanho: number; hash_arquivo: string }
): Promise<number> {
    const [linha] = await conexao.queryParam<{ id_upload: number }>(
        "INSERT INTO upload (id_evento_fotografo, nome_arquivo, tamanho, hash_arquivo) VALUES (?, ?, ?, ?) RETURNING id_upload",
        [u.id_evento_fotografo, u.nome_arquivo, u.tamanho, u.hash_arquivo]
    );
    return linha.id_upload;
}

export async function atualizarRecebidos(conexao: ConexaoPostgres, idUpload: number, bytes: number): Promise<void> {
    await conexao.executeParamCount("UPDATE upload SET bytes_recebidos = ?, updated_at = now() WHERE id_upload = ?", [bytes, idUpload]);
}

export async function contagensDoVinculo(
    conexao: ConexaoPostgres,
    idVinculo: number
): Promise<{ enviadas: number; processando: number; prontas: number; com_erro: number }> {
    const linha = await conexao.queryOneParam<{ enviadas: number; processando: number; prontas: number; com_erro: number }>(
        `SELECT (SELECT count(*)::int FROM upload WHERE id_evento_fotografo = ? AND status = 'completo') AS enviadas,
                count(*) FILTER (WHERE etapa <> 'publicada' AND erro IS NULL)::int AS processando,
                count(*) FILTER (WHERE etapa = 'publicada')::int AS prontas,
                count(*) FILTER (WHERE erro IS NOT NULL)::int AS com_erro
           FROM foto WHERE id_evento_fotografo = ?`,
        [idVinculo, idVinculo]
    );
    return linha ?? { enviadas: 0, processando: 0, prontas: 0, com_erro: 0 };
}

export async function errosDoVinculo(
    conexao: ConexaoPostgres,
    idVinculo: number
): Promise<{ nome_arquivo: string; erro: string; erro_etapa: string | null }[]> {
    return conexao.queryParam(
        `SELECT nome_arquivo, erro, erro_etapa FROM foto
          WHERE id_evento_fotografo = ? AND erro IS NOT NULL ORDER BY id_foto DESC LIMIT 50`,
        [idVinculo]
    );
}

export async function uploadPorId(conexao: ConexaoPostgres, idUpload: number): Promise<LinhaUpload | undefined> {
    return conexao.queryOneParam<LinhaUpload>(
        "SELECT id_upload, id_evento_fotografo, nome_arquivo, tamanho, hash_arquivo, status FROM upload WHERE id_upload = ?",
        [idUpload]
    );
}

export async function marcarStatusUpload(conexao: ConexaoPostgres, idUpload: number, status: "completo" | "cancelado"): Promise<void> {
    await conexao.executeParamCount("UPDATE upload SET status = ?, updated_at = now() WHERE id_upload = ?", [status, idUpload]);
}
