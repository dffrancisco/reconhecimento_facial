export interface FotoNaGrade {
    id_foto: number;
    thumb: string;
    similaridade?: number;
}

// Na foto aberta a miniatura dá o formato na hora e a versão web (2048 px) vem por cima.
export interface FotoAbrivel {
    id_foto: number;
    thumb: string;
    web: string;
}

export interface Patrocinador {
    nome: string;
    logo: string;
    site?: string;
}
