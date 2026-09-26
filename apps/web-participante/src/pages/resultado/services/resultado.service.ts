import { chamar } from "../../../ts/api";
import type { RespostaResultado } from "../interfaces";

export function getResultado(token: string): Promise<RespostaResultado> {
    return chamar<RespostaResultado>("participante", "resultado", { call: "getResultado", token });
}

export function gerarLinks(token: string, ids: number[]): Promise<{ links: { id_foto: number; url: string }[] }> {
    return chamar("participante", "resultado", { call: "gerarLinks", token, ids });
}

export function pedirZip(token: string): Promise<{ partes: number[]; status: string }> {
    return chamar("participante", "resultado", { call: "pedirZip", token });
}

export function situacaoZip(token: string, idArquivoZip: number): Promise<{ status: string; url?: string }> {
    return chamar("participante", "resultado", { call: "situacaoZip", token, id_arquivo_zip: idArquivoZip });
}
