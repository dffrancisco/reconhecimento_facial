import http from "node:http";
import path from "node:path";
import express from "express";
import fileUpload from "express-fileupload";
import { config } from "./config";
import { fecharBanco } from "../db/conexaoPostgres";
import fotografoRoute from "../routes/fotografoRoute";
import painelRoute from "../routes/painelRoute";
import participanteRoute from "../routes/participanteRoute";
import anfitriaoRoute from "../routes/anfitriaoRoute";
import adminRoute from "../routes/adminRoute";
import estacaoRoute from "../routes/estacaoRoute";

// Mesmo caminho relativo em src/services e dist/services.
const versao: string = require(path.join(__dirname, "..", "..", "package.json")).version;

export default class StartApp {
    app: express.Application;
    private httpServer: http.Server;

    constructor() {
        this.app = express();
        this.httpServer = http.createServer(this.app);

        this.app.use(
            fileUpload({
                abortOnLimit: true,
                limits: { fileSize: 25 * 1024 * 1024, files: 5 },
                responseOnLimit: "Arquivo grande demais",
            })
        );
        this.app.use(express.json({ limit: "1mb" }));
        this.app.use(express.urlencoded({ limit: "1mb", extended: true }));

        this.rotas();
    }

    // Cada papel monta só as suas áreas.
    private rotas() {
        this.app.get("/test", (_req, res) => {
            res.json({ msg: "Teste funcionando!", papel: config.papel, versao });
        });

        if (config.papel === "estacao") {
            this.app.use("/api/fotografo", fotografoRoute);
            this.app.use("/api/painel", painelRoute);
        } else {
            this.app.use("/api/participante", participanteRoute);
            this.app.use("/api/anfitriao", anfitriaoRoute);
            this.app.use("/api/admin", adminRoute);
            this.app.use("/api/estacao", estacaoRoute);
        }
    }

    listen() {
        this.httpServer.listen(config.porta, () => {
            console.log(`[Api] Papel ${config.papel} | porta ${config.porta} | versão ${versao}`);
            console.log(`[Api] Banco ${config.postgres.host}:${config.postgres.porta}/${config.postgres.banco}`);
        });

        let encerrando = false;
        const encerrar = (evento: string) => () => {
            if (encerrando) return;
            encerrando = true;
            console.log(`[Api] ${evento} recebido, encerrando...`);
            this.httpServer.close(async () => {
                try {
                    await fecharBanco();
                } catch (erro) {
                    console.error("[Api] Erro ao fechar o banco:", erro instanceof Error ? erro.message : erro);
                } finally {
                    process.exit(0);
                }
            });
        };
        process.on("SIGINT", encerrar("SIGINT"));
        process.on("SIGTERM", encerrar("SIGTERM"));
    }
}
