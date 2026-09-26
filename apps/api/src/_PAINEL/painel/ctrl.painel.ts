import fs from "node:fs/promises";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { config } from "../../services/config";
import { ultimaSincronizacao } from "../../services/sincronizacaoEstacao";
import { montarSinal } from "../../jobs/sinal";
import { caminhoParcial } from "../../_FOTOGRAFO/upload/ctrl.upload";
import { errosDoEvento, eventoEmAndamento, filaDoEvento, fotografosDoEvento, LinhaErro } from "./sql.painel";

interface Gpu {
    utilizacao: number;
    vram_usada_mb: number;
    vram_total_mb: number;
}

function lerGpu(bruto: unknown): Gpu | null {
    const g = bruto as Partial<Gpu> | null;
    if (!g || typeof g.utilizacao !== "number" || typeof g.vram_usada_mb !== "number" || typeof g.vram_total_mb !== "number") return null;
    return { utilizacao: g.utilizacao, vram_usada_mb: g.vram_usada_mb, vram_total_mb: g.vram_total_mb };
}

const existe = (caminho: string) =>
    fs.access(caminho).then(
        () => true,
        () => false
    );

// Reprocessar só faz sentido com o arquivo em disco: o original copiado, ou o arquivo recebido
// quando a falha foi antes de ele ser movido para os originais.
export async function arquivoDoErro(erro: Pick<LinhaErro, "caminho_original" | "id_upload">): Promise<string | null> {
    if (erro.caminho_original && (await existe(erro.caminho_original))) return erro.caminho_original;
    if (erro.id_upload && (await existe(caminhoParcial(erro.id_upload)))) return caminhoParcial(erro.id_upload);
    return null;
}

export default class PainelCtrl {
    constructor(private conexao: ConexaoPostgres) {}

    async getPainel() {
        const [evento, sinal, sincronizou] = await Promise.all([
            eventoEmAndamento(this.conexao),
            montarSinal(this.conexao),
            ultimaSincronizacao(),
        ]);

        const metricas = sinal as {
            fotos_min: Record<string, number>;
            latencia_ms: { p50: number; p95: number };
            taxa_erro: number;
            gpu: unknown;
        };
        const base = {
            metricas: {
                fotos_min: metricas.fotos_min["5"] ?? 0,
                latencia_p50_ms: metricas.latencia_ms.p50,
                latencia_p95_ms: metricas.latencia_ms.p95,
                taxa_erro: metricas.taxa_erro,
                gpu: lerGpu(metricas.gpu),
            },
            vps: { ultima_sincronizacao: sincronizou },
            enderecos: { lan: config.enderecoLan, tunel: config.enderecoTunel },
        };

        if (!evento)
            return {
                ...base,
                evento: null,
                fila: { recebidas: 0, rostos: 0, derivados: 0, esperando_publicar: 0 },
                fotografos: [],
                erros: [],
                em_processamento: 0,
            };

        const [fila, fotografos, erros] = await Promise.all([
            filaDoEvento(this.conexao, evento.id_evento),
            fotografosDoEvento(this.conexao, evento.id_evento),
            errosDoEvento(this.conexao, evento.id_evento),
        ]);

        return {
            ...base,
            evento: { id_evento: evento.id_evento, nome: evento.nome, desde: evento.criado_em },
            fila,
            fotografos,
            erros: await Promise.all(
                erros.map(async (e) => ({
                    id_foto: e.id_foto,
                    nome_arquivo: e.nome_arquivo,
                    fotografo: e.fotografo,
                    etapa: e.etapa,
                    erro: e.erro,
                    tem_arquivo: (await arquivoDoErro(e)) !== null,
                }))
            ),
            em_processamento: fila.recebidas + fila.rostos + fila.derivados + fila.esperando_publicar,
        };
    }
}
