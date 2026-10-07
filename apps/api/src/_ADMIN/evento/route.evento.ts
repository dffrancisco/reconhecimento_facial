import { Request } from "express";
import { UploadedFile } from "express-fileupload";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { iContexto, iRota } from "../../services/per";
import { autorizarOperador } from "../../services/auth";
import EventoCtrl from "./ctrl.evento";

export default class Evento implements iRota {
    conexao = new ConexaoPostgres();
    private ctrl!: EventoCtrl;
    private idOperador!: number;

    constructor(private contexto: iContexto) {}

    async init(): Promise<void> {
        await this.conexao.open();
        this.idOperador = await autorizarOperador(this.contexto, this.conexao);
        this.ctrl = new EventoCtrl(this.conexao);
    }

    async criarEvento(req: Request) {
        const { nome, slug, tipo, data_fim } = req.body;
        if (!nome || !slug || !tipo || !data_fim) return { msg: "Campos nome, slug, tipo e data_fim são obrigatórios", error: true };
        return this.ctrl.criarEvento(req.body);
    }

    async listarEventos() {
        return this.ctrl.listarEventos();
    }

    async obterEvento(req: Request) {
        if (!req.body.id_evento) return { msg: "Campo id_evento é obrigatório", error: true };
        return this.ctrl.obterEvento(Number(req.body.id_evento));
    }

    async editarEvento(req: Request) {
        if (!req.body.id_evento) return { msg: "Campo id_evento é obrigatório", error: true };
        return this.ctrl.editarEvento({ ...req.body, id_evento: Number(req.body.id_evento) });
    }

    async subirMarcaDagua(req: Request) {
        const arquivo = req.files?.logo as UploadedFile | undefined;
        if (!req.body.id_evento || !arquivo) return { msg: "Campos id_evento e logo são obrigatórios", error: true };
        return this.ctrl.subirMarcaDagua(Number(req.body.id_evento), { data: arquivo.data, mimetype: arquivo.mimetype, size: arquivo.size });
    }

    async excluirEvento(req: Request) {
        const { id_evento, nome_confirmacao } = req.body;
        if (!id_evento || !nome_confirmacao) return { msg: "Campos id_evento e nome_confirmacao são obrigatórios", error: true };
        return this.ctrl.excluirEvento(Number(id_evento), nome_confirmacao, this.idOperador);
    }
}
