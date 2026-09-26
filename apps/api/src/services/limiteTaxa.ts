import { obterRedis } from "./fila";
import { config } from "./config";

function primeiroValor(bruto: unknown): string | undefined {
    const valor = Array.isArray(bruto) ? bruto[0] : bruto;
    return typeof valor === "string" && valor.length > 0 ? valor : undefined;
}

export function ipDoPedido(headers: Record<string, unknown>, ipSocket: string | undefined, confiarCloudflare: boolean): string {
    if (confiarCloudflare) {
        const daCloudflare = primeiroValor(headers["cf-connecting-ip"]);
        if (daCloudflare) return daCloudflare;

        // Atrás do Traefik, `req.ip` é o IP do proxy e seria o mesmo para todo mundo: o limite
        // por IP viraria um teto único para a plataforma inteira. O primeiro nome do
        // X-Forwarded-For é o cliente original.
        const encaminhado = primeiroValor(headers["x-forwarded-for"]);
        if (encaminhado) return encaminhado.split(",")[0].trim();
    }
    return ipSocket && ipSocket.length > 0 ? ipSocket : "desconhecido";
}

// Devolve quantas vezes a chave foi usada na janela, contando esta. O EXPIRE só é aplicado
// na primeira, para a janela ser fixa e não andar para frente a cada pedido.
export async function contarNaJanela(chave: string, janelaS: number): Promise<number> {
    const redis = obterRedis();
    const completa = `${config.redis.prefixo}limite:${chave}`;
    const valor = await redis.incr(completa);
    if (valor === 1) await redis.expire(completa, janelaS);
    return valor;
}
