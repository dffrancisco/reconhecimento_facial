import ConexaoPostgres from "../db/conexaoPostgres";

export function percentil(valores: number[], p: number): number {
    if (valores.length === 0) return 0;
    const ordenados = [...valores].sort((a, b) => a - b);
    const indice = Math.min(ordenados.length, Math.max(1, Math.ceil((p / 100) * ordenados.length))) - 1;
    return ordenados[indice];
}

export interface MetricasFila {
    por_etapa: Record<string, number>;
    fotos_min: { 1: number; 5: number; 15: number };
    taxa_erro: number;
    latencia_ms: { p50: number; p95: number };
}

export async function obterMetricasFila(conexao: ConexaoPostgres): Promise<MetricasFila> {
    const porEtapaLinhas = await conexao.queryParam<{ etapa: string; quantidade: number }>(
        "SELECT etapa, count(*)::int AS quantidade FROM foto WHERE etapa <> 'publicada' GROUP BY etapa"
    );
    const por_etapa = Object.fromEntries(porEtapaLinhas.map((l) => [l.etapa, l.quantidade]));

    const fotos_min = { 1: 0, 5: 0, 15: 0 } as { 1: number; 5: number; 15: number };
    for (const janela of [1, 5, 15] as const) {
        const [linha] = await conexao.queryParam<{ quantidade: number }>(
            "SELECT count(*)::int AS quantidade FROM foto WHERE publicada_em > now() - (? || ' minutes')::interval",
            [String(janela)]
        );
        fotos_min[janela] = Math.round(linha.quantidade / janela);
    }

    const [erroLinha] = await conexao.queryParam<{ com_erro: number; total: number }>(
        "SELECT count(*) FILTER (WHERE erro IS NOT NULL)::int AS com_erro, count(*)::int AS total FROM foto WHERE criado_em > now() - interval '30 minutes'"
    );
    const taxa_erro = erroLinha.total > 0 ? erroLinha.com_erro / erroLinha.total : 0;

    const latenciaLinhas = await conexao.queryParam<{ latencia_ms: string }>(
        `SELECT EXTRACT(EPOCH FROM (publicada_em - criado_em)) * 1000 AS latencia_ms FROM foto
          WHERE publicada_em IS NOT NULL AND publicada_em > now() - interval '30 minutes'`
    );
    const valoresLatencia = latenciaLinhas.map((l) => Number(l.latencia_ms));

    return { por_etapa, fotos_min, taxa_erro, latencia_ms: { p50: percentil(valoresLatencia, 50), p95: percentil(valoresLatencia, 95) } };
}
