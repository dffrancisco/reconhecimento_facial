import type { tPapel } from "../src/services/config";

// Aponta para o docker-compose.dev.yml; POSTGRES_* e REDIS_URL do shell têm prioridade.
export function envTeste(papel: tPapel): NodeJS.ProcessEnv {
    return {
        PAPEL: papel,
        POSTGRES_HOST: process.env.POSTGRES_HOST ?? "127.0.0.1",
        POSTGRES_PORT: process.env.POSTGRES_PORT ?? "5433",
        POSTGRES_USER: process.env.POSTGRES_USER ?? "fotos",
        POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD ?? "fotos",
        POSTGRES_DB: papel === "vps" ? "fotos_vps" : "fotos_estacao",
        REDIS_URL: process.env.REDIS_URL ?? "redis://127.0.0.1:6380",
        REDIS_PREFIXO: `fotos:teste:${papel}:`,
        ESTACAO_CHAVE: "c".repeat(32),
        VPS_URL: "http://127.0.0.1:9",
        ARQUIVO_SEGREDO: "segredo-de-teste",
    };
}
