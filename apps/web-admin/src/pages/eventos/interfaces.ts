export interface EventoDaLista {
    id_evento: number;
    nome: string;
    slug: string;
    tipo: "esportivo" | "social";
    privado: "S" | "N";
    data_inicio: string | null;
    data_fim: string;
    ativo: "S" | "N";
}
