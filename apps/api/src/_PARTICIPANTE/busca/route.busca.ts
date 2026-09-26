import { Request } from "express";
import { UploadedFile } from "express-fileupload";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { config } from "../../services/config";
import { iContexto, iRota } from "../../services/per";
import { ipDoPedido } from "../../services/limiteTaxa";
import BuscaCtrl from "./ctrl.busca";

export default class Busca implements iRota {
    conexao = new ConexaoPostgres();
    private ctrl!: BuscaCtrl;

    // A busca é pública: sem autorização, só limite por IP.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(private contexto: iContexto) {}

    async init(): Promise<void> {
        await this.conexao.open();
        this.ctrl = new BuscaCtrl(this.conexao);
    }

    async buscar(req: Request) {
        const { slug, chave_acesso, versao_termo, aceita_marketing, chave_aparelho, token_origem } = req.body;
        if (!slug && !chave_acesso) return { msg: "Informe o evento (slug ou chave_acesso)", error: true };
        if (!versao_termo) return { msg: "É preciso aceitar o termo antes de buscar", error: true };

        const bruto = req.files?.selfies;
        const enviadas = (Array.isArray(bruto) ? bruto : bruto ? [bruto] : []) as UploadedFile[];
        if (enviadas.length === 0) return { msg: "Mande ao menos uma selfie", error: true };

        return this.ctrl.buscar({
            slug,
            chaveAcesso: chave_acesso,
            versaoTermo: String(versao_termo),
            aceitaMarketing: aceita_marketing === "S" || aceita_marketing === "true",
            chaveAparelho: chave_aparelho,
            tokenOrigem: token_origem,
            ip: ipDoPedido(req.headers as Record<string, unknown>, req.ip, config.confiarCloudflare),
            selfies: enviadas.map((arquivo) => ({ nome: arquivo.name, dados: arquivo.data })),
        });
    }
}
