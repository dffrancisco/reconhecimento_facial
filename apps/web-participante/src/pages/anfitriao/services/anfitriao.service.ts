import { chamar } from "../../../ts/api";
import type { FotoDaGaleria } from "../interfaces";
import type { SituacaoZip } from "../../../ts/zip";

export function getGaleria(chave: string, offset: number): Promise<{ evento: string; fotos: FotoDaGaleria[] }> {
    return chamar("anfitriao", "galeria", { call: "getGaleria", chave, offset });
}

export function pedirZipDoEvento(chave: string): Promise<{ partes: number[]; status: string }> {
    return chamar("anfitriao", "galeria", { call: "pedirZip", chave });
}

export function situacaoZipDoEvento(chave: string, idArquivoZip: number): Promise<SituacaoZip> {
    return chamar("anfitriao", "galeria", { call: "situacaoZip", chave, id_arquivo_zip: idArquivoZip });
}
