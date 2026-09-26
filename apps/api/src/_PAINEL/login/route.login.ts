import { Request } from "express";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { exigirSegredoOperador } from "../../services/auth";
import { config } from "../../services/config";
import { ErroTratado } from "../../services/erro";
import { contarNaJanela, ipDoPedido } from "../../services/limiteTaxa";
import { iContexto, iRota } from "../../services/per";
import LoginCtrl from "../../_ADMIN/login/ctrl.login";

const TENTATIVAS_POR_JANELA = 10;
const JANELA_S = 600;

export default class Login implements iRota {
    conexao = new ConexaoPostgres();
    private ctrl!: LoginCtrl;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(private contexto: iContexto) {}

    async init(): Promise<void> {
        await this.conexao.open();
        // Mesmo login e mesma senha do admin: os operadores chegam do VPS pela sincronização.
        this.ctrl = new LoginCtrl(this.conexao);
    }

    async login(req: Request) {
        const { login, senha } = req.body;
        if (!login || !senha) return { msg: "Campos login e senha são obrigatórios", error: true };
        exigirSegredoOperador();

        // O túnel deixa a estação na internet: sem teto, dá para tentar senhas sem parar.
        const ip = ipDoPedido(req.headers as Record<string, unknown>, req.ip, config.confiarCloudflare);
        if ((await contarNaJanela(`painel-login:${ip}`, JANELA_S)) > TENTATIVAS_POR_JANELA)
            throw new ErroTratado("Muitas tentativas. Espere alguns minutos.");

        const { token, nome } = await this.ctrl.login(String(login), String(senha));
        return { token, nome };
    }
}
