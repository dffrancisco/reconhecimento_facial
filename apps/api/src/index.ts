import "./loadEnv";
import { iConfig, iniciarConfig } from "./services/config";
import { criarApp } from "./services/servidor";
import { fecharBanco } from "./db/conexaoPostgres";
import { fecharRedis } from "./services/redis";

function main(): void {
    let config: iConfig;
    try {
        config = iniciarConfig(process.env);
    } catch (erro) {
        console.error((erro as Error).message);
        process.exit(1);
    }

    const servidor = criarApp().listen(config.porta, () => {
        console.log(`[Api] Papel ${config.papel} ouvindo na porta ${config.porta}`);
    });

    const encerrar = async () => {
        console.log("[Api] Encerrando...");
        servidor.close();
        await Promise.allSettled([fecharBanco(), fecharRedis()]);
        process.exit(0);
    };
    process.on("SIGTERM", encerrar);
    process.on("SIGINT", encerrar);
}

main();
