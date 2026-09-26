import axios from "axios";
import { ErroDaApi, paraErroDaApi } from "./erros";
import { lerSessao } from "./sessao";

export { ErroDaApi };

const http = axios.create({ baseURL: "/api", timeout: 30_000 });

// Erro de negócio da API chega com HTTP 200 e `{ error: true }`.
function conferir<T>(dados: unknown): T {
    const corpo = dados as { error?: boolean; msg?: string };
    if (corpo?.error) throw new ErroDaApi(corpo.msg ?? "Não conseguimos completar. Tente de novo.");
    return dados as T;
}

export async function chamar<T>(area: string, modulo: string, corpo: Record<string, unknown>): Promise<T> {
    const sessao = lerSessao();
    try {
        const { data } = await http.post(`/${area}/${modulo}`, corpo, {
            headers: sessao ? { Authorization: sessao.token } : undefined,
        });
        return conferir<T>(data);
    } catch (erro) {
        throw paraErroDaApi(erro);
    }
}
