// O navigator.share do computador existe mas recusa anexo; a pergunta é se ele aceita
// um arquivo, não só se a função existe.
export function podeCompartilharArquivos(): boolean {
    const nav = globalThis.navigator as Navigator | undefined;
    if (typeof nav?.share !== "function" || typeof nav.canShare !== "function") return false;
    return nav.canShare({ files: [new File([], "foto.jpg", { type: "image/jpeg" })] });
}

export type ResultadoCompartilhar = { situacao: "ok" | "cancelado" } | { situacao: "toqueDeNovo"; arquivo: File };

// Baixa a foto para anexar (compartilhar só o link mandaria uma URL que vence em uma hora)
// e abre o menu do sistema — no iOS ele tem "Salvar imagem", que é o salvar de verdade.
export async function compartilharFoto(entrada: {
    url: string;
    nomeArquivo: string;
    titulo: string;
    arquivoPronto?: File;
}): Promise<ResultadoCompartilhar> {
    let arquivo = entrada.arquivoPronto ?? null;
    if (!arquivo) {
        const resposta = await fetch(entrada.url);
        if (!resposta.ok) throw new Error(`A foto respondeu ${resposta.status}.`);
        arquivo = new File([await resposta.blob()], entrada.nomeArquivo, { type: "image/jpeg" });
    }

    try {
        await navigator.share({ files: [arquivo], title: entrada.titulo });
        return { situacao: "ok" };
    } catch (erro) {
        if (erro instanceof DOMException && erro.name === "AbortError") return { situacao: "cancelado" };
        // No iPhone o menu só abre colado no toque: com a foto já em mãos, o segundo toque
        // abre na hora — baixar para Arquivos no lugar não põe a foto na galeria.
        if (!entrada.arquivoPronto && erro instanceof DOMException && erro.name === "NotAllowedError")
            return { situacao: "toqueDeNovo", arquivo };
        throw erro;
    }
}
