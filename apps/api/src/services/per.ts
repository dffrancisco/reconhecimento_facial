import { NextFunction, Request, Response } from "express";
import { ErroTratado } from "./erro";

export interface iContexto {
    authorization?: string;
}

export interface iRota {
    conexao?: { close(): Promise<unknown>; marcarErro?(): void };
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
    if (typeof rs === "object") {
        const obj = rs as { status?: unknown; data?: unknown };
        if (typeof obj.status === "number") {
            res.status(obj.status).send(obj.data);
            return;
        }
        if ("data" in obj) {
            res.send(obj.data);
            return;
        }
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
    let fechada = false;

    // `close()` da conexão é quem faz o COMMIT (ou o ROLLBACK, quando marcarErro() foi chamado).
    const fechar = async (): Promise<void> => {
        if (fechada || !rota?.conexao) return;
        fechada = true;
        await rota.conexao.close();
    };

    try {
        rota = new Classe({ authorization: req.headers.authorization });
        await rota.init();
        const metodo = (rota as unknown as Record<string, (req: Request) => Promise<unknown>>)[call];
        const rs = await metodo.call(rota, req);

        // Fecha antes de responder: um 200 só pode sair depois do COMMIT. Respondendo primeiro,
        // um COMMIT que falhasse deixaria o cliente convencido de que gravou — e, no caso da
        // estação publicando fotos, a foto seria marcada como publicada e nunca reenviada.
        await fechar();
        responder(res, rs);
    } catch (erro) {
        // Marca a conexão como falha antes de fechá-la: sem isso, um erro lançado
        // dentro de uma transação (openTransaction) seria seguido de COMMIT em vez de rollback.
        rota?.conexao?.marcarErro?.();
        try {
            await fechar();
        } catch (erroFechar) {
            console.error("[per] Erro ao fechar a conexão:", erroFechar);
        }

        if (erro instanceof ErroTratado) {
            res.status(422).send(erro.codigo ? { msg: erro.message, codigo: erro.codigo } : { msg: erro.message });
            return;
        }

        // Nunca loga o objeto de erro inteiro: erros do pg carregam `detail` (pode ter telefone)
        // e, em SQLSTATE 22P02, a própria `message` pode carregar o valor (ex.: embedding).
        const detalhes =
            erro instanceof Error
                ? {
                      name: erro.name,
                      message: erro.message,
                      code: (erro as { code?: unknown }).code,
                      stack: erro.stack,
                  }
                : { message: String(erro) };
        console.error(`[per] Erro em ${req.baseUrl}${req.path} (${call}):`, detalhes);
        res.status(500).send({ msg: "Erro ao processar sua solicitação" });
    }
}
