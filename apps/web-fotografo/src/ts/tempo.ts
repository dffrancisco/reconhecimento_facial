export function tempoRestante(bytesRestantes: number, bytesPorSegundo: number): string {
    if (bytesPorSegundo <= 0 || bytesRestantes <= 0) return "—";
    const segundos = bytesRestantes / bytesPorSegundo;
    if (segundos < 60) return "menos de 1 min";
    return `cerca de ${Math.round(segundos / 60)} min`;
}

const ALERTA_MS = 60_000;

// Depois de 1 minuto sem a estação, o aviso fica vermelho e o título da aba muda: o fotógrafo
// pode estar em outra aba e precisa perceber que talvez seja a estação que caiu.
export function estadoConexao(semConexaoDesde: number | null, agora: number): "conectado" | "tentando" | "alerta" {
    if (semConexaoDesde === null) return "conectado";
    return agora - semConexaoDesde > ALERTA_MS ? "alerta" : "tentando";
}
