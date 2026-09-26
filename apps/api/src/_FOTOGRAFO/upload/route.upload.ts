import { Request } from "express";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { iContexto, iRota } from "../../services/per";
import UploadCtrl from "./ctrl.upload";

export default class Upload implements iRota {
    conexao = new ConexaoPostgres();
    private ctrl!: UploadCtrl;

    // Público: o `token` do link de upload, conferido em cada chamada, é a credencial.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(private contexto: iContexto) {}

    async init(): Promise<void> {
        await this.conexao.open();
        this.ctrl = new UploadCtrl(this.conexao);
    }

    async getSessao(req: Request) {
        if (!req.body.token) return { msg: "Token obrigatório", error: true };
        return this.ctrl.getSessao(req.body.token);
    }

    async iniciarUpload(req: Request) {
        const { token, nome_arquivo, tamanho, hash_arquivo } = req.body;
        if (!token || !nome_arquivo || tamanho === undefined || !hash_arquivo)
            return { msg: "Campos token, nome_arquivo, tamanho e hash_arquivo são obrigatórios", error: true };
        return this.ctrl.iniciarUpload(token, { nome_arquivo, tamanho, hash_arquivo });
    }

    async statusUpload(req: Request) {
        if (!req.body.token) return { msg: "Token obrigatório", error: true };
        return this.ctrl.statusUpload(req.body.token);
    }
}
