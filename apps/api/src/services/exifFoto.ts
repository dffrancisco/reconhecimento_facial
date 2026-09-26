import exifr from "exifr";

export interface DadosExif {
    dataOriginal?: Date;
    offsetOriginal?: string;
    make?: string;
    model?: string;
}

export async function lerExif(caminho: string): Promise<DadosExif> {
    try {
        const dados = await exifr.parse(caminho, { pick: ["DateTimeOriginal", "OffsetTimeOriginal", "Make", "Model"] });
        return {
            dataOriginal: dados?.DateTimeOriginal instanceof Date ? dados.DateTimeOriginal : undefined,
            offsetOriginal: typeof dados?.OffsetTimeOriginal === "string" ? dados.OffsetTimeOriginal : undefined,
            make: dados?.Make,
            model: dados?.Model,
        };
    } catch {
        // JPEG sem EXIF legível: segue sem essas informações, não é motivo para falhar a etapa.
        return {};
    }
}

function converterOffset(offset: string): number {
    const m = offset.match(/^([+-])(\d{2}):(\d{2})$/);
    if (!m) return 0;
    const sinal = m[1] === "-" ? -1 : 1;
    return sinal * (Number(m[2]) * 60 + Number(m[3]));
}

function offsetDoFuso(fuso: string, aproximado: Date): number {
    const partes = new Intl.DateTimeFormat("en-US", { timeZone: fuso, timeZoneName: "shortOffset" }).formatToParts(aproximado);
    const nome = partes.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
    const m = nome.match(/GMT([+-]\d+)(?::(\d+))?/);
    if (!m) return 0;
    const horas = Number(m[1]);
    const minutos = Number(m[2] ?? 0);
    return horas * 60 + (horas < 0 ? -minutos : minutos);
}

// `dataOriginal` vem do exifr como "hora de parede" (os getters locais refletem exatamente os
// números do EXIF, não importa o fuso do processo — é assim que o exifr constrói o Date). Por
// isso lemos com os getters locais, não com os UTC.
export function combinarDataExif(dataOriginal: Date | undefined, offsetOriginal: string | undefined, fuso: string): Date | null {
    if (!dataOriginal) return null;

    const partes = {
        ano: dataOriginal.getFullYear(),
        mes: dataOriginal.getMonth(),
        dia: dataOriginal.getDate(),
        hora: dataOriginal.getHours(),
        min: dataOriginal.getMinutes(),
        seg: dataOriginal.getSeconds(),
    };
    const instanteAproximado = new Date(Date.UTC(partes.ano, partes.mes, partes.dia, partes.hora, partes.min, partes.seg));
    const offsetMin = offsetOriginal ? converterOffset(offsetOriginal) : offsetDoFuso(fuso, instanteAproximado);

    return new Date(instanteAproximado.getTime() - offsetMin * 60_000);
}
