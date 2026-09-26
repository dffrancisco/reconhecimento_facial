import { Request } from "express";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { iContexto, iRota } from "../../services/per";
import { autorizarEstacao } from "../../services/authEstacao";
import SinalCtrl from "./ctrl.sinal";

export default class Sinal implements iRota {
    conexao = new ConexaoPostgres();
    private ctrl!: SinalCtrl;

    constructor(private contexto: iContexto) {}

    async init(): Promise<void> {
        autorizarEstacao(this.contexto);
        await this.conexao.open();
        this.ctrl = new SinalCtrl(this.conexao);
    }

    async registrarSinal(req: Request) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { call, ...dados } = req.body;
        return this.ctrl.registrarSinal(dados);
    }
}
