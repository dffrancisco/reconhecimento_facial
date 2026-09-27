export interface EventoAberto {
    id_evento: number;
    nome: string;
    data_inicio: string | null;
    data_fim: string;
}

// Fotógrafos seguem mandando fotos nos dias depois da prova.
const DIAS_DEPOIS_DO_FIM = 3;

function somarDias(data: string, dias: number): string {
    const d = new Date(`${data}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
}

// A sincronização traz para a estação todos os eventos ativos, inclusive os cadastrados com
// antecedência: "em andamento" é o que está acontecendo hoje, pelas datas, e não o que chegou
// por último. A escolha do operador vale enquanto o evento estiver aberto.
export function escolherEvento(abertos: EventoAberto[], hoje: string, preferido: number | null): EventoAberto | null {
    const escolhido = preferido === null ? undefined : abertos.find((e) => e.id_evento === preferido);
    if (escolhido) return escolhido;

    const acontecendo = abertos
        .map((e) => ({ e, inicio: e.data_inicio ?? e.data_fim }))
        .filter(({ e, inicio }) => inicio <= hoje && hoje <= somarDias(e.data_fim, DIAS_DEPOIS_DO_FIM));
    acontecendo.sort((a, b) => (a.inicio === b.inicio ? b.e.id_evento - a.e.id_evento : a.inicio < b.inicio ? 1 : -1));
    return acontecendo[0]?.e ?? null;
}
