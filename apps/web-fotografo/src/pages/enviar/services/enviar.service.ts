import { chamar } from "../../../ts/api";
import type { RespostaInicio } from "../../../ts/fila/tipos";
import { falhaDoPedaco } from "./traducao";

export interface Sessao {
    evento: { nome: string };
    fotografo: { nome: string };
    pedaco_bytes: number;
}

export interface SituacaoEstacao {
    enviadas: number;
    processando: number;
    prontas: number;
    com_erro: number;
    erros: { nome_arquivo: string; mensagem: string }[];
}

export function getSessao(token: string): Promise<Sessao> {
    return chamar("fotografo", "upload", { call: "getSessao", token });
}

export function iniciarUpload(token: string, e: { nome_arquivo: string; tamanho: number; hash_arquivo: string }): Promise<RespostaInicio> {
    return chamar("fotografo", "upload", { call: "iniciarUpload", token, ...e });
}

export function statusUpload(token: string): Promise<SituacaoEstacao> {
    return chamar("fotografo", "upload", { call: "statusUpload", token });
}

// XHR e não fetch: só o XHR informa o progresso do envio, e é ele que faz a barra da foto
// andar de forma contínua dentro de um pedaço de 8 MB.
export function enviarPedaco(
    token: string,
    e: { idUpload: number; offset: number; pedaco: Blob; aoProgredir(bytes: number): void }
): Promise<{ bytes_recebidos: number; completo: boolean }> {
    return new Promise((ok, falha) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", `/api/fotografo/upload/${e.idUpload}`);
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.setRequestHeader("X-Token-Upload", token);
        xhr.setRequestHeader("Upload-Offset", String(e.offset));
        xhr.timeout = 120_000;
        xhr.upload.onprogress = (evento) => e.aoProgredir(evento.loaded);
        xhr.onload = () => {
            let corpo: unknown = null;
            try {
                corpo = JSON.parse(xhr.responseText);
            } catch {
                corpo = xhr.responseText;
            }
            if (xhr.status === 200) ok(corpo as { bytes_recebidos: number; completo: boolean });
            else falha(falhaDoPedaco(xhr.status, corpo));
        };
        xhr.onerror = () => falha(falhaDoPedaco(0, null));
        xhr.ontimeout = () => falha(falhaDoPedaco(0, null));
        xhr.send(e.pedaco);
    });
}
