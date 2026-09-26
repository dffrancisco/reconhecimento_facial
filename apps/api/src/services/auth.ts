import { iContexto } from "./per";
import { conferirToken } from "./token";
import { config } from "./config";
import { ErroTratado } from "./erro";

// A estação não exige OPERADOR_SEGREDO para subir; sem ele, uma sessão assinada com o segredo
// vazio seria forjável por qualquer um que alcance a estação pelo túnel.
export function exigirSegredoOperador(): void {
    if (config.operadorSegredo.length < 32)
        throw new ErroTratado("O painel não está configurado nesta estação: falta OPERADOR_SEGREDO com pelo menos 32 caracteres.");
}

export async function autorizarOperador(contexto: iContexto): Promise<number> {
    exigirSegredoOperador();
    const idOperador = contexto.authorization ? conferirToken(contexto.authorization, config.operadorSegredo) : null;
    if (idOperador === null) throw new ErroTratado("Sessão expirada, faça login novamente.", "sessao_expirada");
    return idOperador;
}
