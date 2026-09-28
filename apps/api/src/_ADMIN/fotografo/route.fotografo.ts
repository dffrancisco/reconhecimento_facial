import { Request } from "express";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { iContexto, iRota } from "../../services/per";
import { autorizarOperador } from "../../services/auth";
import FotografoCtrl from "./ctrl.fotografo";

export default class Fotografo implements iRota {
    conexao = new ConexaoPostgres();
    private ctrl!: FotografoCtrl;

    constructor(private contexto: iContexto) {}

    async init(): Promise<void> {
        await autorizarOperador(this.contexto);
        await this.conexao.open();
        this.ctrl = new FotografoCtrl(this.conexao);
    }

    async criarFotografo(req: Request) {
        if (!req.body.nome) return { msg: "Campo nome é obrigatório", error: true };
        return this.ctrl.criarFotografo({ nome: req.body.nome, telefone: req.body.telefone || null });
    }

    async listarFotografos() {
        return this.ctrl.listarFotografos();
    }

    async vincularFotografo(req: Request) {
        const { id_evento, id_fotografo } = req.body;
        if (!id_evento || !id_fotografo) return { msg: "Campos id_evento e id_fotografo são obrigatórios", error: true };
        return this.ctrl.vincularFotografo(Number(id_evento), Number(id_fotografo));
    }

    async listarVinculos(req: Request) {
        if (!req.body.id_evento) return { msg: "Campo id_evento é obrigatório", error: true };
        return this.ctrl.listarVinculos(Number(req.body.id_evento));
    }

    async desvincularFotografo(req: Request) {
        if (!req.body.id_evento_fotografo) return { msg: "Campo id_evento_fotografo é obrigatório", error: true };
        return this.ctrl.desvincularFotografo(Number(req.body.id_evento_fotografo));
    }
}
