import "./loadEnv";
import { config, iniciarConfig } from "./services/config";
import { fecharBanco } from "./db/conexaoPostgres";
import { fecharFila } from "./services/fila";
import { iniciarWorkerProcessarFoto } from "./jobs/processarFoto";
import { iniciarWorkerPublicarFoto } from "./jobs/publicarFoto";
import { agendarSincronizacao, iniciarWorkerSincronizar } from "./jobs/sincronizar";
import { iniciarSinalPeriodico } from "./jobs/sinal";

try {
    iniciarConfig(process.env);
} catch (erro) {
    console.error((erro as Error).message);
    process.exit(1);
}

async function main(): Promise<void> {
    if (config.papel !== "estacao") {
        // Nenhuma fila desta fase roda na VPS (whatsapp/zip/expurgo são fase 4).
        console.log("[Worker] papel vps não tem filas nesta fase — nada a fazer.");
        return;
    }

    iniciarWorkerProcessarFoto(config.workerConcorrencia);
    iniciarWorkerPublicarFoto();
    iniciarWorkerSincronizar();
    await agendarSincronizacao();
    const temporizadorSinal = iniciarSinalPeriodico();

    console.log(`[Worker] papel ${config.papel} | filas processar-foto, publicar-foto, sincronizar | sinal a cada 30s`);

    let encerrando = false;
    const encerrar = (evento: string) => () => {
        if (encerrando) return;
        encerrando = true;
        console.log(`[Worker] ${evento} recebido, encerrando...`);
        clearInterval(temporizadorSinal);
        Promise.allSettled([fecharFila(), fecharBanco()]).finally(() => process.exit(0));
    };
    process.on("SIGINT", encerrar("SIGINT"));
    process.on("SIGTERM", encerrar("SIGTERM"));
}

main().catch((erro) => {
    console.error("[Worker] Falha na inicialização:", erro instanceof Error ? erro.message : erro);
    process.exit(1);
});
