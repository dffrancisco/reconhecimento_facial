// Mesmo teto e mesmas mensagens que a tela usa ao filtrar os arquivos: o fotógrafo lê a
// mesma frase venha a recusa do navegador ou da estação.
export const TAMANHO_MAXIMO_FOTO = 100 * 1024 * 1024;

const EXTENSAO_JPEG = /\.jpe?g$/i;
const SHA256_HEX = /^[0-9a-f]{64}$/i;

export function validarInicio(e: { nome_arquivo: unknown; tamanho: unknown; hash_arquivo: unknown }): string | null {
    if (typeof e.nome_arquivo !== "string" || !EXTENSAO_JPEG.test(e.nome_arquivo)) return "Não é JPEG — exporte em JPEG para enviar.";
    if (typeof e.tamanho !== "number" || !Number.isInteger(e.tamanho) || e.tamanho <= 0) return "Tamanho de arquivo inválido.";
    if (e.tamanho > TAMANHO_MAXIMO_FOTO) return "Foto maior que 100 MB.";
    if (typeof e.hash_arquivo !== "string" || !SHA256_HEX.test(e.hash_arquivo)) return "Impressão digital do arquivo inválida.";
    return null;
}

// A extensão pode mentir (um .jpg que é PNG ou HEIC renomeado): os três primeiros bytes não.
export function ehJpeg(inicio: Buffer): boolean {
    return inicio.length >= 3 && inicio[0] === 0xff && inicio[1] === 0xd8 && inicio[2] === 0xff;
}

export function decidirPedaco(p: {
    offset: number;
    tamanhoAtual: number;
    tamanhoDeclarado: number;
    bytesPedaco: number;
    limitePedaco: number;
}): "ok" | "fora_de_ordem" | "grande_demais" | "passa_do_tamanho" {
    // O tamanho em disco manda: depois de uma queda da estação no meio de um pedaço, é ele
    // que diz de onde o navegador deve continuar.
    if (p.offset !== p.tamanhoAtual) return "fora_de_ordem";
    if (p.bytesPedaco > p.limitePedaco) return "grande_demais";
    if (p.tamanhoAtual + p.bytesPedaco > p.tamanhoDeclarado) return "passa_do_tamanho";
    return "ok";
}

// O detalhe técnico fica no painel do operador; o fotógrafo só precisa saber se tem algo a fazer.
export function mensagemParaFotografo(erroTecnico: string | null, etapa: string | null): string {
    if (erroTecnico?.includes("vision recusou a imagem")) return "A estação não conseguiu ler esta foto (arquivo corrompido).";
    if (etapa === "publicacao") return "A foto está pronta e aguarda envio ao site; não precisa fazer nada.";
    return "A estação teve um problema com esta foto. O operador já vê no painel.";
}
