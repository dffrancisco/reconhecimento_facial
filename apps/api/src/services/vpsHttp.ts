import { config } from "./config";

export async function chamarVps(caminho: string, corpo: unknown, timeoutMs = 30_000): Promise<unknown> {
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), timeoutMs);
    try {
        const resposta = await fetch(`${config.vpsUrl}${caminho}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: config.estacaoChave },
            body: JSON.stringify(corpo),
            signal: controlador.signal,
        });
        const dados = await resposta.json();
        if (!resposta.ok) throw new Error(`VPS respondeu ${resposta.status} em ${caminho}: ${JSON.stringify(dados)}`);
        return dados;
    } finally {
        clearTimeout(temporizador);
    }
}
