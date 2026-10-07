import { chamar } from "../../../ts/api";

export function login(usuario: string, senha: string): Promise<{ token: string; nome: string; id_operador: number }> {
    return chamar("login", { call: "login", login: usuario, senha });
}
