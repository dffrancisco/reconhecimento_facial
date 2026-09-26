import { Router } from "express";
import per from "../services/per";
import Upload from "../_FOTOGRAFO/upload/route.upload";

const router = Router();

router.post("/upload", (req, res, next) => per(req, res, next, Upload));

export default router;
