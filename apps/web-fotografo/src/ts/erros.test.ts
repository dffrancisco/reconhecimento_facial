import { describe, expect, test } from "vitest";
import { paraErroDaApi } from "./erros";

describe("paraErroDaApi", () => {
    test("422 com código: a tela recebe a mensagem e o código", () => {
        const e = paraErroDaApi({ response: { status: 422, data: { msg: "Este link não aceita mais fotos.", codigo: "link_invalido" } } });

        expect(e.message).toBe("Este link não aceita mais fotos.");
        expect(e.codigo).toBe("link_invalido");
        expect(e.status).toBe(422);
        expect(e.semConexao).toBe(false);
    });

    test("507 da estação sem espaço traz o código para parar a fila inteira", () => {
        const e = paraErroDaApi({ response: { status: 507, data: { msg: "A estação está sem espaço em disco.", codigo: "sem_espaco" } } });
        expect(e.codigo).toBe("sem_espaco");
    });

    test("sem resposta nenhuma é falta de conexão, não erro da foto", () => {
        const e = paraErroDaApi({ request: {}, message: "Network Error" });

        expect(e.semConexao).toBe(true);
        expect(e.message).toBe("Sem conexão com a estação.");
    });

    test("resposta sem mensagem (413, 502) não se passa por falta de conexão", () => {
        // O axios põe `request` também quando há resposta: olhar `request` primeiro
        // transformaria um 413 em "sem conexão" e o reenvio repetiria o mesmo erro para sempre.
        const e = paraErroDaApi({ request: {}, response: { status: 413, data: "Payload Too Large" } });

        expect(e.semConexao).toBe(false);
        expect(e.status).toBe(413);
        expect(e.message).toBe("A estação recusou o envio (código 413).");
    });

    test("erro de negócio com HTTP 200 vira erro com a mensagem da API", () => {
        const e = paraErroDaApi({ response: { status: 200, data: { msg: "Token obrigatório", error: true } } });
        expect(e.message).toBe("Token obrigatório");
    });
});
