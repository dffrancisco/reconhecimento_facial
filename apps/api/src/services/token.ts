import { createHmac, timingSafeEqual } from "node:crypto";

const VALIDADE_PADRAO_S = 43_200; // 12h

function assinar(payload: string, segredo: string): string {
    return createHmac("sha256", segredo).update(payload).digest("hex");
}

export function gerarToken(idOperador: number, segredo: string, validadeS: number = VALIDADE_PADRAO_S): string {
    const payload = Buffer.from(JSON.stringify({ id_operador: idOperador, exp: Date.now() + validadeS * 1000 })).toString(
        "base64url"
    );
    return `${payload}.${assinar(payload, segredo)}`;
}

export function conferirToken(token: string, segredo: string): number | null {
    const [payload, assinatura] = token.split(".");
    if (!payload || !assinatura) return null;

    const esperada = Buffer.from(assinar(payload, segredo));
    const recebida = Buffer.from(assinatura);
    if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null;

    try {
        const dados = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
            id_operador?: number;
            exp?: number;
        };
        if (typeof dados.id_operador !== "number" || typeof dados.exp !== "number") return null;
        if (dados.exp < Date.now()) return null;
        return dados.id_operador;
    } catch {
        return null;
    }
}
