import ConexaoPostgres from "../../db/conexaoPostgres";
import { inserirSinal } from "./sql.sinal";

export default class SinalCtrl {
    constructor(private conexao: ConexaoPostgres) {}

    async registrarSinal(dados: unknown): Promise<{ ok: true }> {
        await inserirSinal(this.conexao, dados);
        return { ok: true };
    }
}
