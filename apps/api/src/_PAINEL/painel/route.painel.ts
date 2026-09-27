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

    async getPainel(req: Request) {
        const idEvento = req.body.id_evento === undefined || req.body.id_evento === null ? null : Number(req.body.id_evento);
        return this.ctrl.getPainel(Number.isInteger(idEvento) ? idEvento : null);
    }

    async reprocessar(req: Request) {
        const { id_foto, id_evento } = req.body;
        if (Number.isInteger(Number(id_foto)) && id_foto !== undefined && id_foto !== null) return this.ctrl.reprocessar({ idFoto: Number(id_foto) });
        if (Number.isInteger(Number(id_evento)) && id_evento !== undefined && id_evento !== null)
            return this.ctrl.reprocessar({ idEvento: Number(id_evento) });
        return { msg: "Informe id_foto ou id_evento", error: true };
    }

    async encerrarEvento(req: Request) {
        const idEvento = Number(req.body.id_evento);
        if (!Number.isInteger(idEvento)) return { msg: "Campo id_evento é obrigatório", error: true };
        return this.ctrl.encerrarEvento(idEvento);
    }
}
