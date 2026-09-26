import { Router } from "express";
import per from "../services/per";
import Login from "../_ADMIN/login/route.login";
import Evento from "../_ADMIN/evento/route.evento";
import Fotografo from "../_ADMIN/fotografo/route.fotografo";

const router = Router();

router.post("/login", (req, res, next) => per(req, res, next, Login));
router.post("/evento", (req, res, next) => per(req, res, next, Evento));
router.post("/fotografo", (req, res, next) => per(req, res, next, Fotografo));

export default router;
