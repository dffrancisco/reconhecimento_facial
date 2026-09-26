import { describe, expect, test } from "vitest";
import { ErroDaApi } from "../../../ts/erros";
import { falhaDaChamada, falhaDoPedaco } from "./traducao";

describe("falhaDoPedaco — resposta do PUT vira tipo de falha da fila", () => {
    test("sem resposta é falta de conexão", () => {
        expect(falhaDoPedaco(0, null).tipo).toBe("sem_conexao");
    });

    test("409 devolve o byte de onde continuar", () => {
        const f = falhaDoPedaco(409, { bytes_recebidos: 16 });
        expect(f.tipo).toBe("fora_de_ordem");
        expect(f.bytesRecebidos).toBe(16);
    });

    test("link fechado, evento encerrado e disco cheio param a fila inteira", () => {
        expect(falhaDoPedaco(422, { msg: "x", codigo: "link_invalido" }).tipo).toBe("estacao");
        expect(falhaDoPedaco(422, { msg: "x", codigo: "evento_encerrado" }).tipo).toBe("estacao");
        expect(falhaDoPedaco(507, { msg: "A estação está sem espaço em disco.", codigo: "sem_espaco" }).tipo).toBe("estacao");
    });

    test("foto que chegou diferente é reenviada; foto que não é JPEG é recusada de vez", () => {
        expect(falhaDoPedaco(422, { msg: "x", codigo: "hash_diferente" }).tipo).toBe("hash_diferente");
        const naoJpeg = falhaDoPedaco(422, { msg: "Não é JPEG — exporte em JPEG para enviar.", codigo: "nao_e_jpeg" });
        expect(naoJpeg.tipo).toBe("recusada");
        expect(naoJpeg.message).toBe("Não é JPEG — exporte em JPEG para enviar.");
    });

    test("erro do servidor naquela foto é tentado de novo", () => {
        const f = falhaDoPedaco(500, { msg: "Erro ao processar sua solicitação" });
        expect(f.tipo).toBe("foto");
        expect(falhaDoPedaco(502, "Bad Gateway").message).toBe("A estação recusou o envio (código 502).");
    });
});

describe("falhaDaChamada — erro do iniciarUpload vira tipo de falha da fila", () => {
    test("sem conexão, link fechado e recusa da validação", () => {
        expect(falhaDaChamada(new ErroDaApi("Sem conexão com a estação.", undefined, undefined, true)).tipo).toBe("sem_conexao");
        expect(falhaDaChamada(new ErroDaApi("fechado", "evento_encerrado", 422)).tipo).toBe("estacao");
        // 422 sem código no início é a validação (extensão, tamanho): não adianta repetir.
        expect(falhaDaChamada(new ErroDaApi("Foto maior que 60 MB.", undefined, 422)).tipo).toBe("recusada");
        expect(falhaDaChamada(new ErroDaApi("erro", undefined, 500)).tipo).toBe("foto");
    });
});
