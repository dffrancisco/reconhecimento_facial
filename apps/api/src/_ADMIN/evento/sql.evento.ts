import ConexaoPostgres from "../../db/conexaoPostgres";
import { ConfigEvento, LinhaEvento } from "./i.evento";

// Datas em texto (YYYY-MM-DD): o `date` do Postgres viraria Date no fuso do processo, e a
// tela mostraria o dia anterior.
const COLUNAS = `id_evento, nome, slug, tipo, privado, chave_acesso, chave_anfitriao,
       to_char(data_inicio, 'YYYY-MM-DD') AS data_inicio, to_char(data_fim, 'YYYY-MM-DD') AS data_fim,
       ativo, config, criado_em`;

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
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING ${COLUNAS}`,
        [dados.nome, dados.slug, dados.tipo, dados.privado, dados.chave_acesso, dados.chave_anfitriao, dados.data_inicio, dados.data_fim, JSON.stringify(dados.config)]
    );
    return linha;
}

export async function listarEventosSql(conexao: ConexaoPostgres): Promise<LinhaEvento[]> {
    return conexao.queryParam<LinhaEvento>(`SELECT ${COLUNAS} FROM evento WHERE deletado = 'N' ORDER BY criado_em DESC`);
}

export async function obterEventoSql(conexao: ConexaoPostgres, idEvento: number): Promise<(LinhaEvento & { qtd_fotos: number }) | undefined> {
    return conexao.queryOneParam<LinhaEvento & { qtd_fotos: number }>(
        `SELECT ${COLUNAS}, (SELECT count(*)::int FROM foto f WHERE f.id_evento = evento.id_evento) AS qtd_fotos
           FROM evento WHERE id_evento = ? AND deletado = 'N'`,
        [idEvento]
    );
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

// FOR UPDATE: a estação publicando uma foto deste evento agora espera a exclusão terminar, e
// então encontra o evento já apagado (e a foto é descartada).
export async function travarEvento(conexao: ConexaoPostgres, idEvento: number): Promise<{ nome: string; slug: string } | undefined> {
    return conexao.queryOneParam<{ nome: string; slug: string }>(
        "SELECT nome, slug FROM evento WHERE id_evento = ? AND deletado = 'N' FOR UPDATE",
        [idEvento]
    );
}

// A ordem importa: `foto` aponta para `evento_fotografo`, que não tem cascade a partir do evento.
// Apagada a foto (o cascade leva rosto, numero_peito e busca_foto) e o vínculo, o DELETE do
// evento leva o resto: busca, arquivo_zip, participante_evento, calibracao, evento_resumo e
// evento_patrocinador.
export async function apagarEventoSql(
    conexao: ConexaoPostgres,
    idEvento: number,
    registro: { nome: string; slug: string; idOperador: number }
): Promise<void> {
    const [{ qtd }] = await conexao.queryParam<{ qtd: number }>("SELECT count(*)::int AS qtd FROM foto WHERE id_evento = ?", [idEvento]);
    await conexao.executeParamCount("DELETE FROM foto WHERE id_evento = ?", [idEvento]);
    await conexao.executeParamCount("DELETE FROM evento_fotografo WHERE id_evento = ?", [idEvento]);
    await conexao.executeParamCount("INSERT INTO evento_excluido (id_evento, nome, slug, qtd_fotos, id_operador) VALUES (?, ?, ?, ?, ?)", [
        idEvento,
        registro.nome,
        registro.slug,
        qtd,
        registro.idOperador,
    ]);
    await conexao.executeParamCount("DELETE FROM evento WHERE id_evento = ?", [idEvento]);
}
