import { Router } from "express";
import per from "../services/per";
import Login from "../_PAINEL/login/route.login";
import Painel from "../_PAINEL/painel/route.painel";

const router = Router();

router.post("/login", (req, res, next) => per(req, res, next, Login));
router.post("/painel", (req, res, next) => per(req, res, next, Painel));

export default router;
