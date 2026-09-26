import { config } from "./config";
import { obterRedis } from "./fila";

// O painel mostra "sincronizou há N s": é o único sinal, para o operador, de que a estação
// está falando com o VPS (e de que eventos e fotógrafos novos vão aparecer).
const chave = () => `${config.redis.prefixo}estacao:ultima_sincronizacao`;

export async function registrarSincronizacao(agora = new Date()): Promise<void> {
    await obterRedis().set(chave(), agora.toISOString());
}

export async function ultimaSincronizacao(): Promise<string | null> {
    return obterRedis().get(chave());
}
