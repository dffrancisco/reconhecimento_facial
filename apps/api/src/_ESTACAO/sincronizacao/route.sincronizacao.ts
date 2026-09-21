import ConexaoPostgres from "../../db/conexaoPostgres";
import { iContexto, iRota } from "../../services/per";
import { autorizarEstacao } from "../../services/authEstacao";
import SincronizacaoCtrl from "./ctrl.sincronizacao";

export default class Sincronizacao implements iRota {
    conexao = new ConexaoPostgres();
    private ctrl!: SincronizacaoCtrl;

    constructor(private contexto: iContexto) {}

    async init(): Promise<void> {
        autorizarEstacao(this.contexto);
        await this.conexao.open();
        this.ctrl = new SincronizacaoCtrl(this.conexao);
    }

    async getSincronizacao() {
        return this.ctrl.getSincronizacao();
    }
}
