import { Request } from "express";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { iContexto, iRota } from "../../services/per";
import ResultadoCtrl from "./ctrl.resultado";

export default class Resultado implements iRota {
    conexao = new ConexaoPostgres();
    private ctrl!: ResultadoCtrl;

    // O token da busca é a credencial: quem tem o link vê o resultado dele.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(private contexto: iContexto) {}

    async init(): Promise<void> {
        await this.conexao.open();
        this.ctrl = new ResultadoCtrl(this.conexao);
    }

    async getResultado(req: Request) {
        if (!req.body.token) return { msg: "Token obrigatório", error: true };
        return this.ctrl.getResultado(String(req.body.token));
    }

    async situacao(req: Request) {
        if (!req.body.token) return { msg: "Token obrigatório", error: true };
        return this.ctrl.situacao(String(req.body.token));
    }

    async gerarLinks(req: Request) {
        if (!req.body.token) return { msg: "Token obrigatório", error: true };
        const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
        if (ids.length === 0) return { msg: "Escolha ao menos uma foto", error: true };
        return this.ctrl.gerarLinks(String(req.body.token), ids);
    }
}
