import { createSHA256 } from "hash-wasm";

const FATIA = 4 * 1024 * 1024;

// Lê em fatias para não pôr uma foto de 25 MB inteira na memória de uma vez. `crypto.subtle`
// não serve: ele não existe em http://<ip-da-rede-local>, que é como a estação é aberta.
export async function sha256EmFatias(arquivo: Blob, fatia = FATIA): Promise<string> {
    const hasher = await createSHA256();
    hasher.init();
    for (let inicio = 0; inicio < arquivo.size; inicio += fatia) {
        hasher.update(new Uint8Array(await arquivo.slice(inicio, inicio + fatia).arrayBuffer()));
    }
    return hasher.digest("hex");
}

let trabalhador: Worker | null = null;
let proximo = 0;
const pendentes = new Map<number, { ok(hash: string): void; falha(erro: Error): void }>();

function obterTrabalhador(): Worker | null {
    if (trabalhador || typeof Worker === "undefined") return trabalhador;
    trabalhador = new Worker(new URL("./hash.worker.ts", import.meta.url), { type: "module" });
    trabalhador.onmessage = (evento: MessageEvent<{ id: number; hash?: string; erro?: string }>) => {
        const pedido = pendentes.get(evento.data.id);
        if (!pedido) return;
        pendentes.delete(evento.data.id);
        if (evento.data.hash) pedido.ok(evento.data.hash);
        else pedido.falha(new Error(evento.data.erro ?? "falha ao calcular a impressão digital"));
    };
    return trabalhador;
}

// Num Web Worker: calcular o hash de centenas de fotos na thread da tela a congelaria.
export function calcularHash(arquivo: File): Promise<string> {
    const w = obterTrabalhador();
    if (!w) return sha256EmFatias(arquivo);
    const id = ++proximo;
    return new Promise((ok, falha) => {
        pendentes.set(id, { ok, falha });
        w.postMessage({ id, arquivo });
    });
}
