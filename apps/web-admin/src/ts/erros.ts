export class ErroDaApi extends Error {
    constructor(
        mensagem: string,
        public codigo?: string,
        public status?: number
    ) {
        super(mensagem);
        this.name = "ErroDaApi";
    }
}

interface RespostaBruta {
    response?: { status?: number; data?: unknown };
    request?: unknown;
}

// A tela reage ao `codigo` (sessão expirada, endereço repetido), nunca ao texto.
export function paraErroDaApi(erro: unknown): ErroDaApi {
    if (erro instanceof ErroDaApi) return erro;
    const bruto = erro as RespostaBruta;

    if (bruto?.response) {
        const { status, data } = bruto.response;
        const corpo = (typeof data === "object" && data !== null ? data : {}) as { msg?: unknown; codigo?: unknown };
        const mensagem = typeof corpo.msg === "string" && corpo.msg ? corpo.msg : `O servidor recusou o pedido (código ${status}).`;
        return new ErroDaApi(mensagem, typeof corpo.codigo === "string" ? corpo.codigo : undefined, status);
    }
    if (bruto?.request) return new ErroDaApi("Sem conexão com o servidor. Confira a internet e tente de novo.");
    return new ErroDaApi("Não conseguimos completar. Tente de novo.");
}
