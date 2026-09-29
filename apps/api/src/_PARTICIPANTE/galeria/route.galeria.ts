import { Request } from "express";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { iContexto, iRota } from "../../services/per";
import GaleriaCtrl from "./ctrl.galeria";
import { diaValido } from "./regras";

export default class Galeria implements iRota {
    conexao = new ConexaoPostgres();
    private ctrl!: GaleriaCtrl;

    // A galeria é pública: o evento vem pelo slug ou pela chave de acesso do link.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(private contexto: iContexto) {}

    async init(): Promise<void> {
        await this.conexao.open();
        this.ctrl = new GaleriaCtrl(this.conexao);
    }

    async getEvento(req: Request) {
        const { slug, chave_acesso } = req.body;
        if (!slug && !chave_acesso) return { msg: "Informe o evento (slug ou chave_acesso)", error: true };
        return this.ctrl.getEvento({ slug, chaveAcesso: chave_acesso });
    }

    async getGaleria(req: Request) {
        const { slug, chave_acesso, dia } = req.body;
        if (!slug && !chave_acesso) return { msg: "Informe o evento (slug ou chave_acesso)", error: true };
        if (dia !== undefined && dia !== null && !diaValido(dia)) return { msg: "Dia inválido", error: true };
        const offset = Number.isInteger(Number(req.body.offset)) ? Math.max(0, Number(req.body.offset)) : 0;
        return this.ctrl.getGaleria({ slug, chaveAcesso: chave_acesso }, offset, diaValido(dia) ? dia : null);
    }
}
