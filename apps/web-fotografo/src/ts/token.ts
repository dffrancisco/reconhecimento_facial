// O token do link é a credencial do fotógrafo: fica guardado para ele reabrir a tela depois
// (inclusive para retomar envios pendentes) sem precisar do link de novo.
const CHAVE = "token_upload";

export function lerToken(): string | null {
    try {
        return localStorage.getItem(CHAVE);
    } catch {
        return null;
    }
}

export function guardarToken(token: string): void {
    localStorage.setItem(CHAVE, token);
}
