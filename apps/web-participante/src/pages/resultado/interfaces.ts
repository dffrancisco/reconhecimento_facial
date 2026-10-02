import type { FotoNaGrade } from "../../componentes/interfaces";

// O resultado sempre traz a semelhança (a grade aceita sem) e a versão web, que a foto
// aberta mostra; o download continua pelo gerarLinks, que conta.
export type FotoDoResultado = FotoNaGrade & { similaridade: number; web: string };

export interface RespostaResultado {
    evento: { nome: string; slug: string };
    validade_ate: string | null;
    fotos: FotoDoResultado[];
}
