import type { FotoNaGrade } from "../../componentes/interfaces";

// A galeria já traz a versão web assinada: quem tem a chave do anfitrião vê o evento inteiro.
export type FotoDaGaleria = FotoNaGrade & { web: string };
