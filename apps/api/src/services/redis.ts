import Redis from "ioredis";
import { config } from "./config";

let cliente: Redis | undefined;

export function redis(): Redis {
    if (!cliente) {
        cliente = new Redis(config.redis.url, { keyPrefix: config.redis.prefixo, maxRetriesPerRequest: 1 });
        cliente.on("error", (erro) => console.error("[Redis]", erro.message));
    }
    return cliente;
}

export async function fecharRedis(): Promise<void> {
    const atual = cliente;
    cliente = undefined;
    if (atual) await atual.quit().catch(() => atual.disconnect());
}
