// Fora de HTTPS (como a estação, aberta pelo IP da rede) o navegador nem cria o
// navigator.clipboard. O plano B é o execCommand("copy") numa caixa de texto escondida:
// obsoleto, mas é o que ainda copia sem contexto seguro, desde que venha de um toque.
export async function copiarTexto(texto: string): Promise<boolean> {
    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(texto);
            return true;
        } catch {
            // Recusado (permissão, foco): ainda dá para tentar pela caixa de texto.
        }
    }
    return copiarPelaCaixa(texto);
}

function copiarPelaCaixa(texto: string): boolean {
    const caixa = document.createElement("textarea");
    caixa.value = texto;
    caixa.setAttribute("readonly", "");
    caixa.style.position = "fixed";
    caixa.style.opacity = "0";
    document.body.appendChild(caixa);
    // O Safari do iPhone só copia com a caixa em foco e a seleção feita por intervalo.
    caixa.focus();
    caixa.select();
    caixa.setSelectionRange(0, texto.length);
    try {
        return document.execCommand("copy");
    } catch {
        return false;
    } finally {
        caixa.remove();
    }
}
