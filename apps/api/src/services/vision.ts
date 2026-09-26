import { config } from "./config";

export interface RostoDetectado {
    embedding: number[];
    bbox: number[];
    det_score: number;
    kps: number[][];
    area_px: number;
}

export interface ResultadoDetect {
    caminho: string;
    largura?: number;
    altura?: number;
    rostos: RostoDetectado[];
    erro?: string;
}

export async function detectarRostos(caminhos: string[]): Promise<ResultadoDetect[]> {
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), 30_000);
    try {
        const resposta = await fetch(`${config.visionUrl}/detect`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ caminhos }),
            signal: controlador.signal,
        });
        if (!resposta.ok) throw new Error(`[Vision] respondeu ${resposta.status}`);
        const corpo = (await resposta.json()) as { resultados: ResultadoDetect[] };
        return corpo.resultados;
    } finally {
        clearTimeout(temporizador);
    }
}

export interface SelfieEmbedding {
    embedding: number[];
    det_score: number;
}

// Erro que a ctrl converte em mensagem ao participante. O `codigo` vem do vision
// (sem_rosto, varios_rostos, baixa_confianca, rosto_pequeno, arquivo_invalido) e a `msg`
// já chega pronta e em português de lá.
export class ErroSelfie extends Error {
    constructor(
        public codigo: string,
        mensagem: string
    ) {
        super(mensagem);
        this.name = "ErroSelfie";
    }
}

export async function embedSelfie(caminho: string): Promise<SelfieEmbedding> {
    const controlador = new AbortController();
    // 20s: acima disso o participante desiste, e o spec manda responder "muita gente buscando".
    const temporizador = setTimeout(() => controlador.abort(), 20_000);
    try {
        const resposta = await fetch(`${config.visionUrl}/embed-selfie`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ caminho }),
            signal: controlador.signal,
        });
        const corpo = (await resposta.json()) as { codigo?: string; msg?: string; embedding?: number[]; det_score?: number };

        if (resposta.status === 422) throw new ErroSelfie(corpo.codigo ?? "arquivo_invalido", corpo.msg ?? "Não conseguimos ler sua selfie.");
        if (!resposta.ok) throw new Error(`[Vision] /embed-selfie respondeu ${resposta.status}`);

        return { embedding: corpo.embedding as number[], det_score: corpo.det_score ?? 0 };
    } finally {
        clearTimeout(temporizador);
    }
}
