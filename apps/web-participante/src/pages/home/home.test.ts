import { beforeEach, describe, expect, test, vi } from "vitest";
import { actions, state } from "./home";
import { getEvento } from "../../ts/galeriaPublica";
import { memoriaDoEvento } from "../../ts/memoria";
import { ErroDaApi } from "../../ts/api";

vi.mock("../../ts/galeriaPublica", () => ({ getEvento: vi.fn(), getGaleria: vi.fn() }));
vi.mock("../../ts/memoria", () => ({ memoriaDoEvento: vi.fn() }));
const roteador = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("../../router", () => ({ router: roteador }));

const evento = {
    nome: "Correndo com Elas",
    data_inicio: "2026-09-26",
    data_fim: "2026-09-27",
    total_fotos: 2221,
    dias: [
        { dia: "2026-09-26", qtd: 1234 },
        { dia: "2026-09-27", qtd: 987 },
    ],
};

describe("home do evento", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(memoriaDoEvento).mockResolvedValue(null);
    });

    test("carrega o evento pelo slug e monta o caminho", async () => {
        vi.mocked(getEvento).mockResolvedValue(evento);

        await actions.init("correndo-com-elas", "");

        expect(state.evento?.nome).toBe("Correndo com Elas");
        expect(state.caminho).toBe("/e/correndo-com-elas");
        expect(state.carregando).toBe(false);
    });

    test("evento privado usa a chave e o caminho /p/", async () => {
        vi.mocked(getEvento).mockResolvedValue(evento);

        await actions.init("", "CHAVE123");

        expect(vi.mocked(getEvento)).toHaveBeenCalledWith({ slug: undefined, chaveAcesso: "CHAVE123" });
        expect(state.caminho).toBe("/p/CHAVE123");
    });

    test("com memória válida oferece 'Minhas fotos (N)'", async () => {
        vi.mocked(getEvento).mockResolvedValue(evento);
        vi.mocked(memoriaDoEvento).mockResolvedValue({
            token: "tok123",
            qtd_fotos: 7,
            validade_ate: null,
            selfie: null,
            criado_em: "2026-09-29T10:00:00.000Z",
        });

        await actions.init("correndo-com-elas", "");

        expect(state.tokenLembrado).toBe("tok123");
        expect(state.qtdLembrada).toBe(7);

        actions.irParaMinhasFotos();
        expect(roteador.push).toHaveBeenCalledWith({ name: "resultado", params: { token: "tok123" } });
    });

    test("evento não encontrado mostra a mensagem da API", async () => {
        vi.mocked(getEvento).mockRejectedValue(new ErroDaApi("Evento não encontrado. Confira o link."));

        await actions.init("nao-existe", "");

        expect(state.mensagem).toContain("não encontrado");
        expect(state.evento).toBeNull();
    });
});
