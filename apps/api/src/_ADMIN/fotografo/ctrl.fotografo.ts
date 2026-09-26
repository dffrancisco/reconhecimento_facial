import ConexaoPostgres from "../../db/conexaoPostgres";
import { ErroTratado } from "../../services/erro";
import { gerarChave } from "../../services/aleatorio";
import { buscarVinculo, eventoExiste, inserirFotografo, inserirVinculo, LinhaFotografo, LinhaVinculo, listarFotografosSql } from "./sql.fotografo";

export default class FotografoCtrl {
    constructor(private conexao: ConexaoPostgres) {}

    async criarFotografo(dados: { nome: string; telefone: string | null }): Promise<LinhaFotografo> {
        return inserirFotografo(this.conexao, dados.nome, dados.telefone ?? null);
    }

    async listarFotografos(): Promise<LinhaFotografo[]> {
        return listarFotografosSql(this.conexao);
    }

    async vincularFotografo(idEvento: number, idFotografo: number): Promise<LinhaVinculo> {
        if (!(await eventoExiste(this.conexao, idEvento))) throw new ErroTratado("Evento não encontrado.");

        const existente = await buscarVinculo(this.conexao, idEvento, idFotografo);
        if (existente) return existente;
        return inserirVinculo(this.conexao, idEvento, idFotografo, gerarChave());
    }
}
