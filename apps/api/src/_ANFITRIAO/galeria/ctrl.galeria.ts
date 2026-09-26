import ConexaoPostgres from "../../db/conexaoPostgres";
import { ErroTratado } from "../../services/erro";
import { urlDaFoto } from "../../services/linkArquivo";
import { criarFila } from "../../services/fila";
import { FOTOS_POR_PARTE, NOME_FILA as FILA_ZIP } from "../../jobs/zip";
import { contarFotosVisiveis, criarZipsDoEvento, eventoPorChaveAnfitriao, fotosDoEvento, zipsValidosDoEvento } from "./sql.galeria";

export default class GaleriaCtrl {
    constructor(private conexao: ConexaoPostgres) {}

    async getGaleria(chave: string, offset: number, idEventoFotografo: number | null) {
        const evento = await this.exigirEvento(chave);
        const fotos = await fotosDoEvento(this.conexao, evento.id_evento, offset, idEventoFotografo);

        return {
            evento: evento.nome,
            fotos: fotos.map((foto) => ({
                id_foto: foto.id_foto,
                thumb: urlDaFoto(evento.id_evento, foto.hash_arquivo, "thumb"),
                web: urlDaFoto(evento.id_evento, foto.hash_arquivo, "web"),
            })),
        };
    }

    async pedirZip(chave: string): Promise<{ partes: number[]; status: string }> {
        const evento = await this.exigirEvento(chave);

        // Pedido repetido devolve o mesmo arquivo, em vez de montar o evento inteiro de novo.
        const existentes = await zipsValidosDoEvento(this.conexao, evento.id_evento);
        if (existentes.length > 0) return { partes: existentes, status: "pendente" };

        const total = await contarFotosVisiveis(this.conexao, evento.id_evento);
        const partes = Math.max(1, Math.ceil(total / FOTOS_POR_PARTE));
        const ids = await criarZipsDoEvento(this.conexao, evento.id_evento, partes);

        const fila = criarFila<{ id_arquivo_zip: number }>(FILA_ZIP);
        for (const id of ids) await fila.add(FILA_ZIP, { id_arquivo_zip: id }, { attempts: 3 });

        return { partes: ids, status: "pendente" };
    }

    private async exigirEvento(chave: string) {
        const evento = await eventoPorChaveAnfitriao(this.conexao, chave);
        if (!evento) throw new ErroTratado("Galeria não encontrada. Confira o link.");
        return evento;
    }
}
