import { cpus } from "node:os";

export type tPapel = "estacao" | "vps";

export interface iConfig {
    papel: tPapel;
    porta: number;
    postgres: { host: string; porta: number; usuario: string; senha: string; banco: string };
    redis: { url: string; prefixo: string };
    estacaoChave: string;
    vpsUrl: string;
    arquivoSegredo: string;
    operadorSegredo: string;
    raizMarcas: string;
    raizFotos: string;
    raizOriginais: string;
    raizPublicar: string;
    visionUrl: string;
    workerConcorrencia: number;
    sharpConcorrencia: number;
    arquivoLinkValidadeS: number;
    buscaLimiteIp: number;
    confiarCloudflare: boolean;
    raizSelfies: string;
}

const OBRIGATORIAS: Record<"comum" | tPapel, string[]> = {
    comum: ["POSTGRES_HOST", "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB", "REDIS_URL", "ESTACAO_CHAVE"],
    estacao: ["VPS_URL", "VISION_URL"],
    vps: ["ARQUIVO_SEGREDO", "OPERADOR_SEGREDO", "VISION_URL"],
};

const helper = {
    numero(valor: string | undefined, padrao: number, nome: string): number {
        if (!valor) return padrao;
        const n = Number(valor);
        if (!Number.isInteger(n) || n <= 0)
            throw new Error(`[Config] ${nome} deve ser um número inteiro positivo (recebido: "${valor}")`);
        return n;
    },
};

export function carregarConfig(env: NodeJS.ProcessEnv): iConfig {
    const papel = env.PAPEL;
    if (papel !== "estacao" && papel !== "vps")
        throw new Error(`[Config] PAPEL deve ser "estacao" ou "vps" (recebido: "${papel ?? ""}")`);

    const faltando = [...OBRIGATORIAS.comum, ...OBRIGATORIAS[papel]].filter((nome) => !env[nome]);
    if (faltando.length)
        throw new Error(`[Config] Variáveis obrigatórias faltando para o papel ${papel}: ${faltando.join(", ")}`);

    const estacaoChave = env.ESTACAO_CHAVE as string;
    if (estacaoChave.length < 32) throw new Error("[Config] ESTACAO_CHAVE deve ter pelo menos 32 caracteres");

    const operadorSegredo = env.OPERADOR_SEGREDO ?? "";
    if (papel === "vps" && operadorSegredo.length < 32)
        throw new Error("[Config] OPERADOR_SEGREDO deve ter pelo menos 32 caracteres");

    return {
        papel,
        porta: helper.numero(env.PORTA, 3000, "PORTA"),
        postgres: {
            host: env.POSTGRES_HOST as string,
            porta: helper.numero(env.POSTGRES_PORT, 5432, "POSTGRES_PORT"),
            usuario: env.POSTGRES_USER as string,
            senha: env.POSTGRES_PASSWORD as string,
            banco: env.POSTGRES_DB as string,
        },
        redis: {
            url: env.REDIS_URL as string,
            prefixo: env.REDIS_PREFIXO || `fotos:${papel}:`,
        },
        estacaoChave,
        vpsUrl: env.VPS_URL ?? "",
        arquivoSegredo: env.ARQUIVO_SEGREDO ?? "",
        operadorSegredo,
        raizMarcas: env.RAIZ_MARCAS || "/data/marcas",
        raizFotos: env.RAIZ_FOTOS || "/data/fotos",
        raizOriginais: env.RAIZ_ORIGINAIS || "/data/originais",
        raizPublicar: env.RAIZ_PUBLICAR || "/data/publicar",
        visionUrl: env.VISION_URL ?? "",
        workerConcorrencia: helper.numero(env.WORKER_CONCORRENCIA, 16, "WORKER_CONCORRENCIA"),
        // Spec §7: a etapa `derivados` fica limitada a núcleos - 2, para sobrar CPU para o
        // vision decodificar e para a API responder.
        sharpConcorrencia: helper.numero(env.SHARP_CONCORRENCIA, Math.max(1, cpus().length - 2), "SHARP_CONCORRENCIA"),
        arquivoLinkValidadeS: helper.numero(env.ARQUIVO_LINK_VALIDADE_S, 3600, "ARQUIVO_LINK_VALIDADE_S"),
        buscaLimiteIp: helper.numero(env.BUSCA_LIMITE_IP, 10, "BUSCA_LIMITE_IP"),
        confiarCloudflare: env.CONFIAR_CLOUDFLARE === "true",
        raizSelfies: env.RAIZ_SELFIES || "/data/selfies",
    };
}

// Preenchido uma vez na inicialização; os módulos leem daqui, como no erp_server.
export const config = {} as iConfig;

export function iniciarConfig(env: NodeJS.ProcessEnv): iConfig {
    return Object.assign(config, carregarConfig(env));
}
