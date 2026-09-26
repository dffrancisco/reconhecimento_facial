import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomInt } from "node:crypto";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { config } from "../../services/config";
import { ErroTratado } from "../../services/erro";
import { gerarChave } from "../../services/aleatorio";
import { urlDaFoto } from "../../services/linkArquivo";
import { contarNaJanela } from "../../services/limiteTaxa";
import { ErroSelfie, embedSelfie } from "../../services/vision";
import { agruparResultados } from "./agrupar";
import { decidirStatusBusca } from "./status";
import { FotoEncontrada, RespostaBusca, RostoParecido } from "./i.busca";
import {
    buscaPorToken,
    buscarRostosParecidos,
    codigoEmUso,
    eventoPorSlugOuChave,
    gravarBusca,
    gravarBuscaFotos,
    participantePorChaveAparelho,
    LinhaEventoBusca,
} from "./sql.busca";

const JANELA_LIMITE_S = 600;
const VALIDADE_CODIGO_MIN = 30;

// O vision já devolve a mensagem pronta e em português para cada código (rostos.py).
// Este mapa é só a rede de segurança para um código que ele passe a mandar sem texto.
const MENSAGEM_SELFIE: Record<string, string> = {
    sem_rosto: "Não encontramos um rosto na foto. Tire outra selfie de frente, com o rosto visível.",
    varios_rostos: "Encontramos mais de um rosto. Tire uma selfie só sua.",
    baixa_confianca: "Não conseguimos ver bem o seu rosto. Tire outra selfie de frente e com boa luz.",
    rosto_pequeno: "Seu rosto ficou pequeno na foto. Aproxime a câmera e tente de novo.",
    borrada: "A foto ficou tremida. Segure o celular firme e tente de novo.",
    arquivo_invalido: "Não conseguimos abrir a foto. Tente outra.",
};

export interface ArquivoSelfie {
    nome: string;
    dados: Buffer;
}

export interface EntradaBuscar {
    slug?: string;
    chaveAcesso?: string;
    versaoTermo: string;
    aceitaMarketing: boolean;
    chaveAparelho?: string;
    tokenOrigem?: string;
    ip: string;
    selfies: ArquivoSelfie[];
}

export default class BuscaCtrl {
    constructor(private conexao: ConexaoPostgres) {}

    async buscar(entrada: EntradaBuscar): Promise<RespostaBusca> {
        const usos = await contarNaJanela(`busca:${entrada.ip}`, JANELA_LIMITE_S);
        if (usos > config.buscaLimiteIp) throw new ErroTratado("Muitas buscas seguidas deste aparelho. Tente de novo em alguns minutos.");

        const evento = await eventoPorSlugOuChave(this.conexao, { slug: entrada.slug, chaveAcesso: entrada.chaveAcesso });
        if (!evento) throw new ErroTratado("Evento não encontrado. Confira o link.");
        if (evento.ativo !== "S") throw new ErroTratado("Este evento não está mais recebendo buscas.");

        const maxSelfies = Number(evento.config?.max_selfies ?? 3);
        const selfies = entrada.selfies.slice(0, maxSelfies);
        const limiar = Number(evento.config?.limiar ?? 0.42);

        const caminhos: string[] = [];
        try {
            const listas: RostoParecido[][] = [];
            for (const selfie of selfies) {
                const caminho = path.join(config.raizSelfies, `${gerarChave(16)}.jpg`);
                await fs.mkdir(config.raizSelfies, { recursive: true });
                await fs.writeFile(caminho, selfie.dados);
                caminhos.push(caminho);

                const { embedding } = await embedSelfie(caminho);
                listas.push(await buscarRostosParecidos(this.conexao, evento.id_evento, embedding));
            }

            const fotos = agruparResultados(listas, limiar);
            return await this.gravarEResponder(entrada, evento, fotos);
        } catch (erro) {
            // A mensagem do vision já é escrita para o participante; o mapa local só cobre
            // um código que venha sem texto.
            if (erro instanceof ErroSelfie)
                throw new ErroTratado(erro.message || MENSAGEM_SELFIE[erro.codigo] || MENSAGEM_SELFIE.arquivo_invalido);
            if (erro instanceof Error && erro.name === "AbortError")
                throw new ErroTratado("Muita gente buscando agora, tente em instantes.");
            throw erro;
        } finally {
            // Spec §10: a selfie existe só durante a busca. Vale para todo caminho, inclusive o de erro.
            await Promise.allSettled(caminhos.map((caminho) => fs.unlink(caminho)));
        }
    }

    private async gravarEResponder(entrada: EntradaBuscar, evento: LinhaEventoBusca, fotos: FotoEncontrada[]): Promise<RespostaBusca> {
        const idParticipanteAparelho = entrada.chaveAparelho
            ? ((await participantePorChaveAparelho(this.conexao, evento.id_evento, hashDaChave(entrada.chaveAparelho))) ?? null)
            : null;

        const origemLinha = entrada.tokenOrigem ? await buscaPorToken(this.conexao, entrada.tokenOrigem) : undefined;
        // `validade_resultado_dias` nulo significa "até o expurgo": aí não há corte por data.
        const diasValidade = evento.config?.validade_resultado_dias;
        const origemDentroDaValidade =
            !origemLinha || diasValidade === null || diasValidade === undefined
                ? true
                : new Date(origemLinha.criado_em).getTime() + Number(diasValidade) * 86_400_000 > Date.now();

        const decisao = decidirStatusBusca({
            idEvento: evento.id_evento,
            qtdFotos: fotos.length,
            exigirWhatsapp: evento.config?.exigir_whatsapp !== false,
            idParticipanteAparelho,
            origem: origemLinha
                ? {
                      status: origemLinha.status,
                      id_evento: origemLinha.id_evento,
                      id_participante: origemLinha.id_participante,
                      dentroDaValidade: origemDentroDaValidade,
                  }
                : null,
        });

        const token = gerarChave();
        const codigo = decisao.precisaCodigo ? await this.codigoInedito() : null;
        const idBusca = await gravarBusca(this.conexao, {
            id_evento: evento.id_evento,
            token,
            codigo,
            status: decisao.status,
            qtd_fotos: fotos.length,
            versao_termo: entrada.versaoTermo,
            aceita_marketing: entrada.aceitaMarketing ? "S" : "N",
            id_participante: decisao.idParticipante,
            id_busca_origem: origemLinha?.id_busca ?? null,
            codigo_expira_em: codigo ? new Date(Date.now() + VALIDADE_CODIGO_MIN * 60_000).toISOString() : null,
        });
        await gravarBuscaFotos(this.conexao, idBusca, fotos);

        // Com status aguardando nenhuma imagem é exposta, nem a prévia borrada.
        const previas =
            decisao.status === "liberada" ? await this.previasAssinadas(fotos.map((f) => f.id_foto), evento.id_evento) : [];

        return {
            token,
            status: decisao.status,
            qtd_fotos: fotos.length,
            previas,
            ...(codigo ? { codigo } : {}),
        };
    }

    private async previasAssinadas(idsFoto: number[], idEvento: number): Promise<string[]> {
        if (idsFoto.length === 0) return [];
        const linhas = await this.conexao.queryParam<{ hash_arquivo: string }>(
            "SELECT hash_arquivo FROM foto WHERE id_foto = ANY(?::int[]) ORDER BY id_foto",
            [`{${idsFoto.join(",")}}`]
        );
        return linhas.map((linha) => urlDaFoto(idEvento, linha.hash_arquivo, "previa"));
    }

    private async codigoInedito(): Promise<string> {
        for (let tentativa = 0; tentativa < 10; tentativa++) {
            const codigo = String(randomInt(0, 100_000)).padStart(5, "0");
            if (!(await codigoEmUso(this.conexao, codigo))) return codigo;
        }
        throw new Error("[Busca] não foi possível gerar um código livre");
    }
}

export function hashDaChave(chave: string): string {
    return createHash("sha256").update(chave).digest("hex");
}
