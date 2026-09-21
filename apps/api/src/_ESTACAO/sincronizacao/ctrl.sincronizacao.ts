import ConexaoPostgres from "../../db/conexaoPostgres";
import { PayloadSincronizacao } from "./i.sincronizacao";
import { listarEventosAtivosSync, listarFotografosSync, listarOperadoresSync, listarVinculosSync } from "./sql.sincronizacao";

export default class SincronizacaoCtrl {
    constructor(private conexao: ConexaoPostgres) {}

    async getSincronizacao(): Promise<PayloadSincronizacao> {
        const [operadores, eventosBrutos, fotografos] = await Promise.all([
            listarOperadoresSync(this.conexao),
            listarEventosAtivosSync(this.conexao),
            listarFotografosSync(this.conexao),
        ]);

        const eventos = eventosBrutos.map((evento) => ({
            ...evento,
            marca_dagua_caminho: evento.config?.marca_dagua ? `/api/estacao/marca-dagua/${evento.id_evento}` : null,
        }));
        const vinculos = await listarVinculosSync(this.conexao, eventos.map((e) => e.id_evento));

        return { operadores, eventos, fotografos, vinculos };
    }
}
