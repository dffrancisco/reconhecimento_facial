import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export function calcularHashArquivo(caminho: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = createHash("sha256");
        const leitura = createReadStream(caminho);
        leitura.on("data", (pedaco) => hash.update(pedaco));
        leitura.on("error", reject);
        leitura.on("end", () => resolve(hash.digest("hex")));
    });
}
