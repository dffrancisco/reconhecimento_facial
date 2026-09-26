import { createStore, del, entries, get, set } from "idb-keyval";
import type { SituacaoItem } from "./fila/tipos";

export interface RegistroItem {
    hash?: string;
    situacao?: SituacaoItem;
    idUpload?: number;
}

const PENDENTES: SituacaoItem[] = ["esperando", "preparando", "enviando"];

export interface Armazenamento {
    lerHash(chave: string): Promise<string | undefined>;
    gravarHash(chave: string, hash: string): Promise<void>;
    gravarItem(chave: string, registro: RegistroItem): Promise<void>;
    pendentes(): Promise<number>;
    esquecerPendentes(): Promise<void>;
}

// Um banco por fotógrafo (pelo token): no mesmo notebook, a fila de um não aparece para o outro.
export function criarArmazenamento(token: string): Armazenamento {
    const loja = createStore(`fotografo-${token.slice(0, 16)}`, "itens");

    const mesclar = async (chave: string, parcial: RegistroItem) => {
        const atual = ((await get<RegistroItem>(chave, loja)) ?? {}) as RegistroItem;
        await set(chave, { ...atual, ...parcial }, loja);
    };

    return {
        async lerHash(chave) {
            return (await get<RegistroItem>(chave, loja))?.hash;
        },
        gravarHash: (chave, hash) => mesclar(chave, { hash }),
        gravarItem: (chave, registro) => mesclar(chave, registro),
        async pendentes() {
            const todos = await entries<string, RegistroItem>(loja);
            return todos.filter(([, r]) => r.situacao && PENDENTES.includes(r.situacao)).length;
        },
        async esquecerPendentes() {
            const todos = await entries<string, RegistroItem>(loja);
            for (const [chave, r] of todos) if (r.situacao && PENDENTES.includes(r.situacao)) await del(chave, loja);
        },
    };
}
