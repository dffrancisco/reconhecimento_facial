// Limita quantas tarefas pesadas rodam ao mesmo tempo. A etapa `derivados` passa por aqui
// (spec §7): o sharp é o único trecho do pipeline que come CPU, e ela é disputada com a
// decodificação do vision e com a API.
export function criarSemaforo(limite: number): <T>(tarefa: () => Promise<T>) => Promise<T> {
    let emUso = 0;
    const espera: (() => void)[] = [];

    return async function executar<T>(tarefa: () => Promise<T>): Promise<T> {
        if (emUso >= limite) await new Promise<void>((resolve) => espera.push(resolve));
        emUso++;
        try {
            return await tarefa();
        } finally {
            emUso--;
            espera.shift()?.();
        }
    };
}
