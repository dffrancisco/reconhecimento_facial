export interface ConfigEvento {
    limiar: number;
    exigir_whatsapp: boolean;
    marca_dagua: boolean;
    organizador: string;
    dias_expurgo: number;
    validade_resultado_dias: number | null;
    max_selfies: number;
}

export interface Evento {
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
    links: { participante: string; anfitriao: string } | null;
}

// Campo numérico apagado chega do v-model como "" (o Vue só converte o que é número).
export interface FormDados {
    nome: string;
    data_inicio: string;
    data_fim: string;
    privado: boolean;
    ativo: boolean;
    organizador: string;
    exigir_whatsapp: boolean;
    marca_dagua: boolean;
    limiar: number | "";
    max_selfies: number | "";
    dias_expurgo: number | "";
    validade_resultado_dias: number | "";
}

export interface DadosEdicao {
    nome: string;
    data_inicio: string | null;
    data_fim: string;
    privado: boolean;
    ativo: boolean;
    config: Omit<ConfigEvento, "limiar" | "max_selfies" | "dias_expurgo"> & {
        limiar: number | "";
        max_selfies: number | "";
        dias_expurgo: number | "";
    };
}
