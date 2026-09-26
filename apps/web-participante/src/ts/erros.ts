interface RespostaComMensagem {
    response?: { status?: number; data?: { msg?: string; error?: boolean } };
    request?: unknown;
}

// A API já escreve as mensagens para o participante, em português (por exemplo, os textos
// de selfie recusada vêm do próprio vision). Inventar texto aqui criaria duas versões da
// mesma frase; só cobrimos o que a API não tem como responder.
export function mensagemDeErro(erro: unknown): string {
    const bruto = erro as RespostaComMensagem;

    const daApi = bruto?.response?.data?.msg;
    if (typeof daApi === "string" && daApi.length > 0) return daApi;

    if (bruto?.request) return "Perdemos a conexão. Tente de novo.";

    return "Não conseguimos completar. Tente de novo.";
}
