import { Request } from "express";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { iContexto, iRota } from "../../services/per";
import { autorizarOperador } from "../../services/auth";
import OperadorCtrl from "./ctrl.operador";

export default class Operador implements iRota {
    conexao = new ConexaoPostgres();
    private ctrl!: OperadorCtrl;

    constructor(private contexto: iContexto) {}

    // Em transação: a exclusão trava os ativos (FOR UPDATE) até gravar.
    async init(): Promise<void> {
        await this.conexao.openTransaction();
        const idOperador = await autorizarOperador(this.contexto, this.conexao);
        this.ctrl = new OperadorCtrl(this.conexao, idOperador);
    }

    async listarOperadores() {
        return this.ctrl.listarOperadores();
    }

    async criarOperador(req: Request) {
        const { nome, login, senha } = req.body;
        if (!nome || !login || !senha) return { msg: "Campos nome, login e senha são obrigatórios", error: true };
        return this.ctrl.criarOperador({ nome, login, senha });
    }

    async alterarOperador(req: Request) {
        const { id_operador, nome, login } = req.body;
        if (!id_operador || !nome || !login) return { msg: "Campos id_operador, nome e login são obrigatórios", error: true };
        return this.ctrl.alterarOperador(Number(id_operador), { nome, login });
    }

    async trocarSenha(req: Request) {
        const { id_operador, senha } = req.body;
        if (!id_operador || !senha) return { msg: "Campos id_operador e senha são obrigatórios", error: true };
        return this.ctrl.trocarSenha(Number(id_operador), senha);
    }

    async excluirOperador(req: Request) {
        if (!req.body.id_operador) return { msg: "Campo id_operador é obrigatório", error: true };
        return this.ctrl.excluirOperador(Number(req.body.id_operador));
    }
}
