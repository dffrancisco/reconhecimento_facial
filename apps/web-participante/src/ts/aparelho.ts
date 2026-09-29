// Um UUID por navegador, criado uma vez: a API já aceita chave_aparelho e vai ligá-la ao
// participante quando a verificação por WhatsApp existir. Sem armazenamento, a busca segue sem ele.
export function chaveDoAparelho(): string | null {
    try {
        let chave = localStorage.getItem("chave_aparelho");
        if (!chave) {
            chave = crypto.randomUUID();
            localStorage.setItem("chave_aparelho", chave);
        }
        return chave;
    } catch {
        return null;
    }
}
