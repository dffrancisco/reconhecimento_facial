import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import express from "express";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import { iniciarConfig } from "../src/services/config";
import { ErroSelfie, embedSelfie } from "../src/services/vision";

let servidor: Server;

before(async () => {
    const app = express();
    app.use(express.json());
    app.post("/embed-selfie", (req, res) => {
        const caminho = String(req.body.caminho);
        if (caminho.includes("sem-rosto")) {
            res.status(422).json({ codigo: "sem_rosto", msg: "Não achamos um rosto nessa foto." });
            return;
        }
        if (caminho.includes("varios")) {
            res.status(422).json({ codigo: "varios_rostos", msg: "Tem mais de um rosto na foto." });
            return;
        }
        res.json({ embedding: new Array(512).fill(0.05), det_score: 0.9 });
    });
    servidor = app.listen(0);
    await new Promise((resolve) => servidor.once("listening", resolve));

    iniciarConfig({
        PAPEL: "vps",
        POSTGRES_HOST: "127.0.0.1",
        POSTGRES_PORT: "5433",
        POSTGRES_USER: "fotos",
        POSTGRES_PASSWORD: "fotos",
        POSTGRES_DB: "fotos_vps",
        REDIS_URL: "redis://127.0.0.1:6380",
        ESTACAO_CHAVE: "a".repeat(32),
        ARQUIVO_SEGREDO: "x",
        OPERADOR_SEGREDO: "a".repeat(32),
        VISION_URL: `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`,
    });
});

describe("embedSelfie", () => {
    test("devolve o embedding de 512 posições", async () => {
        const r = await embedSelfie("/data/selfies/ok.jpg");
        assert.strictEqual(r.embedding.length, 512);
        assert.strictEqual(r.det_score, 0.9);
    });

    test("selfie sem rosto vira ErroSelfie com o código do vision", async () => {
        await assert.rejects(
            () => embedSelfie("/data/selfies/sem-rosto.jpg"),
            (erro: ErroSelfie) => {
                assert.strictEqual(erro.codigo, "sem_rosto");
                assert.match(erro.message, /rosto/i);
                return true;
            }
        );
    });

    test("selfie com vários rostos vira ErroSelfie", async () => {
        await assert.rejects(
            () => embedSelfie("/data/selfies/varios.jpg"),
            (erro: ErroSelfie) => erro.codigo === "varios_rostos"
        );
    });
});

after(() => {
    servidor?.close();
});
