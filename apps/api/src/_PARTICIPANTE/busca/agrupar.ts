import { FotoEncontrada, RostoParecido } from "./i.busca";

// Cada selfie traz a sua lista. A mesma foto pode aparecer em várias: fica a maior
// similaridade, com o id_rosto daquele match (é esse rosto que a exclusão LGPD apaga).
export function agruparResultados(listas: RostoParecido[][], limiar: number): FotoEncontrada[] {
    const melhorPorFoto = new Map<number, FotoEncontrada>();

    for (const lista of listas) {
        for (const item of lista) {
            const atual = melhorPorFoto.get(item.id_foto);
            if (!atual || item.similaridade > atual.similaridade) melhorPorFoto.set(item.id_foto, { ...item });
        }
    }

    return [...melhorPorFoto.values()]
        .filter((foto) => foto.similaridade >= limiar)
        .sort((a, b) => b.similaridade - a.similaridade || a.id_foto - b.id_foto);
}
