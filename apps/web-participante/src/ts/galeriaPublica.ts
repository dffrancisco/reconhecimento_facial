import { chamar } from "./api";

export interface DiaDoEvento {
    dia: string;
    qtd: number;
}

export interface EventoPublico {
    nome: string;
    data_inicio: string | null;
    data_fim: string;
    total_fotos: number;
    dias: DiaDoEvento[];
    // Thumb assinado de uma foto sorteada, para o fundo da home; nulo sem foto publicada.
    capa: string | null;
}

// A galeria pública já traz a versão web assinada, como a do anfitrião: aqui não há
// token de busca para o gerarLinks.
export interface FotoPublica {
    id_foto: number;
    thumb: string;
    web: string;
}

export interface EntradaEvento {
    slug?: string;
    chaveAcesso?: string;
}

function corpo(entrada: EntradaEvento): Record<string, string | undefined> {
    return entrada.chaveAcesso ? { chave_acesso: entrada.chaveAcesso } : { slug: entrada.slug };
}

export function getEvento(entrada: EntradaEvento): Promise<EventoPublico> {
    return chamar("participante", "galeria", { call: "getEvento", ...corpo(entrada) });
}

export function getGaleria(entrada: EntradaEvento, offset: number, dia?: string): Promise<{ fotos: FotoPublica[] }> {
    return chamar("participante", "galeria", { call: "getGaleria", ...corpo(entrada), offset, ...(dia ? { dia } : {}) });
}
