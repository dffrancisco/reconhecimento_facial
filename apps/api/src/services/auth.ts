import { iContexto } from "./per";
import { conferirToken } from "./token";
import { config } from "./config";
import { ErroTratado } from "./erro";

export async function autorizarOperador(contexto: iContexto): Promise<number> {
    const idOperador = contexto.authorization ? conferirToken(contexto.authorization, config.operadorSegredo) : null;
    if (idOperador === null) throw new ErroTratado("Sessão expirada, faça login novamente.");
    return idOperador;
}
