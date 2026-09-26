import { Request } from "express";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { iContexto, iRota } from "../../services/per";
import GaleriaCtrl from "./ctrl.galeria";

export default class Galeria implements iRota {
    conexao = new ConexaoPostgres();
    private ctrl!: GaleriaCtrl;

    // A chave do anfitrião vai no corpo, como o link /#/a/<chave> entrega.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(private contexto: iContexto) {}

    async init(): Promise<void> {
        await this.conexao.open();
        this.ctrl = new GaleriaCtrl(this.conexao);
    }

    async getGaleria(req: Request) {
        if (!req.body.chave) return { msg: "Chave obrigatória", error: true };
        const offset = Number.isInteger(Number(req.body.offset)) ? Math.max(0, Number(req.body.offset)) : 0;
        const idEventoFotografo = req.body.id_evento_fotografo ? Number(req.body.id_evento_fotografo) : null;
        return this.ctrl.getGaleria(String(req.body.chave), offset, idEventoFotografo);
    }

    async pedirZip(req: Request) {
        if (!req.body.chave) return { msg: "Chave obrigatória", error: true };
        return this.ctrl.pedirZip(String(req.body.chave));
    }
}
