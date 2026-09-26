export interface RostoParecido {
    id_foto: number;
    id_rosto: number;
    similaridade: number;
}

export type FotoEncontrada = RostoParecido;

export interface RespostaBusca {
    token: string;
    status: "aguardando" | "liberada";
    qtd_fotos: number;
    previas: string[];
    codigo?: string;
}
