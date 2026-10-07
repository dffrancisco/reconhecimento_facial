import ConexaoPostgres from "../../db/conexaoPostgres";
import { conferirSenha, gerarHashSenha, versaoDaSenha } from "../../services/senha";
import { gerarToken } from "../../services/token";
import { config } from "../../services/config";
import { ErroTratado } from "../../services/erro";
import { normalizarLogin } from "../operador/regras";
import { buscarOperadorPorLogin, LinhaOperador } from "./sql.login";

let hashDummy: string | undefined;

async function hashParaComparar(operador: LinhaOperador | undefined): Promise<string> {
    // Sempre roda o scrypt, mesmo quando o login não existe — senão o tempo de resposta
    // denuncia quais logins existem, mesmo com a mensagem de erro igual.
    if (operador) return operador.senha_hash;
    if (!hashDummy) hashDummy = await gerarHashSenha("login-inexistente-nao-e-uma-senha-real");
    return hashDummy;
}

export default class LoginCtrl {
    constructor(private conexao: ConexaoPostgres) {}

    async login(login: string, senha: string): Promise<{ token: string; id_operador: number; nome: string }> {
        const operador = await buscarOperadorPorLogin(this.conexao, normalizarLogin(login));
        const ok = await conferirSenha(senha, await hashParaComparar(operador));
        // Mesma mensagem para login inexistente e senha errada: não revela quais logins existem.
        if (!operador || !ok) throw new ErroTratado("Login ou senha inválidos.");

        return {
            token: gerarToken(operador.id_operador, config.operadorSegredo, versaoDaSenha(operador.senha_hash)),
            id_operador: operador.id_operador,
            nome: operador.nome,
        };
    }
}
