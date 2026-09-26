export interface Sessao {
    token: string;
    nome: string;
}

const CHAVE = "sessao_operador";

export function lerSessao(): Sessao | null {
    try {
        const bruto = localStorage.getItem(CHAVE);
        return bruto ? (JSON.parse(bruto) as Sessao) : null;
    } catch {
        return null;
    }
}

export function guardarSessao(sessao: Sessao): void {
    localStorage.setItem(CHAVE, JSON.stringify(sessao));
}

export function sair(): void {
    localStorage.removeItem(CHAVE);
}
