import { NextFunction, Request, Response } from "express";
import per, { iContexto } from "../services/per";
import ConexaoPostgres from "../db/conexaoPostgres";
import Ctrl from "./ctrl._template";

class Router {
    conexao: ConexaoPostgres;
    private ctrl: Ctrl;

    constructor(private contexto: iContexto) {
        this.conexao = new ConexaoPostgres();
        this.ctrl = new Ctrl(this.conexao);
    }

    async init() {
        await this.conexao.open();
    }

    async getAgora(_req: Request) {
        return this.ctrl.getAgora();
    }

    async ecoar(req: Request) {
        const { texto } = req.body;
        if (!texto) return { msg: "texto é obrigatório", error: true };
        return this.ctrl.ecoar(texto);
    }
}

export default (req: Request, res: Response, next: NextFunction) => per(req, res, next, Router);
