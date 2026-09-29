const FORMATO_DIA = /^\d{4}-\d{2}-\d{2}$/;

export function diaValido(dia: unknown): dia is string {
    return typeof dia === "string" && FORMATO_DIA.test(dia);
}
