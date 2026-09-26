export interface RostoPublicar {
    embedding: number[];
    bbox: number[];
    det_score: number;
    area_px: number;
}

export interface DadosPublicarFoto {
    id_evento: number;
    id_evento_fotografo: number | null;
    hash_arquivo: string;
    largura: number;
    altura: number;
    bytes_web: number;
    capturada_em: string | null;
    camera: string | null;
    rostos: RostoPublicar[];
}
