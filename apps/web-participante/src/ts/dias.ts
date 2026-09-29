const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// "2026-09-26" → "Sáb 26/09". Montado por partes: new Date(ano, mes - 1, dia)
// passa o contexto local, não UTC.
export function rotuloDoDia(dia: string): string {
    const [ano, mes, diaNum] = dia.split("-").map(Number);
    if (!ano || !mes || !diaNum) return dia;
    const data = new Date(ano, mes - 1, diaNum);
    return `${DIAS_SEMANA[data.getDay()]} ${String(diaNum).padStart(2, "0")}/${String(mes).padStart(2, "0")}`;
}

// As datas chegam da API como "AAAA-MM-DD" (to_char no SQL, justamente para este split).
export function periodoParaTela(inicio: string | null, fim: string): string {
    const paraTela = (data: string) => data.split("-").reverse().join("/");
    if (!inicio || inicio === fim) return paraTela(fim);
    const [anoI, mesI, diaI] = inicio.split("-");
    const [anoF, mesF, diaF] = fim.split("-");
    if (anoI === anoF && mesI === mesF) return `${diaI} e ${diaF}/${mesF}/${anoF}`;
    return `${paraTela(inicio)} a ${paraTela(fim)}`;
}
