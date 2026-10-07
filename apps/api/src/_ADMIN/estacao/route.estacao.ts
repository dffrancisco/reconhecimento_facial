import ConexaoPostgres from "../../db/conexaoPostgres";
import { iContexto, iRota } from "../../services/per";
import { autorizarOperador } from "../../services/auth";
import EstacaoCtrl from "./ctrl.estacao";

export default class Estacao implements iRota {
    conexao = new ConexaoPostgres();
    private ctrl!: EstacaoCtrl;

    constructor(private contexto: iContexto) {}

    async init(): Promise<void> {
        await this.conexao.open();
        await autorizarOperador(this.contexto, this.conexao);
        this.ctrl = new EstacaoCtrl(this.conexao);
    }

    async obterEstacao() {
        return this.ctrl.obterEstacao();
    }
}
