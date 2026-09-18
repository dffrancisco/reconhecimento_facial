import fs from "node:fs";
import path from "node:path";
import ConexaoPostgres from "../db/conexaoPostgres";
import { config, tPapel } from "./config";
import { redis } from "./redis";

// Mesmo caminho relativo em src/services e dist/services.
const VERSAO: string = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8")).version;

export interface iSaude {
    ok: boolean;
    papel: tPapel;
    versao: string;
    banco: boolean;
    redis: boolean;
}

async function pingBanco(): Promise<boolean> {
    const conexao = new ConexaoPostgres();
    try {
        await conexao.open();
        await conexao.queryParam("SELECT 1", []);
        return true;
    } catch (erro) {
        console.error("[Saude] Banco indisponível:", (erro as Error).message);
        return false;
    } finally {
        await conexao.close();
    }
}

async function pingRedis(): Promise<boolean> {
    const limite = new Promise<never>((_, rejeitar) => {
        setTimeout(() => rejeitar(new Error("tempo esgotado")), 2_000).unref();
    });
    try {
        await Promise.race([redis().ping(), limite]);
        return true;
    } catch (erro) {
        console.error("[Saude] Redis indisponível:", (erro as Error).message);
        return false;
    }
}

export async function verificarSaude(): Promise<iSaude> {
    const [banco, redisOk] = await Promise.all([pingBanco(), pingRedis()]);
    return { ok: banco && redisOk, papel: config.papel, versao: VERSAO, banco, redis: redisOk };
}
