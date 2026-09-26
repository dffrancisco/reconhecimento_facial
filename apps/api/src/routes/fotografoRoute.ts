import { Router } from "express";
import per from "../services/per";
import Upload from "../_FOTOGRAFO/upload/route.upload";
import { criarRotaPedaco } from "../_FOTOGRAFO/upload/pedaco";

const router = Router();

router.post("/upload", (req, res, next) => per(req, res, next, Upload));
// Fora do `{ call }`: o corpo é o próprio pedaço do arquivo, em binário.
router.put("/upload/:id_upload", criarRotaPedaco());

export default router;
