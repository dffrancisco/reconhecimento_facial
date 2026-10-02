export interface FotoDoResultado {
    id_foto: number;
    thumb: string;
    web: string;
    similaridade: number;
}

export interface RespostaResultado {
    evento: { nome: string; slug: string };
    validade_ate: string | null;
    fotos: FotoDoResultado[];
}
