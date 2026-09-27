import { chamar } from "../../../ts/api";
import type { RespostaPainel } from "../interfaces";

export function login(usuario: string, senha: string): Promise<{ token: string; nome: string }> {
    return chamar("painel", "login", { call: "login", login: usuario, senha });
}

// Sem `idEvento`, a estação mostra o evento acontecendo hoje.
export function getPainel(idEvento: number | null): Promise<RespostaPainel> {
    return chamar("painel", "painel", idEvento === null ? { call: "getPainel" } : { call: "getPainel", id_evento: idEvento });
}

export function reprocessar(alvo: { id_foto: number } | { id_evento: number }): Promise<{ reenfileiradas: number; sem_arquivo: number }> {
    return chamar("painel", "painel", { call: "reprocessar", ...alvo });
}

export function encerrarEvento(idEvento: number): Promise<{ encerrado: true }> {
    return chamar("painel", "painel", { call: "encerrarEvento", id_evento: idEvento });
}
