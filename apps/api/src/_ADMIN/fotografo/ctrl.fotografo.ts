import ConexaoPostgres from "../../db/conexaoPostgres";
import { ErroTratado } from "../../services/erro";
import { gerarChave } from "../../services/aleatorio";
import {
    buscarVinculo,
    desativarVinculo,
    eventoExiste,
    fotografoExiste,
    inserirFotografo,
    inserirVinculo,
    LinhaFotografo,
    LinhaVinculo,
    LinhaVinculoDoEvento,
    listarFotografosSql,
    listarVinculosSql,
    reativarVinculo,
} from "./sql.fotografo";

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
        if (!(await fotografoExiste(this.conexao, idFotografo))) throw new ErroTratado("Fotógrafo não encontrado.");

        const existente = await buscarVinculo(this.conexao, idEvento, idFotografo);
        if (existente?.ativo === "S") return existente;
        // Link novo ao voltar: se o antigo vazou (foi por isso que o removeram), segue sem valer.
        if (existente) return reativarVinculo(this.conexao, existente.id_evento_fotografo, gerarChave());
        return inserirVinculo(this.conexao, idEvento, idFotografo, gerarChave());
    }

    // Sem o token: o admin não mostra o link de upload, só a estação sabe o próprio endereço.
    async listarVinculos(idEvento: number): Promise<LinhaVinculoDoEvento[]> {
        return listarVinculosSql(this.conexao, idEvento);
    }

    async desvincularFotografo(idEventoFotografo: number): Promise<{ ok: true }> {
        if ((await desativarVinculo(this.conexao, idEventoFotografo)) === 0) throw new ErroTratado("Fotógrafo não encontrado neste evento.");
        return { ok: true };
    }
}
