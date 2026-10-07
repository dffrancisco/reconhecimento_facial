import ConexaoPostgres from "../../db/conexaoPostgres";
import { config } from "../../services/config";
import { ErroTratado } from "../../services/erro";
import { gerarHashSenha, versaoDaSenha } from "../../services/senha";
import { gerarToken } from "../../services/token";
import { normalizarLogin, validarLogin, validarNome, validarSenha } from "./regras";
import {
    alterarOperadorSql,
    buscarPorLogin,
    excluirOperadorSql,
    inserirOperador,
    LinhaOperadorLista,
    listarOperadoresSql,
    reativarOperador,
    travarAtivos,
    trocarSenhaSql,
} from "./sql.operador";

const LOGIN_REPETIDO = "Esse login já é de outro usuário.";
const NAO_ENCONTRADO = "Usuário não encontrado.";

function conferir(...erros: (string | null)[]): void {
    const erro = erros.find((e) => e !== null);
    if (erro) throw new ErroTratado(erro);
}

export default class OperadorCtrl {
    constructor(
        private conexao: ConexaoPostgres,
        private idOperadorLogado: number
    ) {}

    async listarOperadores(): Promise<LinhaOperadorLista[]> {
        return listarOperadoresSql(this.conexao);
    }

    async criarOperador(dados: { nome: unknown; login: unknown; senha: unknown }): Promise<{ id_operador: number }> {
        conferir(validarNome(dados.nome), validarLogin(dados.login), validarSenha(dados.senha));
        const nome = String(dados.nome).trim();
        const login = normalizarLogin(String(dados.login));
        const senhaHash = await gerarHashSenha(String(dados.senha));

        const existente = await buscarPorLogin(this.conexao, login);
        if (existente?.deletado === "N") throw new ErroTratado(LOGIN_REPETIDO);
        // O login é único na tabela inteira: o de alguém excluído só volta trazendo aquele cadastro.
        if (existente) {
            await reativarOperador(this.conexao, existente.id_operador, nome, senhaHash);
            return { id_operador: existente.id_operador };
        }
        return inserirOperador(this.conexao, nome, login, senhaHash);
    }

    async alterarOperador(idOperador: number, dados: { nome: unknown; login: unknown }): Promise<{ ok: true }> {
        conferir(validarNome(dados.nome), validarLogin(dados.login));
        const login = normalizarLogin(String(dados.login));

        const dono = await buscarPorLogin(this.conexao, login);
        if (dono && dono.id_operador !== idOperador) throw new ErroTratado(LOGIN_REPETIDO);
        if ((await alterarOperadorSql(this.conexao, idOperador, String(dados.nome).trim(), login)) === 0) throw new ErroTratado(NAO_ENCONTRADO);
        return { ok: true };
    }

    // A senha nova muda a versão que vai no token: as sessões abertas com a antiga caem. Quem
    // trocou a própria recebe uma sessão nova, para não ser jogado para fora da tela.
    async trocarSenha(idOperador: number, senha: unknown): Promise<{ ok: true; token?: string }> {
        conferir(validarSenha(senha));
        const senhaHash = await gerarHashSenha(String(senha));
        if ((await trocarSenhaSql(this.conexao, idOperador, senhaHash)) === 0) throw new ErroTratado(NAO_ENCONTRADO);

        if (idOperador !== this.idOperadorLogado) return { ok: true };
        return { ok: true, token: gerarToken(idOperador, config.operadorSegredo, versaoDaSenha(senhaHash)) };
    }

    async excluirOperador(idOperador: number): Promise<{ ok: true }> {
        if (idOperador === this.idOperadorLogado) throw new ErroTratado("Você não pode excluir a si mesmo.");

        const ativos = await travarAtivos(this.conexao);
        if (!ativos.includes(idOperador)) throw new ErroTratado(NAO_ENCONTRADO);
        if (ativos.length <= 1) throw new ErroTratado("Precisa sobrar pelo menos um usuário.");

        await excluirOperadorSql(this.conexao, idOperador);
        return { ok: true };
    }
}
