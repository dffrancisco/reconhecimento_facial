import { chamar, chamarMultipart } from "../../../ts/api";
import type { DadosEdicao, Evento, Fotografo, SituacaoEstacao, Vinculo } from "../interfaces";

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

export function listarVinculos(idEvento: number): Promise<Vinculo[]> {
    return chamar("fotografo", { call: "listarVinculos", id_evento: idEvento });
}

export function listarFotografos(): Promise<Fotografo[]> {
    return chamar("fotografo", { call: "listarFotografos" });
}

export function criarFotografo(nome: string, telefone: string | null): Promise<Fotografo> {
    return chamar("fotografo", { call: "criarFotografo", nome, telefone });
}

export function vincularFotografo(idEvento: number, idFotografo: number): Promise<unknown> {
    return chamar("fotografo", { call: "vincularFotografo", id_evento: idEvento, id_fotografo: idFotografo });
}

export function desvincularFotografo(idEventoFotografo: number): Promise<{ ok: true }> {
    return chamar("fotografo", { call: "desvincularFotografo", id_evento_fotografo: idEventoFotografo });
}

// null quando a estação nunca deu sinal para a VPS.
export function obterEstacao(): Promise<SituacaoEstacao | null> {
    return chamar("estacao", { call: "obterEstacao" });
}
