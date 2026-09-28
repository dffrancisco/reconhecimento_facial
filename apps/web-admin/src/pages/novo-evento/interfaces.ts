export interface NovoEvento {
    nome: string;
    slug: string;
    tipo: "esportivo" | "social";
    data_inicio: string | null;
    data_fim: string;
    privado: boolean;
    config: { exigir_whatsapp: boolean };
}
