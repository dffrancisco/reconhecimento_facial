import { describe, expect, test } from "vitest";
import { mensagemDeErro } from "./erros";

describe("mensagemDeErro", () => {
    test("usa a mensagem da API no 422", () => {
        const erro = { response: { status: 422, data: { msg: "Não encontramos um rosto na foto." } } };
        expect(mensagemDeErro(erro)).toBe("Não encontramos um rosto na foto.");
    });

    test("usa a mensagem do erro de negócio", () => {
        const erro = { response: { status: 200, data: { msg: "Mande ao menos uma selfie", error: true } } };
        expect(mensagemDeErro(erro)).toBe("Mande ao menos uma selfie");
    });

    test("falha de rede vira mensagem própria, sem jargão", () => {
        // A pessoa está no meio da rua com sinal ruim: precisa saber que pode tentar de novo.
        const erro = { request: {}, message: "Network Error" };
        expect(mensagemDeErro(erro)).toBe("Perdemos a conexão. Tente de novo.");
    });

    test("erro 500 não expõe detalhe técnico", () => {
        const erro = { response: { status: 500, data: { msg: "Erro ao processar sua solicitação" } } };
        expect(mensagemDeErro(erro)).toBe("Erro ao processar sua solicitação");
    });

    test("erro sem forma conhecida ainda devolve algo utilizável", () => {
        expect(mensagemDeErro(new Error("boom"))).toBe("Não conseguimos completar. Tente de novo.");
    });
});
