// As URLs de foto e ZIP já vêm assinadas da API e são servidas pelo nginx na mesma origem
// (em desenvolvimento, pelo proxy do Vite). Mexer no caminho invalida a assinatura.
export function urlDeArquivo(caminhoAssinado: string): string {
    return caminhoAssinado;
}

// O link já vem com `dl=1`, que faz o nginx responder como anexo: o navegador baixa e a tela
// fica onde está. O link entra no documento só pelo clique, porque o Firefox ignora clique
// em link solto.
export function baixarArquivo(url: string): void {
    const link = document.createElement("a");
    link.href = url;
    document.body.appendChild(link);
    link.click();
    link.remove();
}
