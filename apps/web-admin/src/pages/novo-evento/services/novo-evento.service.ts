import { chamar } from "../../../ts/api";
import type { NovoEvento } from "../interfaces";

export function criarEvento(dados: NovoEvento): Promise<{ id_evento: number }> {
    return chamar("evento", { call: "criarEvento", ...dados });
}
