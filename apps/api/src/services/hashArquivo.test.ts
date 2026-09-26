import { test, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { calcularHashArquivo } from "./hashArquivo";

let pasta: string;

before(async () => {
    pasta = await fs.mkdtemp(path.join(os.tmpdir(), "hash-teste-"));
});

test("calcula o SHA-256 igual ao node:crypto direto", async () => {
    const caminho = path.join(pasta, "arquivo.bin");
    const conteudo = Buffer.from("conteudo de teste para o hash");
    await fs.writeFile(caminho, conteudo);

    const esperado = createHash("sha256").update(conteudo).digest("hex");
    assert.strictEqual(await calcularHashArquivo(caminho), esperado);
});

test("rejeita para arquivo inexistente", async () => {
    await assert.rejects(() => calcularHashArquivo(path.join(pasta, "nao-existe.bin")));
});

after(async () => {
    await fs.rm(pasta, { recursive: true, force: true });
});
