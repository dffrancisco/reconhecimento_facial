import ConexaoPostgres from "../../db/conexaoPostgres";
import { conferirSenha } from "../../services/senha";
import { gerarToken } from "../../services/token";
import { config } from "../../services/config";
import { ErroTratado } from "../../services/erro";
import { buscarOperadorPorLogin } from "./sql.login";

export default class LoginCtrl {
    constructor(private conexao: ConexaoPostgres) {}

    async login(login: string, senha: string): Promise<{ token: string; id_operador: number; nome: string }> {
        const operador = await buscarOperadorPorLogin(this.conexao, login);
        // Mesma mensagem para login inexistente e senha errada: não revela quais logins existem.
        if (!operador || !(await conferirSenha(senha, operador.senha_hash)))
            throw new ErroTratado("Login ou senha inválidos.");

        return { token: gerarToken(operador.id_operador, config.operadorSegredo), id_operador: operador.id_operador, nome: operador.nome };
    }
}
