import { createHmac, timingSafeEqual } from "node:crypto";

const VALIDADE_PADRAO_S = 43_200; // 12h

function assinar(payload: string, segredo: string): string {
    return createHmac("sha256", segredo).update(payload).digest("hex");
}

export interface SessaoOperador {
    id_operador: number;
    versao: string;
}

// `versao` é a versão da senha (versaoDaSenha): o autorizarOperador recusa o token quando ela
// não bate mais com a do banco.
export function gerarToken(idOperador: number, segredo: string, versao: string, validadeS: number = VALIDADE_PADRAO_S): string {
    const payload = Buffer.from(JSON.stringify({ id_operador: idOperador, v: versao, exp: Date.now() + validadeS * 1000 })).toString(
        "base64url"
    );
    return `${payload}.${assinar(payload, segredo)}`;
}

export function conferirToken(token: string, segredo: string): SessaoOperador | null {
    const [payload, assinatura] = token.split(".");
    if (!payload || !assinatura) return null;

    const esperada = Buffer.from(assinar(payload, segredo));
    const recebida = Buffer.from(assinatura);
    if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null;

    try {
        const dados = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
            id_operador?: number;
            v?: string;
            exp?: number;
        };
        if (typeof dados.id_operador !== "number" || typeof dados.v !== "string" || typeof dados.exp !== "number") return null;
        if (dados.exp < Date.now()) return null;
        return { id_operador: dados.id_operador, versao: dados.v };
    } catch {
        return null;
    }
}
