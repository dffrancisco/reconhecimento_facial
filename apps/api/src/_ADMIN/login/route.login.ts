import { Request } from "express";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { iContexto, iRota } from "../../services/per";
import LoginCtrl from "./ctrl.login";

export default class Login implements iRota {
    conexao = new ConexaoPostgres();
    private ctrl!: LoginCtrl;

    constructor(private contexto: iContexto) {}

    async init(): Promise<void> {
        await this.conexao.open();
        this.ctrl = new LoginCtrl(this.conexao);
    }

    async login(req: Request) {
        const { login, senha } = req.body;
        if (!login || !senha) return { msg: "Campos login e senha são obrigatórios", error: true };
        return this.ctrl.login(login, senha);
    }
}
