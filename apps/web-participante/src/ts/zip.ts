export interface SituacaoZip {
    status: string;
    url?: string;
}

export type ResultadoZip = { situacao: "pronto"; urls: string[] } | { situacao: "erro" } | { situacao: "demorou" };

// Acima de 500 fotos a API divide o ZIP em partes: todas entram, senão o resto ficaria de
// fora sem ninguém perceber. "demorou" não é falha — pedir de novo devolve o mesmo arquivo.
export async function esperarPartes(
    partes: number[],
    consultar: (idArquivoZip: number) => Promise<SituacaoZip>,
    { tentativas, esperaMs }: { tentativas: number; esperaMs: number },
): Promise<ResultadoZip> {
    const urls: string[] = [];
    for (const parte of partes) {
        let url: string | null = null;
        for (let tentativa = 0; tentativa < tentativas && !url; tentativa++) {
            if (tentativa > 0) await new Promise((resolve) => setTimeout(resolve, esperaMs));
            const situacao = await consultar(parte);
            if (situacao.status === "erro") return { situacao: "erro" };
            if (situacao.status === "pronto" && situacao.url) url = situacao.url;
        }
        if (!url) return { situacao: "demorou" };
        urls.push(url);
    }
    return urls.length > 0 ? { situacao: "pronto", urls } : { situacao: "erro" };
}
