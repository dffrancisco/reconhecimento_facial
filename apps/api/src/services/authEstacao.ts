import { timingSafeEqual } from "node:crypto";
import { iContexto } from "./per";
import { config } from "./config";
import { ErroTratado } from "./erro";

export function autorizarEstacao(contexto: iContexto): void {
    const recebida = Buffer.from(contexto.authorization ?? "");
    const esperada = Buffer.from(config.estacaoChave);
    if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada))
        throw new ErroTratado("Chave da estação inválida.");
}
