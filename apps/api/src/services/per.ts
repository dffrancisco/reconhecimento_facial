import { NextFunction, Request, Response } from "express";
import { ErroTratado } from "./erro";

export interface iContexto {
    authorization?: string;
}

export interface iRota {
    conexao?: { close(): Promise<unknown> };
    init(): Promise<void>;
}

export type tClasseRota = new (contexto: iContexto) => iRota;

const RESERVADOS = new Set(["constructor", "init"]);

export function chamadaValida(Classe: tClasseRota, call: unknown): call is string {
    if (typeof call !== "string" || RESERVADOS.has(call) || call.startsWith("_")) return false;
    return typeof Object.getOwnPropertyDescriptor(Classe.prototype, call)?.value === "function";
}

function responder(res: Response, rs: unknown): void {
    if (rs === null || rs === undefined) {
        res.send([]);
        return;
    }
    if (typeof rs === "object" && "data" in rs && typeof (rs as { status?: unknown }).status === "number") {
        const { status, data } = rs as { status: number; data: unknown };
        res.status(status).send(data);
        return;
    }
    res.send(rs);
}

export default async function per(
    req: Request,
    res: Response,
    _next: NextFunction,
    Classe: tClasseRota
): Promise<void> {
    const call: unknown = req.body?.call;
    if (!chamadaValida(Classe, call)) {
        res.status(400).send({ msg: "Chamada inválida" });
        return;
    }

    let rota: iRota | undefined;
    try {
        rota = new Classe({ authorization: req.headers.authorization });
        await rota.init();
        const metodo = (rota as unknown as Record<string, (req: Request) => Promise<unknown>>)[call];
        responder(res, await metodo.call(rota, req));
    } catch (erro) {
        if (erro instanceof ErroTratado) {
            res.status(422).send({ msg: erro.message });
            return;
        }
        console.error(`[per] Erro em ${req.baseUrl}${req.path} (${call}):`, erro);
        res.status(500).send({ msg: "Erro ao processar sua solicitação" });
    } finally {
        if (rota?.conexao) {
            try {
                await rota.conexao.close();
            } catch (erro) {
                console.error("[per] Erro ao fechar a conexão:", erro);
            }
        }
    }
}
