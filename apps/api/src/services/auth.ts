import ConexaoPostgres from "../db/conexaoPostgres";
import { buscarOperadorAtivo } from "../_ADMIN/login/sql.login";
import { iContexto } from "./per";
import { conferirToken } from "./token";
import { config } from "./config";
import { ErroTratado } from "./erro";
import { versaoDaSenha } from "./senha";

// A estação não exige OPERADOR_SEGREDO para subir; sem ele, uma sessão assinada com o segredo
// vazio seria forjável por qualquer um que alcance a estação pelo túnel.
export function exigirSegredoOperador(): void {
    if (config.operadorSegredo.length < 32)
        throw new ErroTratado("O painel não está configurado nesta estação: falta OPERADOR_SEGREDO com pelo menos 32 caracteres.");
}

// A assinatura sozinha não basta: o token de quem foi excluído, ou de antes da troca de senha,
// segue bem assinado até vencer. Por isso o operador é conferido no banco a cada chamada.
export async function autorizarOperador(contexto: iContexto, conexao: ConexaoPostgres): Promise<number> {
    exigirSegredoOperador();
    const sessao = contexto.authorization ? conferirToken(contexto.authorization, config.operadorSegredo) : null;
    const operador = sessao ? await buscarOperadorAtivo(conexao, sessao.id_operador) : undefined;
    if (!sessao || !operador || versaoDaSenha(operador.senha_hash) !== sessao.versao)
        throw new ErroTratado("Sessão expirada, faça login novamente.", "sessao_expirada");
    return sessao.id_operador;
}
