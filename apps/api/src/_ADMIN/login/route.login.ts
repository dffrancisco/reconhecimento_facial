import { Request } from "express";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { config } from "../../services/config";
import { ErroTratado } from "../../services/erro";
import { contarNaJanela, ipDoPedido } from "../../services/limiteTaxa";
import { iContexto, iRota } from "../../services/per";
import LoginCtrl from "./ctrl.login";

const TENTATIVAS_POR_JANELA = 10;
const JANELA_S = 600;

export default class Login implements iRota {
    conexao = new ConexaoPostgres();
    private ctrl!: LoginCtrl;

    constructor(private contexto: iContexto) {}

    async init(): Promise<void> {
        await this.conexao.open();
        this.ctrl = new LoginCtrl(this.conexao);
    }

    async login(req: Request) {
        const { login, senha } = req.body;
        if (!login || !senha) return { msg: "Campos login e senha são obrigatórios", error: true };

        // Com a tela do admin na internet, sem teto dá para tentar senhas sem parar.
        const ip = ipDoPedido(req.headers as Record<string, unknown>, req.ip, config.confiarCloudflare);
        if ((await contarNaJanela(`admin-login:${ip}`, JANELA_S)) > TENTATIVAS_POR_JANELA)
            throw new ErroTratado("Muitas tentativas. Espere alguns minutos.");

        return this.ctrl.login(String(login), String(senha));
    }
}
