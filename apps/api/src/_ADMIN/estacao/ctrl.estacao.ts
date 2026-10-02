import ConexaoPostgres from "../../db/conexaoPostgres";
import { ultimoSinal } from "./sql.estacao";

export interface SituacaoEstacao {
    painel: string | null;
    painel_tunel: string | null;
    ultimo_sinal_em: string;
}

const painelEm = (endereco: string | null) => (endereco ? `${endereco}/#/estacao` : null);

export default class EstacaoCtrl {
    constructor(private conexao: ConexaoPostgres) {}

    // null: a estação nunca deu sinal. Painel nulo: deu, mas sem ENDERECO_LAN (ou é de antes
    // de o sinal levar o endereço) — a tela diz o que configurar.
    async obterEstacao(): Promise<SituacaoEstacao | null> {
        const sinal = await ultimoSinal(this.conexao);
        if (!sinal) return null;
        return {
            painel: painelEm(sinal.endereco_lan),
            painel_tunel: painelEm(sinal.endereco_tunel),
            ultimo_sinal_em: sinal.recebido_em,
        };
    }
}
