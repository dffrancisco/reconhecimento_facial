const MAXIMO = 80;

// Mesmo formato que a API aceita: minúsculas, números e hífen, sem hífen nas pontas.
export function enderecoDoNome(texto: string): string {
    return texto
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, MAXIMO)
        .replace(/-+$/, "");
}
