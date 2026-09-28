import { ConfigEvento, LinhaEvento, LinksEvento } from "./i.evento";

const NOME_MAXIMO = 150;
const ORGANIZADOR_MAXIMO = 120;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

// Confere também se o dia existe: 2026-02-30 passa no formato e não é data.
function dataValida(valor: unknown): valor is string {
    if (typeof valor !== "string" || !DATA.test(valor)) return false;
    const d = new Date(`${valor}T12:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valor;
}

export function validarNome(nome: unknown): string | null {
    if (typeof nome !== "string" || !nome.trim()) return "Informe o nome do evento.";
    return nome.trim().length > NOME_MAXIMO ? "O nome do evento deve ter até 150 caracteres." : null;
}

export function validarDatas(inicio: unknown, fim: unknown): string | null {
    if (!dataValida(fim)) return "Data de fim inválida.";
    if (inicio === null) return null;
    if (!dataValida(inicio)) return "Data de início inválida.";
    // YYYY-MM-DD em texto compara na ordem certa.
    return inicio > fim ? "O fim do evento não pode ser antes do início." : null;
}

const inteiroEntre = (valor: unknown, min: number, max: number): valor is number =>
    typeof valor === "number" && Number.isInteger(valor) && valor >= min && valor <= max;

// A config é jsonb: só os campos conhecidos entram, e cada um na sua faixa (spec §3.4).
export function validarConfig(bruto: unknown): { valores: Partial<ConfigEvento> } | { erro: string } {
    if (bruto === undefined || bruto === null) return { valores: {} };
    if (typeof bruto !== "object" || Array.isArray(bruto)) return { erro: "Configuração do evento inválida." };
    const c = bruto as Record<string, unknown>;
    const valores: Partial<ConfigEvento> = {};

    if ("limiar" in c) {
        if (typeof c.limiar !== "number" || !(c.limiar >= 0.2 && c.limiar <= 0.8))
            return { erro: "O limiar de semelhança deve ficar entre 0,20 e 0,80." };
        valores.limiar = c.limiar;
    }
    if ("exigir_whatsapp" in c) {
        if (typeof c.exigir_whatsapp !== "boolean") return { erro: "Exigir WhatsApp deve ser sim ou não." };
        valores.exigir_whatsapp = c.exigir_whatsapp;
    }
    if ("marca_dagua" in c) {
        if (typeof c.marca_dagua !== "boolean") return { erro: "Marca d'água deve ser sim ou não." };
        valores.marca_dagua = c.marca_dagua;
    }
    if ("organizador" in c) {
        const organizador = typeof c.organizador === "string" ? c.organizador.trim() : "";
        if (!organizador || organizador.length > ORGANIZADOR_MAXIMO) return { erro: "Informe o nome do organizador (até 120 caracteres)." };
        valores.organizador = organizador;
    }
    if ("max_selfies" in c) {
        if (!inteiroEntre(c.max_selfies, 1, 5)) return { erro: "O máximo de selfies deve ser de 1 a 5." };
        valores.max_selfies = c.max_selfies;
    }
    if ("dias_expurgo" in c) {
        if (!inteiroEntre(c.dias_expurgo, 1, 3650)) return { erro: "Os dias até apagar o evento devem ser de 1 a 3650." };
        valores.dias_expurgo = c.dias_expurgo;
    }
    if ("validade_resultado_dias" in c) {
        const validade = c.validade_resultado_dias;
        if (validade !== null && !inteiroEntre(validade, 1, 3650))
            return { erro: "A validade do resultado deve ficar vazia ou ser de 1 a 3650 dias." };
        valores.validade_resultado_dias = validade;
    }
    return { valores };
}

export function montarLinks(
    endereco: string | null,
    evento: Pick<LinhaEvento, "privado" | "slug" | "chave_acesso" | "chave_anfitriao">
): LinksEvento | null {
    if (!endereco) return null;
    const participante =
        evento.privado === "S" && evento.chave_acesso ? `${endereco}/#/p/${evento.chave_acesso}` : `${endereco}/#/e/${evento.slug}`;
    return { participante, anfitriao: `${endereco}/#/a/${evento.chave_anfitriao}` };
}

// `evento_slug_key` é o nome que o Postgres dá ao UNIQUE da coluna slug (migration de cadastros).
export function slugRepetido(erro: unknown): boolean {
    const e = erro as { code?: unknown; constraint?: unknown } | null;
    return e?.code === "23505" && e?.constraint === "evento_slug_key";
}
