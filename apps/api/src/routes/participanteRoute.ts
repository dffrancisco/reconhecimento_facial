import { Router } from "express";
import per from "../services/per";
import Busca from "../_PARTICIPANTE/busca/route.busca";
import Resultado from "../_PARTICIPANTE/resultado/route.resultado";

const router = Router();

router.post("/busca", (req, res, next) => per(req, res, next, Busca));
router.post("/resultado", (req, res, next) => per(req, res, next, Resultado));

export default router;
