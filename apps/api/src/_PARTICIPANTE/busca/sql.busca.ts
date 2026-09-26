import ConexaoPostgres from "../../db/conexaoPostgres";
import { FotoEncontrada, RostoParecido } from "./i.busca";

export interface LinhaEventoBusca {
    id_evento: number;
    nome: string;
    slug: string;
    privado: "S" | "N";
    ativo: "S" | "N";
    data_fim: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: any;
}

export interface DadosGravarBusca {
    id_evento: number;
    token: string;
    codigo: string | null;
    status: "aguardando" | "liberada";
    qtd_fotos: number;
    versao_termo: string;
    aceita_marketing: "S" | "N";
    id_participante: number | null;
    id_busca_origem: number | null;
    codigo_expira_em: string | null;
}

export interface LinhaBuscaToken {
    id_busca: number;
    id_evento: number;
    status: string;
    qtd_fotos: number;
    id_participante: number | null;
    criado_em: string;
}

// O índice HNSW é global (todos os eventos). Com o filtro por evento, a varredura iterativa
// é o que mantém o recall: sem ela, o limite do índice se esgota antes de achar as fotos
// deste evento. `SET LOCAL` exige transação, por isso o BEGIN/COMMIT explícito.
export async function buscarRostosParecidos(conexao: ConexaoPostgres, idEvento: number, embedding: number[]): Promise<RostoParecido[]> {
    const vetor = `[${embedding.join(",")}]`;
    await conexao.executeParamCount("BEGIN");
    try {
        await conexao.executeParamCount("SET LOCAL hnsw.ef_search = 100");
        await conexao.executeParamCount("SET LOCAL hnsw.iterative_scan = relaxed_order");
        const linhas = await conexao.queryParam<{ id_foto: number; id_rosto: string; similaridade: number }>(
            `SELECT r.id_foto, r.id_rosto, 1 - (r.embedding <=> ?::vector) AS similaridade
               FROM rosto r
               JOIN foto f ON f.id_foto = r.id_foto AND f.situacao = 'visivel'
              WHERE r.id_evento = ?
              ORDER BY r.embedding <=> ?::vector
              LIMIT 400`,
            [vetor, idEvento, vetor]
        );
        await conexao.executeParamCount("COMMIT");
        return linhas.map((l) => ({ id_foto: l.id_foto, id_rosto: Number(l.id_rosto), similaridade: Number(l.similaridade) }));
    } catch (erro) {
        await conexao.executeParamCount("ROLLBACK").catch(() => {});
        throw erro;
    }
}

// Evento privado nunca abre pelo slug (spec §8): só pela chave de acesso.
export async function eventoPorSlugOuChave(
    conexao: ConexaoPostgres,
    entrada: { slug?: string; chaveAcesso?: string }
): Promise<LinhaEventoBusca | undefined> {
    if (entrada.chaveAcesso)
        return conexao.queryOneParam<LinhaEventoBusca>(
            "SELECT id_evento, nome, slug, privado, ativo, data_fim, config FROM evento WHERE chave_acesso = ? AND deletado = 'N'",
            [entrada.chaveAcesso]
        );
    if (entrada.slug)
        return conexao.queryOneParam<LinhaEventoBusca>(
            "SELECT id_evento, nome, slug, privado, ativo, data_fim, config FROM evento WHERE slug = ? AND privado = 'N' AND deletado = 'N'",
            [entrada.slug]
        );
    return undefined;
}

export async function participantePorChaveAparelho(conexao: ConexaoPostgres, idEvento: number, chaveHash: string): Promise<number | undefined> {
    const linha = await conexao.queryOneParam<{ id_participante: number }>(
        `SELECT pe.id_participante
           FROM aparelho a
           JOIN participante_evento pe ON pe.id_participante_evento = a.id_participante_evento
          WHERE a.chave_hash = ? AND pe.id_evento = ?`,
        [chaveHash, idEvento]
    );
    return linha?.id_participante;
}

export async function codigoEmUso(conexao: ConexaoPostgres, codigo: string): Promise<boolean> {
    const linha = await conexao.queryOneParam<{ existe: number }>(
        "SELECT 1 AS existe FROM busca WHERE codigo = ? AND status = 'aguardando' AND codigo_expira_em > now()",
        [codigo]
    );
    return Boolean(linha);
}

export async function gravarBusca(conexao: ConexaoPostgres, dados: DadosGravarBusca): Promise<number> {
    const [linha] = await conexao.queryParam<{ id_busca: number }>(
        `INSERT INTO busca (id_evento, token, codigo, status, qtd_fotos, consentimento_em, versao_termo,
                            aceita_marketing, id_participante, id_busca_origem, codigo_expira_em)
         VALUES (?, ?, ?, ?, ?, now(), ?, ?, ?, ?, ?) RETURNING id_busca`,
        [
            dados.id_evento,
            dados.token,
            dados.codigo,
            dados.status,
            dados.qtd_fotos,
            dados.versao_termo,
            dados.aceita_marketing,
            dados.id_participante,
            dados.id_busca_origem,
            dados.codigo_expira_em,
        ]
    );
    return linha.id_busca;
}

export async function gravarBuscaFotos(conexao: ConexaoPostgres, idBusca: number, fotos: FotoEncontrada[]): Promise<void> {
    for (const foto of fotos)
        await conexao.executeParamCount(
            "INSERT INTO busca_foto (id_busca, id_foto, id_rosto, similaridade) VALUES (?, ?, ?, ?) ON CONFLICT (id_busca, id_foto) DO NOTHING",
            [idBusca, foto.id_foto, foto.id_rosto, foto.similaridade]
        );
}

export async function buscaPorToken(conexao: ConexaoPostgres, token: string): Promise<LinhaBuscaToken | undefined> {
    return conexao.queryOneParam<LinhaBuscaToken>(
        "SELECT id_busca, id_evento, status, qtd_fotos, id_participante, criado_em FROM busca WHERE token = ?",
        [token]
    );
}
