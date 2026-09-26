export interface EntradaBusca {
    slug?: string;
    chaveAcesso?: string;
    versaoTermo: string;
    selfies: File[];
    // Token da busca anterior no "buscar de novo": é ele que dispensa refazer a verificação
    // quando ela existir (spec da plataforma §8).
    tokenOrigem?: string;
}

export interface RespostaBusca {
    token: string;
    status: "aguardando" | "liberada";
    qtd_fotos: number;
    previas: string[];
    codigo?: string;
}
