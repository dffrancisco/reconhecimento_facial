import { Router } from "express";
import per from "../services/per";
import Login from "../_ADMIN/login/route.login";
import Evento from "../_ADMIN/evento/route.evento";

const router = Router();

router.post("/login", (req, res, next) => per(req, res, next, Login));
router.post("/evento", (req, res, next) => per(req, res, next, Evento));

export default router;
