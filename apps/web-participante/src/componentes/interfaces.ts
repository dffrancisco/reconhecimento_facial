export interface FotoNaGrade {
    id_foto: number;
    thumb: string;
    similaridade?: number;
}

export interface Patrocinador {
    nome: string;
    logo: string;
    site?: string;
}
