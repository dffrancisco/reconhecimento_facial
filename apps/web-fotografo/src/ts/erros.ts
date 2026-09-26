export class ErroDaApi extends Error {
    constructor(
        mensagem: string,
        public codigo?: string,
        public status?: number,
        public semConexao = false
    ) {
        super(mensagem);
        this.name = "ErroDaApi";
    }
}

interface RespostaBruta {
    response?: { status?: number; data?: unknown };
    request?: unknown;
}

// A tela reage ao `codigo` (link fechado, sem espaço, foto que não é JPEG), nunca ao texto.
// `response` vem antes de `request`: o axios põe os dois quando há resposta, e um 413 lido
// como "sem conexão" faria a fila reenviar o mesmo pedaço para sempre.
export function paraErroDaApi(erro: unknown): ErroDaApi {
    if (erro instanceof ErroDaApi) return erro;
    const bruto = erro as RespostaBruta;

    if (bruto?.response) {
        const { status, data } = bruto.response;
        const corpo = (typeof data === "object" && data !== null ? data : {}) as { msg?: unknown; codigo?: unknown };
        const mensagem = typeof corpo.msg === "string" && corpo.msg ? corpo.msg : `A estação recusou o envio (código ${status}).`;
        return new ErroDaApi(mensagem, typeof corpo.codigo === "string" ? corpo.codigo : undefined, status);
    }
    if (bruto?.request) return new ErroDaApi("Sem conexão com a estação.", undefined, undefined, true);
    return new ErroDaApi("Não conseguimos completar. Tente de novo.");
}
