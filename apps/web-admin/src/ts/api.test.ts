import { beforeEach, describe, expect, test, vi } from "vitest";

const post = vi.hoisted(() => vi.fn());
vi.mock("axios", () => ({ default: { create: () => ({ post }) } }));

import { chamar } from "./api";
import { ErroDaApi } from "./erros";
import { aviso, entrarComo, sessao } from "./sessao";

beforeEach(() => {
    post.mockReset();
    localStorage.clear();
    entrarComo({ token: "tok", nome: "Ana" });
});

describe("chamar", () => {
    test("manda o token cru no Authorization e o corpo com call", async () => {
        post.mockResolvedValue({ data: [{ id_evento: 1 }] });

        const r = await chamar("evento", { call: "listarEventos" });

        expect(r).toEqual([{ id_evento: 1 }]);
        expect(post).toHaveBeenCalledWith("/admin/evento", { call: "listarEventos" }, { headers: { Authorization: "tok" } });
    });

    test("erro de negócio com HTTP 200 vira ErroDaApi", async () => {
        post.mockResolvedValue({ data: { error: true, msg: "Campo nome é obrigatório" } });
        await expect(chamar("evento", { call: "criarEvento" })).rejects.toThrow("Campo nome é obrigatório");
    });

    test("sessão expirada apaga a sessão e guarda o motivo para a entrada", async () => {
        post.mockRejectedValue({ response: { status: 422, data: { msg: "Sessão expirada, faça login novamente.", codigo: "sessao_expirada" } } });

        await expect(chamar("evento", { call: "listarEventos" })).rejects.toBeInstanceOf(ErroDaApi);

        expect(sessao.value).toBeNull();
        expect(localStorage.getItem("sessao_admin")).toBeNull();
        expect(aviso.value).toBe("Sessão expirada, faça login novamente.");
    });

    test("sem resposta é falta de conexão", async () => {
        post.mockRejectedValue({ request: {} });
        await expect(chamar("evento", { call: "listarEventos" })).rejects.toThrow("Sem conexão com o servidor");
    });
});
