import ConexaoPostgres from "../db/conexaoPostgres";
import { config } from "../services/config";
import { chamarVps } from "../services/vpsHttp";
import { criarFila } from "../services/fila";
import { obterMetricasFila } from "../services/metricas";
import { NOME_FILA as FILA_PROCESSAR } from "./processarFoto";
import { NOME_FILA as FILA_PUBLICAR } from "./publicarFoto";

async function lerGpu(): Promise<unknown> {
    try {
        const resposta = await fetch(`${config.visionUrl}/health`, { signal: AbortSignal.timeout(5000) });
        if (!resposta.ok) return null;
        const corpo = (await resposta.json()) as { gpu: unknown };
        return corpo.gpu ?? null;
    } catch {
        return null;
    }
}

export async function montarSinal(conexao: ConexaoPostgres): Promise<Record<string, unknown>> {
    const [metricas, contagemProcessar, contagemPublicar, gpu] = await Promise.all([
        obterMetricasFila(conexao),
        criarFila(FILA_PROCESSAR).getJobCounts(),
        criarFila(FILA_PUBLICAR).getJobCounts(),
        lerGpu(),
    ]);

    return { fila_bullmq: { processar_foto: contagemProcessar, publicar_foto: contagemPublicar }, ...metricas, gpu };
}

export function iniciarSinalPeriodico(): NodeJS.Timeout {
    return setInterval(async () => {
        const conexao = new ConexaoPostgres();
        try {
            await conexao.open();
            const sinal = await montarSinal(conexao);
            await chamarVps("/api/estacao/sinal", { call: "registrarSinal", ...sinal });
        } catch (erro) {
            console.error("[Sinal] Falha ao enviar o sinal:", erro instanceof Error ? erro.message : erro);
        } finally {
            await conexao.close().catch(() => {});
        }
    }, 30_000);
}
