import ConexaoPostgres from "../db/conexaoPostgres";
import Sql from "./sql._template";
import { iEco } from "./i._template";

export default class Ctrl {
    private sql: Sql;

    constructor(conexao: ConexaoPostgres) {
        this.sql = new Sql(conexao);
    }

    async getAgora() {
        return this.sql.getAgora();
    }

    async ecoar(texto: string): Promise<iEco | { msg: string; error: true }> {
        if (texto.length > 100) return { msg: "O texto deve ter no máximo 100 caracteres", error: true };
        return { texto: texto.toUpperCase() };
    }
}
