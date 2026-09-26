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

    async getPainel() {
        return this.ctrl.getPainel();
    }
}
