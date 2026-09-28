import axios from "axios";
import { ErroDaApi, paraErroDaApi } from "./erros";
import { sair, sessao } from "./sessao";

export { ErroDaApi };

const http = axios.create({ baseURL: "/api", timeout: 30_000 });

// Erro de negócio da API chega com HTTP 200 e `{ error: true }`.
function conferir<T>(dados: unknown): T {
    const corpo = dados as { error?: boolean; msg?: string };
    if (corpo?.error) throw new ErroDaApi(corpo.msg ?? "Não conseguimos completar. Tente de novo.");
    return dados as T;
}

async function enviar<T>(modulo: string, corpo: Record<string, unknown> | FormData): Promise<T> {
    try {
        const { data } = await http.post(`/admin/${modulo}`, corpo, {
            headers: sessao.value ? { Authorization: sessao.value.token } : undefined,
        });
        return conferir<T>(data);
    } catch (bruto) {
        const erro = paraErroDaApi(bruto);
        if (erro.codigo === "sessao_expirada") sair(erro.message);
        throw erro;
    }
}

export function chamar<T>(modulo: string, corpo: Record<string, unknown>): Promise<T> {
    return enviar<T>(modulo, corpo);
}

// Sem Content-Type manual: o axios precisa pôr o boundary do multipart.
export function chamarMultipart<T>(modulo: string, forma: FormData): Promise<T> {
    return enviar<T>(modulo, forma);
}
