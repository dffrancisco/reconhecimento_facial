export interface LinhaOperadorSync {
    id_operador: number;
    nome: string;
    login: string;
    senha_hash: string;
    deletado: "S" | "N";
}

export interface LinhaEventoSync {
    id_evento: number;
    nome: string;
    slug: string;
    tipo: string;
    privado: "S" | "N";
    chave_acesso: string | null;
    chave_anfitriao: string;
    data_inicio: string | null;
    data_fim: string;
    ativo: "S" | "N";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: any;
    marca_dagua_caminho: string | null;
    // mtime do PNG na VPS: é o que diz à estação que a marca mudou.
    marca_dagua_em: string | null;
}

export interface LinhaFotografoSync {
    id_fotografo: number;
    nome: string;
    telefone: string | null;
    deletado: "S" | "N";
}

export interface LinhaVinculoSync {
    id_evento_fotografo: number;
    id_evento: number;
    id_fotografo: number;
    token_upload: string;
    ativo: "S" | "N";
}

export interface PayloadSincronizacao {
    operadores: LinhaOperadorSync[];
    eventos: LinhaEventoSync[];
    fotografos: LinhaFotografoSync[];
    vinculos: LinhaVinculoSync[];
}
