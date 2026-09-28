export interface ConfigEvento {
    limiar: number;
    exigir_whatsapp: boolean;
    marca_dagua: boolean;
    organizador: string;
    dias_expurgo: number;
    validade_resultado_dias: number | null;
    max_selfies: number;
}

export interface LinhaEvento {
    id_evento: number;
    nome: string;
    slug: string;
    tipo: "esportivo" | "social";
    privado: "S" | "N";
    chave_acesso: string | null;
    chave_anfitriao: string;
    data_inicio: string | null;
    data_fim: string;
    ativo: "S" | "N";
    config: ConfigEvento;
    criado_em: string;
}

export interface LinksEvento {
    participante: string;
    anfitriao: string;
}
