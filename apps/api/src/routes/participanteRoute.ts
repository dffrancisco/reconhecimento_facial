import { Router } from "express";
import per from "../services/per";
import Busca from "../_PARTICIPANTE/busca/route.busca";

const router = Router();

router.post("/busca", (req, res, next) => per(req, res, next, Busca));

export default router;
