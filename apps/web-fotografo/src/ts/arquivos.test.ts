import { describe, expect, test } from "vitest";
import { chaveDoArquivo, filtrarArquivos, lerSoltos } from "./arquivos";

const arquivo = (nome: string, bytes = 10, lastModified = 1) => new File([new Uint8Array(bytes)], nome, { lastModified });

describe("filtrarArquivos", () => {
    test("JPEG entra, com qualquer caixa na extensão", () => {
        const r = filtrarArquivos([
            { arquivo: arquivo("IMG_1.JPG"), caminho: "IMG_1.JPG" },
            { arquivo: arquivo("b.jpeg"), caminho: "b.jpeg" },
        ]);
        expect(r.aceitos.map((a) => a.arquivo.name)).toEqual(["IMG_1.JPG", "b.jpeg"]);
    });

    test("RAW e outros formatos são ignorados num resumo, e não viram centenas de erros", () => {
        // Quem fotografa em RAW + JPEG solta a pasta com um .CR3 ao lado de cada .JPG.
        const r = filtrarArquivos([
            { arquivo: arquivo("IMG_1.CR3"), caminho: "IMG_1.CR3" },
            { arquivo: arquivo("capa.png"), caminho: "capa.png" },
            { arquivo: arquivo("IMG_1.JPG"), caminho: "IMG_1.JPG" },
        ]);
        expect(r.ignorados).toEqual(["IMG_1.CR3", "capa.png"]);
        expect(r.recusados).toEqual([]);
        expect(r.aceitos).toHaveLength(1);
    });

    test("arquivo oculto do sistema some sem aviso", () => {
        const r = filtrarArquivos([
            { arquivo: arquivo(".DS_Store"), caminho: "cartao/.DS_Store" },
            { arquivo: arquivo("._IMG_1.JPG"), caminho: "cartao/._IMG_1.JPG" },
        ]);
        expect(r).toEqual({ aceitos: [], recusados: [], ignorados: [] });
    });

    test("JPEG acima de 60 MB é recusado com a mesma frase da estação", () => {
        const grande = { size: 61 * 1024 * 1024, name: "gigante.jpg", lastModified: 1 } as File;
        const r = filtrarArquivos([{ arquivo: grande, caminho: "gigante.jpg" }]);
        expect(r.recusados).toEqual([{ nome: "gigante.jpg", mensagem: "Foto maior que 60 MB." }]);
    });
});

describe("chaveDoArquivo", () => {
    test("duas câmeras com o mesmo IMG_0001.JPG em pastas diferentes não se confundem", () => {
        const a = arquivo("IMG_0001.JPG", 10, 5);
        const b = arquivo("IMG_0001.JPG", 10, 5);
        expect(chaveDoArquivo(a, "camA/IMG_0001.JPG")).not.toBe(chaveDoArquivo(b, "camB/IMG_0001.JPG"));
        expect(chaveDoArquivo(a, "camA/IMG_0001.JPG")).toBe(chaveDoArquivo(b, "camA/IMG_0001.JPG"));
    });
});

// Entradas falsas no formato do webkitGetAsEntry do navegador.
function arquivoFalso(caminho: string) {
    const nome = caminho.split("/").pop()!;
    return { isFile: true, isDirectory: false, name: nome, fullPath: `/${caminho}`, file: (ok: (f: File) => void) => ok(arquivo(nome)) };
}

function pastaFalsa(caminho: string, filhos: unknown[], porLote = 2) {
    return {
        isFile: false,
        isDirectory: true,
        name: caminho.split("/").pop(),
        fullPath: `/${caminho}`,
        createReader() {
            let lido = 0;
            // O navegador entrega a pasta em lotes; só para quando vem um lote vazio.
            return {
                readEntries(ok: (lote: unknown[]) => void) {
                    ok(filhos.slice(lido, lido + porLote));
                    lido += porLote;
                },
            };
        },
    };
}

describe("lerSoltos", () => {
    test("lê a pasta solta inteira, com subpastas e em vários lotes", async () => {
        const raiz = pastaFalsa("cartao", [
            arquivoFalso("cartao/a.jpg"),
            arquivoFalso("cartao/b.jpg"),
            arquivoFalso("cartao/c.jpg"),
            pastaFalsa("cartao/sub", [arquivoFalso("cartao/sub/d.jpg")]),
        ]);
        const dados = { items: [{ webkitGetAsEntry: () => raiz }], files: [] } as unknown as DataTransfer;

        const lidos = await lerSoltos(dados);

        expect(lidos.map((l) => l.caminho)).toEqual(["cartao/a.jpg", "cartao/b.jpg", "cartao/c.jpg", "cartao/sub/d.jpg"]);
    });

    test("sem suporte a pastas, usa os arquivos soltos", async () => {
        const f = arquivo("x.jpg");
        const dados = { items: [], files: [f] } as unknown as DataTransfer;
        expect(await lerSoltos(dados)).toEqual([{ arquivo: f, caminho: "x.jpg" }]);
    });
});
