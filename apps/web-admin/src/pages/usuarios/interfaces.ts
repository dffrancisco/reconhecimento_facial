export interface Usuario {
    id_operador: number;
    nome: string;
    login: string;
    criado_em: string;
}

export type Janela =
    | { tipo: "novo" }
    | { tipo: "alterar"; usuario: Usuario }
    | { tipo: "senha"; usuario: Usuario }
    | { tipo: "excluir"; usuario: Usuario };
