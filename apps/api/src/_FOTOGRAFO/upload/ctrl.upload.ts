import fs from "node:fs/promises";
import path from "node:path";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { config } from "../../services/config";
import { ErroTratado } from "../../services/erro";
import { mensagemParaFotografo, validarInicio } from "./regras";
import {
    atualizarRecebidos,
    contagensDoVinculo,
    errosDoVinculo,
    fotoJaNoEvento,
    inserirUpload,
    LinhaVinculo,
    uploadEmAndamento,
    vinculoPorToken,
} from "./sql.upload";

export type { LinhaVinculo };

const LINK_FECHADO = "Este link não aceita mais fotos. Fale com o operador da estação.";

// O token do link é a credencial do fotógrafo: vínculo desativado no admin, evento inativo
// ou encerrado na estação fecham o envio com um código que a tela entende sem ler o texto.
export async function exigirVinculo(conexao: ConexaoPostgres, token: unknown): Promise<LinhaVinculo> {
    const vinculo = typeof token === "string" && token ? await vinculoPorToken(conexao, token) : undefined;
    if (!vinculo || vinculo.ativo !== "S" || vinculo.evento_ativo !== "S" || vinculo.deletado !== "N")
        throw new ErroTratado(LINK_FECHADO, "link_invalido");
    if (vinculo.encerrado_em) throw new ErroTratado(LINK_FECHADO, "evento_encerrado");
    return vinculo;
}

export function caminhoParcial(idUpload: number): string {
    return path.join(config.raizUploads, `${idUpload}.part`);
}

export async function tamanhoEmDisco(idUpload: number): Promise<number> {
    try {
        return (await fs.stat(caminhoParcial(idUpload))).size;
    } catch (erro) {
        if ((erro as { code?: unknown }).code === "ENOENT") return 0;
        throw erro;
    }
}

type RespostaInicio = { situacao: "ja_existe" } | { situacao: "continuar" | "novo"; id_upload: number; bytes_recebidos: number };

export default class UploadCtrl {
    constructor(private conexao: ConexaoPostgres) {}

    async getSessao(token: unknown) {
        const vinculo = await exigirVinculo(this.conexao, token);
        return { evento: { nome: vinculo.nome_evento }, fotografo: { nome: vinculo.nome_fotografo }, pedaco_bytes: config.uploadPedacoBytes };
    }

    async iniciarUpload(token: unknown, entrada: { nome_arquivo: unknown; tamanho: unknown; hash_arquivo: unknown }): Promise<RespostaInicio> {
        const vinculo = await exigirVinculo(this.conexao, token);
        const recusa = validarInicio(entrada);
        if (recusa) throw new ErroTratado(recusa);

        const nome = entrada.nome_arquivo as string;
        const tamanho = entrada.tamanho as number;
        const hash = (entrada.hash_arquivo as string).toLowerCase();

        if (await fotoJaNoEvento(this.conexao, vinculo.id_evento, hash)) return { situacao: "ja_existe" };

        const existente = await uploadEmAndamento(this.conexao, vinculo.id_evento_fotografo, hash);
        if (existente) {
            // O disco manda: a coluna pode ter ficado para trás se a estação caiu no meio de um pedaço.
            const bytes = await tamanhoEmDisco(existente.id_upload);
            await atualizarRecebidos(this.conexao, existente.id_upload, bytes);
            return { situacao: "continuar", id_upload: existente.id_upload, bytes_recebidos: bytes };
        }

        const idUpload = await inserirUpload(this.conexao, {
            id_evento_fotografo: vinculo.id_evento_fotografo,
            nome_arquivo: nome,
            tamanho,
            hash_arquivo: hash,
        });
        return { situacao: "novo", id_upload: idUpload, bytes_recebidos: 0 };
    }

    async statusUpload(token: unknown) {
        const vinculo = await exigirVinculo(this.conexao, token);
        const [contagens, erros] = await Promise.all([
            contagensDoVinculo(this.conexao, vinculo.id_evento_fotografo),
            errosDoVinculo(this.conexao, vinculo.id_evento_fotografo),
        ]);
        return {
            ...contagens,
            erros: erros.map((e) => ({ nome_arquivo: e.nome_arquivo, mensagem: mensagemParaFotografo(e.erro, e.erro_etapa) })),
        };
    }
}
