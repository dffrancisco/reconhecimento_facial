import axios from "axios";
import { mensagemDeErro } from "./erros";

export class ErroDaApi extends Error {
    constructor(mensagem: string) {
        super(mensagem);
        this.name = "ErroDaApi";
    }
}

const http = axios.create({ baseURL: "/api", timeout: 30_000 });

// O erro de negócio da API chega com HTTP 200 e `{ error: true }`: sem este tratamento,
// a tela seguiria como se tivesse dado certo.
function conferir<T>(dados: unknown): T {
    const corpo = dados as { error?: boolean; msg?: string };
    if (corpo?.error) throw new ErroDaApi(corpo.msg ?? "Não conseguimos completar. Tente de novo.");
    return dados as T;
}

export async function chamar<T>(area: string, modulo: string, corpo: Record<string, unknown>): Promise<T> {
    try {
        const { data } = await http.post(`/${area}/${modulo}`, corpo);
        return conferir<T>(data);
    } catch (erro) {
        if (erro instanceof ErroDaApi) throw erro;
        throw new ErroDaApi(mensagemDeErro(erro));
    }
}

export async function chamarMultipart<T>(area: string, modulo: string, forma: FormData): Promise<T> {
    try {
        // Sem Content-Type manual: o axios precisa pôr o boundary do multipart.
        const { data } = await http.post(`/${area}/${modulo}`, forma, { timeout: 60_000 });
        return conferir<T>(data);
    } catch (erro) {
        if (erro instanceof ErroDaApi) throw erro;
        throw new ErroDaApi(mensagemDeErro(erro));
    }
}
