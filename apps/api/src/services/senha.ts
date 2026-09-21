import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const TAMANHO_HASH = 64;

export async function gerarHashSenha(senha: string): Promise<string> {
    const salt = randomBytes(16);
    const hash = (await scryptAsync(senha, salt, TAMANHO_HASH)) as Buffer;
    return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function conferirSenha(senha: string, hashArmazenado: string): Promise<boolean> {
    const partes = hashArmazenado.split("$");
    if (partes.length !== 3 || partes[0] !== "scrypt") return false;

    const salt = Buffer.from(partes[1], "hex");
    const esperado = Buffer.from(partes[2], "hex");
    if (esperado.length !== TAMANHO_HASH) return false;

    const calculado = (await scryptAsync(senha, salt, TAMANHO_HASH)) as Buffer;
    return timingSafeEqual(calculado, esperado);
}
