import type { FotoNaGrade } from "../../componentes/interfaces";

// O resultado sempre traz a semelhança; a grade aceita sem.
export type FotoDoResultado = FotoNaGrade & { similaridade: number };

export interface RespostaResultado {
    evento: { nome: string; slug: string };
    validade_ate: string | null;
    fotos: FotoDoResultado[];
}
