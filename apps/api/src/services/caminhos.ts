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

// A pasta inteira de um evento, para apagar na exclusão. Só um nome simples (o slug ou o id)
// dentro da raiz: vazio, "." ou ".." fariam o rm levar a raiz junto com tudo o que há nela.
export function pastaDoEvento(raiz: string, nome: string): string | null {
    if (!nome.trim() || nome === "." || nome === ".." || /[\\/]/.test(nome)) return null;
    const pasta = path.resolve(raiz, nome);
    return path.dirname(pasta) === path.resolve(raiz) ? pasta : null;
}
