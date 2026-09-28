import { chamar } from "../../../ts/api";

export function login(usuario: string, senha: string): Promise<{ token: string; nome: string }> {
    return chamar("login", { call: "login", login: usuario, senha });
}
