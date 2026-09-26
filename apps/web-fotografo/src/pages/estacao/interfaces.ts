export interface RespostaPainel {
    evento: null | { id_evento: number; nome: string; desde: string };
    metricas: {
        fotos_min: number;
        latencia_p50_ms: number;
        latencia_p95_ms: number;
        taxa_erro: number;
        gpu: { utilizacao: number; vram_usada_mb: number; vram_total_mb: number } | null;
    };
    fila: { recebidas: number; rostos: number; derivados: number; esperando_publicar: number };
    vps: { ultima_sincronizacao: string | null };
    enderecos: { lan: string | null; tunel: string | null };
    fotografos: { id_evento_fotografo: number; nome: string; token_upload: string; enviadas: number; prontas: number; com_erro: number }[];
    erros: { id_foto: number; nome_arquivo: string; fotografo: string | null; etapa: string | null; erro: string; tem_arquivo: boolean }[];
    em_processamento: number;
}
