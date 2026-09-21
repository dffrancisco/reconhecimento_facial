import { Router } from "express";
import per from "../services/per";
import Login from "../_ADMIN/login/route.login";

const router = Router();

router.post("/login", (req, res, next) => per(req, res, next, Login));

export default router;
