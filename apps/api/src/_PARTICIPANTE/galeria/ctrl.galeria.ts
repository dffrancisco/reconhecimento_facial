import ConexaoPostgres from "../../db/conexaoPostgres";
import { ErroTratado } from "../../services/erro";
import { urlDaFoto } from "../../services/linkArquivo";
import { diasDoEvento, eventoPublico, fotosDoEvento, LinhaEventoPublico } from "./sql.galeria";

export default class GaleriaCtrl {
    constructor(private conexao: ConexaoPostgres) {}

    async getEvento(entrada: { slug?: string; chaveAcesso?: string }) {
        const evento = await this.exigirEvento(entrada);
        const dias = await diasDoEvento(this.conexao, evento.id_evento);
        return {
            nome: evento.nome,
            data_inicio: evento.data_inicio,
            data_fim: evento.data_fim,
            total_fotos: dias.reduce((soma, d) => soma + d.qtd, 0),
            dias,
        };
    }

    async getGaleria(entrada: { slug?: string; chaveAcesso?: string }, offset: number, dia: string | null) {
        const evento = await this.exigirEvento(entrada);
        const fotos = await fotosDoEvento(this.conexao, evento.id_evento, offset, dia);
        return {
            fotos: fotos.map((foto) => ({
                id_foto: foto.id_foto,
                thumb: urlDaFoto(evento.id_evento, foto.hash_arquivo, "thumb"),
                web: urlDaFoto(evento.id_evento, foto.hash_arquivo, "web"),
            })),
        };
    }

    // Inexistente, inativo, expurgado (deletado) e privado pelo slug: a mesma resposta,
    // para a galeria pública não contar mais do que a busca contaria (spec §3).
    private async exigirEvento(entrada: { slug?: string; chaveAcesso?: string }): Promise<LinhaEventoPublico> {
        const evento = await eventoPublico(this.conexao, entrada);
        if (!evento || evento.ativo !== "S") throw new ErroTratado("Evento não encontrado. Confira o link.");
        return evento;
    }
}
