import ConexaoPostgres from "../db/conexaoPostgres";

export default class Sql {
    constructor(private conexao: ConexaoPostgres) {}

    async getAgora() {
        return this.conexao.queryOneParam<{ agora: Date }>("SELECT now() AS agora", []);
    }
}
