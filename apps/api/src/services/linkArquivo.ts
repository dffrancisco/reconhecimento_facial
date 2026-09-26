import { createHash } from "node:crypto";
import { config } from "./config";

// Formato do `secure_link` do nginx: md5 de "$secure_link_expires$uri <SEGREDO>", em base64
// url-safe sem padding. O espaço antes do segredo faz parte da string assinada.
export function assinarUrlArquivo(uri: string, expiraEm: number, segredo: string): string {
    const assinatura = createHash("md5")
        .update(`${expiraEm}${uri} ${segredo}`)
        .digest("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
    return `${uri}?md5=${assinatura}&expires=${expiraEm}`;
}

function expiracao(agora: number): number {
    return Math.floor(agora / 1000) + config.arquivoLinkValidadeS;
}

export function urlDaFoto(idEvento: number, hash: string, tipo: "web" | "thumb" | "previa", agora = Date.now()): string {
    return assinarUrlArquivo(`/arquivos/${idEvento}/${hash}_${tipo}.jpg`, expiracao(agora), config.arquivoSegredo);
}

export function urlDoZip(idEvento: number, idArquivoZip: number, agora = Date.now()): string {
    return assinarUrlArquivo(`/arquivos/zips/${idEvento}/${idArquivoZip}.zip`, expiracao(agora), config.arquivoSegredo);
}
