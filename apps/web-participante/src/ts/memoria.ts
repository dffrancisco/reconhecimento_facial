import { del, get, set } from "idb-keyval";

export interface MemoriaDoEvento {
    token: string;
    qtd_fotos: number;
    validade_ate: string | null;
    selfie: Blob | null;
    criado_em: string;
}

// A memória vive por entrada do evento ("/e/<slug>" ou "/p/<chave>"), a mesma convenção
// da entrada.ts: evento privado não vaza para o slug. A selfie fica só neste aparelho —
// no servidor ela é apagada logo depois da busca (spec §4).
const chaveDe = (caminho: string) => `memoria:${caminho}`;

export async function guardarMemoria(caminho: string, memoria: MemoriaDoEvento): Promise<void> {
    try {
        await set(chaveDe(caminho), memoria);
    } catch {
        // Aba anônima ou armazenamento cheio: a pessoa só perde o atalho.
    }
}

export async function memoriaDoEvento(caminho: string): Promise<MemoriaDoEvento | null> {
    try {
        const memoria = await get<MemoriaDoEvento>(chaveDe(caminho));
        if (!memoria) return null;
        // A validade local é atalho; quem manda é o servidor (o resultado limpa se ele recusar).
        if (memoria.validade_ate && new Date(memoria.validade_ate).getTime() < Date.now()) {
            await del(chaveDe(caminho));
            return null;
        }
        return memoria;
    } catch {
        return null;
    }
}

export async function atualizarMemoria(caminho: string, parcial: Partial<MemoriaDoEvento>): Promise<void> {
    try {
        const memoria = await get<MemoriaDoEvento>(chaveDe(caminho));
        if (memoria) await set(chaveDe(caminho), { ...memoria, ...parcial });
    } catch {
        // Sem armazenamento, sem atalho.
    }
}

export async function limparMemoria(caminho: string): Promise<void> {
    try {
        await del(chaveDe(caminho));
    } catch {
        // Sem armazenamento, não há o que limpar.
    }
}
