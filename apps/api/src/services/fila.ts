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

export async function fecharFila(): Promise<void> {
    const atual = conexao;
    conexao = undefined;
    await atual?.quit();
}

export function criarFila<T = unknown>(nome: string): Queue<T> {
    return new Queue<T>(nome, { connection: obterConexao(), prefix: config.redis.prefixo });
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
