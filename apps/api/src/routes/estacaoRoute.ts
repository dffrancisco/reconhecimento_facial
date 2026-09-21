import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import per from "../services/per";
import { autorizarEstacao } from "../services/authEstacao";
import { config } from "../services/config";
import Sincronizacao from "../_ESTACAO/sincronizacao/route.sincronizacao";

const router = Router();

router.post("/sincronizacao", (req, res, next) => per(req, res, next, Sincronizacao));

router.get("/marca-dagua/:idEvento", (req, res) => {
    try {
        autorizarEstacao({ authorization: req.headers.authorization });
    } catch {
        res.status(422).send({ msg: "Chave da estação inválida." });
        return;
    }

    const caminho = path.join(config.raizMarcas, `${Number(req.params.idEvento)}.png`);
    fs.access(caminho, fs.constants.R_OK, (erro) => {
        if (erro) {
            res.status(404).send({ msg: "Marca d'água não encontrada." });
            return;
        }
        res.sendFile(caminho);
    });
});

export default router;
