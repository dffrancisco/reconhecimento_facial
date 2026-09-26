import { randomBytes } from "node:crypto";

export function gerarChave(bytes = 20): string {
    return randomBytes(bytes).toString("hex");
}
