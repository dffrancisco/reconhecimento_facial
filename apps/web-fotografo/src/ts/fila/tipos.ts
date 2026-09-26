export type SituacaoItem = "esperando" | "preparando" | "enviando" | "enviado" | "pulado" | "erro";

export interface ItemFila {
    chave: string;
    arquivo: File;
    nome: string;
    tamanho: number;
    situacao: SituacaoItem;
    progresso: number;
    hash?: string;
    idUpload?: number;
    mensagem?: string;
    tentativas: number;
    reenviosPorHash: number;
}

export type RespostaInicio = { situacao: "ja_existe" } | { situacao: "continuar" | "novo"; id_upload: number; bytes_recebidos: number };

export interface ServicosFila {
    calcularHash(arquivo: File): Promise<string>;
    iniciar(e: { nome_arquivo: string; tamanho: number; hash_arquivo: string }): Promise<RespostaInicio>;
    enviarPedaco(e: {
        idUpload: number;
        offset: number;
        pedaco: Blob;
        aoProgredir(bytes: number): void;
    }): Promise<{ bytes_recebidos: number; completo: boolean }>;
    esperar(ms: number): Promise<void>;
    // Chamado a cada mudança de um item: é por aqui que a tela guarda o estado no IndexedDB.
    aoMudar?(item: ItemFila): void;
}

// Os três tipos de falha da spec (§4.2), mais os que a própria fila resolve sozinha.
// "recusada" é a recusa definitiva de uma foto (não é JPEG, grande demais): repetir não muda.
export type TipoFalha = "sem_conexao" | "estacao" | "foto" | "recusada" | "fora_de_ordem" | "hash_diferente";

export class FalhaDeEnvio extends Error {
    // Link desativado ou evento encerrado: diferente do disco cheio, "Continuar" não resolve.
    linkFechado = false;

    constructor(
        public tipo: TipoFalha,
        mensagem: string,
        public bytesRecebidos?: number
    ) {
        super(mensagem);
        this.name = "FalhaDeEnvio";
    }
}
