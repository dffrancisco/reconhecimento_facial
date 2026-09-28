// Montado do texto, sem `Date`: "2026-09-26" viraria o dia 25 no fuso do Brasil.
export function dataBr(ymd: string): string {
    return ymd.split("-").reverse().join("/");
}

export function periodo(inicio: string | null, fim: string): string {
    return inicio && inicio !== fim ? `${dataBr(inicio)} a ${dataBr(fim)}` : dataBr(fim);
}

// "Hoje" no relógio do computador do operador, em YYYY-MM-DD.
export function hoje(agora = new Date()): string {
    const d = (n: number) => String(n).padStart(2, "0");
    return `${agora.getFullYear()}-${d(agora.getMonth() + 1)}-${d(agora.getDate())}`;
}

export function fimAntesDoInicio(inicio: string, fim: string): boolean {
    return Boolean(inicio && fim && fim < inicio);
}
