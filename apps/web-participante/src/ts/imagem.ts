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

// Desenha a fonte (quadro do vídeo ou foto da galeria) já reduzida e devolve o JPEG que vai
// para a API. Sem contexto 2D não há o que desenhar: `null` em vez de uma imagem em branco.
export async function jpegDoCanvas(fonte: CanvasImageSource, { largura, altura }: Dimensoes): Promise<File | null> {
    const tela = document.createElement("canvas");
    tela.width = largura;
    tela.height = altura;
    const contexto = tela.getContext("2d");
    if (!contexto) return null;

    contexto.drawImage(fonte, 0, 0, largura, altura);
    const pedaco = await new Promise<Blob | null>((resolve) => tela.toBlob(resolve, "image/jpeg", 0.88));
    return pedaco ? new File([pedaco], "selfie.jpg", { type: "image/jpeg" }) : null;
}

// Foto de galeria vem com 12 a 48 megapixels e pode passar dos 8 MB que a API aceita: passa
// pela mesma redução da câmera. `from-image` aplica a rotação do EXIF, senão a foto tirada
// em pé chega deitada ao vision. Se o navegador não lê o formato, a original segue.
export async function reduzirSelfie(arquivo: File, maior = 1280): Promise<File> {
    try {
        const bitmap = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
        try {
            return (await jpegDoCanvas(bitmap, dimensoesReduzidas(bitmap.width, bitmap.height, maior))) ?? arquivo;
        } finally {
            bitmap.close();
        }
    } catch {
        return arquivo;
    }
}
