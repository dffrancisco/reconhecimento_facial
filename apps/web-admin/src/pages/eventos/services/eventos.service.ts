import { chamar } from "../../../ts/api";
import type { EventoDaLista } from "../interfaces";

export function listarEventos(): Promise<EventoDaLista[]> {
    return chamar("evento", { call: "listarEventos" });
}
