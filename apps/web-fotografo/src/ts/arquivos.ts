// Mesmos teto e frase da estação (_FOTOGRAFO/upload/regras.ts): o fotógrafo lê a mesma
// explicação, venha a recusa daqui ou de lá.
const TAMANHO_MAXIMO_FOTO = 60 * 1024 * 1024;
const EXTENSAO_JPEG = /\.jpe?g$/i;

export interface ArquivoLido {
    arquivo: File;
    caminho: string;
}

export interface Filtrados {
    aceitos: { chave: string; arquivo: File }[];
    recusados: { nome: string; mensagem: string }[];
    ignorados: string[];
}

// O caminho entra na chave: duas câmeras gravam IMG_0001.JPG com o mesmo tamanho e a mesma
// hora, e só a pasta diferencia uma da outra.
export function chaveDoArquivo(arquivo: File, caminho: string): string {
    return `${caminho}|${arquivo.size}|${arquivo.lastModified}`;
}

export function filtrarArquivos(lista: ArquivoLido[]): Filtrados {
    const filtrados: Filtrados = { aceitos: [], recusados: [], ignorados: [] };
    for (const { arquivo, caminho } of lista) {
        // Arquivos do sistema (.DS_Store, ._IMG_0001.JPG do macOS) não são fotos de ninguém.
        if (arquivo.name.startsWith(".")) continue;
        // Quem fotografa em RAW + JPEG solta um .CR3 ao lado de cada .JPG: listar cada um como
        // erro encheria a tela. Eles viram uma linha só de resumo.
        if (!EXTENSAO_JPEG.test(arquivo.name)) {
            filtrados.ignorados.push(arquivo.name);
            continue;
        }
        if (arquivo.size > TAMANHO_MAXIMO_FOTO) {
            filtrados.recusados.push({ nome: arquivo.name, mensagem: "Foto maior que 60 MB." });
            continue;
        }
        filtrados.aceitos.push({ chave: chaveDoArquivo(arquivo, caminho), arquivo });
    }
    return filtrados;
}

interface EntradaArquivo {
    isFile: true;
    isDirectory: false;
    fullPath: string;
    file(ok: (arquivo: File) => void, falha?: (erro: unknown) => void): void;
}

interface EntradaPasta {
    isFile: false;
    isDirectory: true;
    createReader(): { readEntries(ok: (lote: Entrada[]) => void, falha?: (erro: unknown) => void): void };
}

type Entrada = EntradaArquivo | EntradaPasta;

async function percorrer(entrada: Entrada, lidos: ArquivoLido[]): Promise<void> {
    if (entrada.isFile) {
        const arquivo = await new Promise<File>((ok, falha) => entrada.file(ok, falha));
        lidos.push({ arquivo, caminho: entrada.fullPath.replace(/^\//, "") });
        return;
    }
    const leitor = entrada.createReader();
    // O navegador entrega o conteúdo da pasta em lotes (100 no Chrome): só acaba no lote vazio.
    for (;;) {
        const lote = await new Promise<Entrada[]>((ok, falha) => leitor.readEntries(ok, falha));
        if (lote.length === 0) return;
        for (const filho of lote) await percorrer(filho, lidos);
    }
}

// As entradas precisam ser pegas antes do primeiro `await`: o DataTransfer só vale durante
// o evento de soltar.
export async function lerSoltos(dados: DataTransfer): Promise<ArquivoLido[]> {
    const entradas = Array.from(dados.items ?? [])
        .map((item) => (item.webkitGetAsEntry?.() ?? null) as unknown as Entrada | null)
        .filter((e): e is Entrada => e !== null);

    if (entradas.length === 0) return Array.from(dados.files ?? []).map((arquivo) => ({ arquivo, caminho: arquivo.name }));

    const lidos: ArquivoLido[] = [];
    for (const entrada of entradas) await percorrer(entrada, lidos);
    return lidos;
}

export function deSelecionados(lista: FileList | File[]): ArquivoLido[] {
    return Array.from(lista).map((arquivo) => ({ arquivo, caminho: arquivo.webkitRelativePath || arquivo.name }));
}
