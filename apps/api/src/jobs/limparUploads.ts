import fs from "node:fs/promises";
import ConexaoPostgres from "../db/conexaoPostgres";
import { caminhoParcial } from "../_FOTOGRAFO/upload/ctrl.upload";

const ABANDONO_H = 24;
const INTERVALO_MS = 60 * 60 * 1000;

// Envio que parou no meio e nunca voltou (aba fechada de vez, fotógrafo que desistiu) deixa um
// arquivo parcial de até 60 MB: sem limpeza, eles enchem o disco da estação ao longo do evento.
export async function limparUploadsAbandonados(conexao: ConexaoPostgres): Promise<number> {
    const abandonados = await conexao.queryParam<{ id_upload: number }>(
        `SELECT id_upload FROM upload WHERE status = 'recebendo' AND updated_at < now() - (? || ' hours')::interval`,
        [String(ABANDONO_H)]
    );
    for (const { id_upload } of abandonados) {
        await fs.rm(caminhoParcial(id_upload), { force: true });
        await conexao.executeParamCount("UPDATE upload SET status = 'cancelado', updated_at = now() WHERE id_upload = ?", [id_upload]);
    }
    return abandonados.length;
}

export function iniciarLimpezaUploads(): NodeJS.Timeout {
    return setInterval(async () => {
        const conexao = new ConexaoPostgres();
        try {
            await conexao.open();
            const apagados = await limparUploadsAbandonados(conexao);
            if (apagados > 0) console.log(`[LimparUploads] ${apagados} envio(s) abandonado(s) apagado(s)`);
        } catch (erro) {
            console.error("[LimparUploads] Falha:", erro instanceof Error ? erro.message : erro);
        } finally {
            await conexao.close();
        }
    }, INTERVALO_MS);
}
