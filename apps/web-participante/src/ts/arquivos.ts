// As URLs de foto e ZIP já vêm assinadas da API e são servidas pelo nginx na mesma origem
// (em desenvolvimento, pelo proxy do Vite). Mexer no caminho invalida a assinatura.
export function urlDeArquivo(caminhoAssinado: string): string {
    return caminhoAssinado;
}
