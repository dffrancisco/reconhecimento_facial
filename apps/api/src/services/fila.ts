import { Processor, Queue, Worker } from "bullmq";
import Redis from "ioredis";
import { config } from "./config";

let conexao: Redis | undefined;

function obterConexao(): Redis {
    if (!conexao) {
        conexao = new Redis(config.redis.url, { maxRetriesPerRequest: null });
        conexao.on("error", (erro) => console.error("[Fila] Erro na conexão Redis:", erro.message));
    }
    return conexao;
}

// Uma Queue por nome: cada `new Queue` registra listeners na conexão compartilhada e nunca
// os solta. Criar uma por foto publicada (e duas por sinal, a cada 30s) acumularia milhares
// num processo de vida longa.
const filas = new Map<string, Queue>();

// O limite de buscas por IP usa a mesma conexão das filas, em vez de abrir outra.
export function obterRedis(): Redis {
    return obterConexao();
}

export async function fecharFila(): Promise<void> {
    const abertas = [...filas.values()];
    filas.clear();
    await Promise.allSettled(abertas.map((fila) => fila.close()));

    const atual = conexao;
    conexao = undefined;
    await atual?.quit();
}

export function criarFila<T = unknown>(nome: string): Queue<T> {
    const existente = filas.get(nome);
    if (existente) return existente as Queue<T>;

    const fila = new Queue<T>(nome, { connection: obterConexao(), prefix: config.redis.prefixo });
    filas.set(nome, fila as Queue);
    return fila;
}

// 1s, 2s, 4s, ... até o teto — para filas que não podem esperar horas por uma dependência externa.
export function backoffComTeto(tetoMs: number): (tentativasFeitas: number) => number {
    return (tentativasFeitas: number) => Math.min(1000 * 2 ** tentativasFeitas, tetoMs);
}

export function criarWorker<T = unknown>(nome: string, processador: Processor<T>, concorrencia: number): Worker<T> {
    const worker = new Worker<T>(nome, processador, {
        connection: obterConexao(),
        prefix: config.redis.prefixo,
        concurrency: concorrencia,
        settings: { backoffStrategy: backoffComTeto(300_000) },
    });
    worker.on("failed", (job, erro) => console.error(`[Fila:${nome}] job ${job?.id} falhou:`, erro.message));
    return worker;
}
