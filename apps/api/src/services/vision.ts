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
