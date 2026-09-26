import { Request } from "express";
import { UploadedFile } from "express-fileupload";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { iContexto, iRota } from "../../services/per";
import { autorizarEstacao } from "../../services/authEstacao";
import FotoCtrl from "./ctrl.foto";
import { DadosPublicarFoto } from "./i.foto";

export default class Foto implements iRota {
    conexao = new ConexaoPostgres();
    private ctrl!: FotoCtrl;

    constructor(private contexto: iContexto) {}

    async init(): Promise<void> {
        autorizarEstacao(this.contexto);
        // Transação: upsert de `foto` e a troca dos `rosto` precisam ser atômicos.
        await this.conexao.openTransaction();
        this.ctrl = new FotoCtrl(this.conexao);
    }

    async publicarFoto(req: Request) {
        const web = req.files?.web as UploadedFile | undefined;
        const thumb = req.files?.thumb as UploadedFile | undefined;
        const previa = req.files?.previa as UploadedFile | undefined;
        if (!req.body.dados || !web || !thumb || !previa)
            return { msg: "Campos dados, web, thumb e previa são obrigatórios", error: true };

        const dados = JSON.parse(req.body.dados) as DadosPublicarFoto;
        return this.ctrl.publicarFoto(dados, { web: web.data, thumb: thumb.data, previa: previa.data });
    }
}
