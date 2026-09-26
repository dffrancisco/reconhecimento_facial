// O link do resultado é reaberto dias depois, sem histórico e às vezes com o prazo vencido
// (a API recusa antes de dizer o evento). A entrada guardada na busca é o que leva de volta
// à câmera certa — evento privado só abre por /p/<chave>, nunca pelo slug.
export function guardarEntrada(token: string, caminho: string): void {
    try {
        localStorage.setItem(`entrada:${token}`, caminho);
    } catch {
        // Navegação privada ou armazenamento cheio: o resultado só perde este atalho.
    }
}

export function entradaDaBusca(token: string): string | null {
    try {
        return localStorage.getItem(`entrada:${token}`);
    } catch {
        return null;
    }
}
