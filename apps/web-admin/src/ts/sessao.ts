import { ref } from "vue";

export interface Sessao {
    token: string;
    nome: string;
    // Quem está logado: a tela de usuários marca a própria linha e não oferece excluir a si mesmo.
    id_operador: number;
}

const CHAVE = "sessao_admin";

function ler(): Sessao | null {
    try {
        const bruto = localStorage.getItem(CHAVE);
        return bruto ? (JSON.parse(bruto) as Sessao) : null;
    } catch {
        return null;
    }
}

// Reativa: o App volta para a entrada quando ela some no meio de uma tela (sessão expirada).
export const sessao = ref<Sessao | null>(ler());
// Por que caiu na entrada ("Sessão expirada…"): a entrada mostra uma vez.
export const aviso = ref("");

export function entrarComo(nova: Sessao): void {
    try {
        localStorage.setItem(CHAVE, JSON.stringify(nova));
    } catch {
        // Sem armazenamento a sessão vale só até recarregar a página.
    }
    sessao.value = nova;
    aviso.value = "";
}

export function sair(motivo = ""): void {
    try {
        localStorage.removeItem(CHAVE);
    } catch {
        // Nada guardado para apagar.
    }
    sessao.value = null;
    aviso.value = motivo;
}
