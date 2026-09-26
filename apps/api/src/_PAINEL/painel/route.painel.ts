import { Request } from "express";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { autorizarOperador } from "../../services/auth";
import { iContexto, iRota } from "../../services/per";
import PainelCtrl from "./ctrl.painel";

export default class Painel implements iRota {
    conexao = new ConexaoPostgres();
    private ctrl!: PainelCtrl;

    constructor(private contexto: iContexto) {}

    async init(): Promise<void> {
        await autorizarOperador(this.contexto);
        await this.conexao.open();
        this.ctrl = new PainelCtrl(this.conexao);
    }

    async getPainel() {
        return this.ctrl.getPainel();
    }

    async reprocessar(req: Request) {
        const idFoto = req.body.id_foto === undefined || req.body.id_foto === null ? null : Number(req.body.id_foto);
        if (idFoto !== null && !Number.isInteger(idFoto)) return { msg: "id_foto inválido", error: true };
        return this.ctrl.reprocessar(idFoto);
    }

    async encerrarEvento(req: Request) {
        const idEvento = Number(req.body.id_evento);
        if (!Number.isInteger(idEvento)) return { msg: "Campo id_evento é obrigatório", error: true };
        return this.ctrl.encerrarEvento(idEvento);
    }
}
