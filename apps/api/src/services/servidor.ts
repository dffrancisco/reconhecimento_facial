import express, { NextFunction, Request, Response } from "express";
import fileUpload from "express-fileupload";
import { areasDoPapel, iArea } from "../routes/areas";
import { config } from "./config";
import { verificarSaude } from "./saude";

export function criarApp(areas: iArea[] = areasDoPapel(config.papel)): express.Express {
    const app = express();
    app.disable("x-powered-by");
    app.use(express.json({ limit: "1mb" }));
    app.use(fileUpload({ limits: { fileSize: 25 * 1024 * 1024 }, abortOnLimit: true }));

    app.get("/test", async (_req: Request, res: Response) => {
        const saude = await verificarSaude();
        res.status(saude.ok ? 200 : 503).send(saude);
    });

    for (const area of areas) app.use(`/api/${area.caminho}`, area.router);

    app.use((_req: Request, res: Response) => {
        res.status(404).send({ msg: "Rota não encontrada" });
    });

    app.use((erro: Error & { type?: string }, _req: Request, res: Response, _next: NextFunction) => {
        if (erro.type === "entity.parse.failed") {
            res.status(400).send({ msg: "JSON inválido" });
            return;
        }
        if (erro.type === "entity.too.large") {
            res.status(413).send({ msg: "Requisição grande demais" });
            return;
        }
        console.error("[Servidor] Erro não tratado:", erro);
        res.status(500).send({ msg: "Erro ao processar sua solicitação" });
    });

    return app;
}
