export interface BuscaDeOrigem {
    status: string;
    id_evento: number;
    id_participante: number | null;
    dentroDaValidade: boolean;
}

export interface EntradaStatus {
    idEvento: number;
    qtdFotos: number;
    exigirWhatsapp: boolean;
    idParticipanteAparelho: number | null;
    origem: BuscaDeOrigem | null;
}

export interface DecisaoStatus {
    status: "aguardando" | "liberada";
    idParticipante: number | null;
    precisaCodigo: boolean;
}

// A ordem é a do spec §8 e é o que impede dois furos: pedir verificação a quem não tem
// foto nenhuma, e usar uma busca vazia como atalho para pular a verificação.
export function decidirStatusBusca(entrada: EntradaStatus): DecisaoStatus {
    if (entrada.qtdFotos === 0) return { status: "liberada", idParticipante: null, precisaCodigo: false };
    if (!entrada.exigirWhatsapp) return { status: "liberada", idParticipante: null, precisaCodigo: false };
    if (entrada.idParticipanteAparelho !== null)
        return { status: "liberada", idParticipante: entrada.idParticipanteAparelho, precisaCodigo: false };

    const origem = entrada.origem;
    if (
        origem &&
        origem.status === "liberada" &&
        origem.id_evento === entrada.idEvento &&
        origem.dentroDaValidade &&
        origem.id_participante !== null
    )
        return { status: "liberada", idParticipante: origem.id_participante, precisaCodigo: false };

    return { status: "aguardando", idParticipante: null, precisaCodigo: true };
}
