import path from "node:path";

export function caminhoOriginal(raiz: string, slug: string, dataFoto: string, hash: string): string {
    return path.join(raiz, slug, dataFoto, `${hash}.jpg`);
}

export function caminhoPublicar(raiz: string, idEvento: number, hash: string, tipo: "web" | "thumb" | "previa"): string {
    return path.join(raiz, String(idEvento), `${hash}_${tipo}.jpg`);
}

export function caminhoMarcaDagua(raiz: string, idEvento: number): string {
    return path.join(raiz, `${idEvento}.png`);
}
