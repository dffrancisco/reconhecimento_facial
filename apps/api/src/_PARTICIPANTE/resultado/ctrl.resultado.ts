import ConexaoPostgres from "../../db/conexaoPostgres";
import { ErroTratado } from "../../services/erro";
import { urlDaFoto, urlDoZip } from "../../services/linkArquivo";
import { criarFila } from "../../services/fila";
import { NOME_FILA as FILA_ZIP } from "../../jobs/zip";
import { RespostaResultado } from "./i.resultado";
import { buscaComEvento, criarArquivoZip, fotosDaBusca, fotosDaBuscaPorIds, somarDownloads, zipDaBusca, LinhaBuscaResultado } from "./sql.resultado";

export default class ResultadoCtrl {
    constructor(private conexao: ConexaoPostgres) {}

    async situacao(token: string): Promise<{ status: string; qtd_fotos: number }> {
        const busca = await this.conexao.queryOneParam<{ status: string; qtd_fotos: number }>(
            "SELECT status, qtd_fotos FROM busca WHERE token = ?",
            [token]
        );
        if (!busca) throw new ErroTratado("Não encontramos esta busca.");
        return busca;
    }

    async getResultado(token: string): Promise<RespostaResultado> {
        const busca = await this.exigirLiberada(token);
        const fotos = await fotosDaBusca(this.conexao, busca.id_busca);

        return {
            evento: { nome: busca.nome, slug: busca.slug },
            validade_ate: this.validadeAte(busca),
            fotos: fotos.map((foto) => ({
                id_foto: foto.id_foto,
                thumb: urlDaFoto(busca.id_evento, foto.hash_arquivo, "thumb"),
                similaridade: Number(foto.similaridade),
            })),
        };
    }

    async gerarLinks(token: string, ids: number[]): Promise<{ links: { id_foto: number; url: string }[] }> {
        const busca = await this.exigirLiberada(token);
        const fotos = await fotosDaBuscaPorIds(this.conexao, busca.id_busca, ids);
        if (fotos.length > 0) await somarDownloads(this.conexao, busca.id_busca, fotos.length);

        return {
            links: fotos.map((foto) => ({
                id_foto: foto.id_foto,
                // `dl=1` faz o nginx mandar Content-Disposition: attachment.
                url: `${urlDaFoto(busca.id_evento, foto.hash_arquivo, "web")}&dl=1`,
            })),
        };
    }

    async pedirZip(token: string): Promise<{ id_arquivo_zip: number; status: string }> {
        const busca = await this.exigirLiberada(token);
        const idArquivoZip = await criarArquivoZip(this.conexao, busca.id_evento, busca.id_busca);
        await criarFila<{ id_arquivo_zip: number }>(FILA_ZIP).add(FILA_ZIP, { id_arquivo_zip: idArquivoZip }, { attempts: 3 });
        return { id_arquivo_zip: idArquivoZip, status: "pendente" };
    }

    async situacaoZip(token: string, idArquivoZip: number): Promise<{ status: string; url?: string }> {
        const busca = await this.exigirLiberada(token);
        const zip = await zipDaBusca(this.conexao, busca.id_busca, idArquivoZip);
        if (!zip) throw new ErroTratado("Não encontramos este arquivo.");
        return zip.status === "pronto" ? { status: zip.status, url: urlDoZip(zip.id_evento, zip.id_arquivo_zip) } : { status: zip.status };
    }

    private async exigirLiberada(token: string): Promise<LinhaBuscaResultado> {
        const busca = await buscaComEvento(this.conexao, token);
        // Mesma mensagem para token inexistente e busca não liberada: não conta a quem pergunta
        // se aquele token existe.
        if (!busca || busca.status !== "liberada") throw new ErroTratado("Não encontramos suas fotos. Faça a busca de novo.");

        const validade = this.validadeAte(busca);
        if (validade && new Date(validade).getTime() < Date.now())
            throw new ErroTratado("O prazo para baixar estas fotos venceu. Faça a busca de novo.");

        return busca;
    }

    // `null` em validade_resultado_dias significa "até o expurgo": sem corte por data aqui.
    private validadeAte(busca: LinhaBuscaResultado): string | null {
        const dias = busca.config?.validade_resultado_dias;
        if (dias === null || dias === undefined) return null;
        return new Date(new Date(busca.criado_em).getTime() + Number(dias) * 86_400_000).toISOString();
    }
}
