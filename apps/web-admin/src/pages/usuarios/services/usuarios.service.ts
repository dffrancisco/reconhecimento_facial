import { chamar } from "../../../ts/api";
import type { Usuario } from "../interfaces";

// Na API o usuário do admin se chama operador.
export function listarUsuarios(): Promise<Usuario[]> {
    return chamar("operador", { call: "listarOperadores" });
}

export function criarUsuario(nome: string, login: string, senha: string): Promise<{ id_operador: number }> {
    return chamar("operador", { call: "criarOperador", nome, login, senha });
}

// A API grava nome e login juntos (SET fixo): os dois vão sempre.
export function alterarUsuario(idOperador: number, nome: string, login: string): Promise<{ ok: true }> {
    return chamar("operador", { call: "alterarOperador", id_operador: idOperador, nome, login });
}

// `token` só vem na troca da própria senha: a sessão antiga deixa de valer.
export function trocarSenha(idOperador: number, senha: string): Promise<{ ok: true; token?: string }> {
    return chamar("operador", { call: "trocarSenha", id_operador: idOperador, senha });
}

export function excluirUsuario(idOperador: number): Promise<{ ok: true }> {
    return chamar("operador", { call: "excluirOperador", id_operador: idOperador });
}
