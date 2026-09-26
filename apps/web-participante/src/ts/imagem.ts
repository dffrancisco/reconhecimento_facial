export interface Dimensoes {
    largura: number;
    altura: number;
}

// A selfie sai do celular com 12 megapixels e vai por rede móvel: reduzir antes de enviar
// é o que faz a busca começar em segundos (spec da plataforma §8).
export function dimensoesReduzidas(largura: number, altura: number, maior: number): Dimensoes {
    const ladoMaior = Math.max(largura, altura);
    if (ladoMaior <= maior) return { largura, altura };

    const escala = maior / ladoMaior;
    return { largura: Math.round(largura * escala), altura: Math.round(altura * escala) };
}
