import { chamar } from "../../../ts/api";
import type { RespostaPainel } from "../interfaces";

export function login(usuario: string, senha: string): Promise<{ token: string; nome: string }> {
    return chamar("painel", "login", { call: "login", login: usuario, senha });
}

export function getPainel(): Promise<RespostaPainel> {
    return chamar("painel", "painel", { call: "getPainel" });
}

export function reprocessar(idFoto?: number): Promise<{ reenfileiradas: number; sem_arquivo: number }> {
    return chamar("painel", "painel", idFoto === undefined ? { call: "reprocessar" } : { call: "reprocessar", id_foto: idFoto });
}

export function encerrarEvento(idEvento: number): Promise<{ encerrado: true }> {
    return chamar("painel", "painel", { call: "encerrarEvento", id_evento: idEvento });
}
