import { Router } from "express";
import per from "../services/per";
import Galeria from "../_ANFITRIAO/galeria/route.galeria";

const router = Router();

router.post("/galeria", (req, res, next) => per(req, res, next, Galeria));

export default router;
