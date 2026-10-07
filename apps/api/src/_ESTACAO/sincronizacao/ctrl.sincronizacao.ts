import fs from "node:fs/promises";
import path from "node:path";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { config } from "../../services/config";
import { PayloadSincronizacao } from "./i.sincronizacao";
import { listarEventosExcluidos, listarEventosParaEstacao, listarFotografosSync, listarOperadoresSync, listarVinculosSync } from "./sql.sincronizacao";

// A estação usa este mtime para saber que o PNG mudou e baixar de novo.
async function mtimeDaMarca(idEvento: number): Promise<string | null> {
    try {
        const info = await fs.stat(path.join(config.raizMarcas, `${idEvento}.png`));
        return info.mtime.toISOString();
    } catch {
        return null;
    }
}

export default class SincronizacaoCtrl {
    constructor(private conexao: ConexaoPostgres) {}

    async getSincronizacao(): Promise<Required<PayloadSincronizacao>> {
        const [operadores, eventosBrutos, fotografos, eventos_excluidos] = await Promise.all([
            listarOperadoresSync(this.conexao),
            listarEventosParaEstacao(this.conexao),
            listarFotografosSync(this.conexao),
            listarEventosExcluidos(this.conexao),
        ]);

        const eventos = await Promise.all(
            eventosBrutos.map(async (evento) => ({
                ...evento,
                marca_dagua_caminho: evento.config?.marca_dagua ? `/api/estacao/marca-dagua/${evento.id_evento}` : null,
                marca_dagua_em: evento.config?.marca_dagua ? await mtimeDaMarca(evento.id_evento) : null,
            }))
        );
        const vinculos = await listarVinculosSync(this.conexao, eventos.map((e) => e.id_evento));

        return { operadores, eventos, fotografos, vinculos, eventos_excluidos };
    }
}
