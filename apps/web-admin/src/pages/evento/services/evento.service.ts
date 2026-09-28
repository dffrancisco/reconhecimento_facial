import { chamar, chamarMultipart } from "../../../ts/api";
import type { DadosEdicao, Evento } from "../interfaces";

export function obterEvento(idEvento: number): Promise<Evento> {
    return chamar("evento", { call: "obterEvento", id_evento: idEvento });
}

export function editarEvento(idEvento: number, dados: DadosEdicao): Promise<Evento> {
    return chamar("evento", { call: "editarEvento", id_evento: idEvento, ...dados });
}

export function subirMarcaDagua(idEvento: number, arquivo: File): Promise<{ ok: true }> {
    const forma = new FormData();
    forma.append("call", "subirMarcaDagua");
    forma.append("id_evento", String(idEvento));
    forma.append("logo", arquivo);
    return chamarMultipart("evento", forma);
}
