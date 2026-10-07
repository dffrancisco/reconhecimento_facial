import { Router } from "express";
import per from "../services/per";
import Login from "../_ADMIN/login/route.login";
import Evento from "../_ADMIN/evento/route.evento";
import Fotografo from "../_ADMIN/fotografo/route.fotografo";
import Estacao from "../_ADMIN/estacao/route.estacao";
import Operador from "../_ADMIN/operador/route.operador";

const router = Router();

router.post("/login", (req, res, next) => per(req, res, next, Login));
router.post("/evento", (req, res, next) => per(req, res, next, Evento));
router.post("/fotografo", (req, res, next) => per(req, res, next, Fotografo));
router.post("/estacao", (req, res, next) => per(req, res, next, Estacao));
router.post("/operador", (req, res, next) => per(req, res, next, Operador));

export default router;
