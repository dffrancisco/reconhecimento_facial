import { beforeEach, describe, expect, test, vi } from "vitest";
import { actions, state } from "./galeria";
import { getEvento, getGaleria } from "../../ts/galeriaPublica";
import { baixarArquivo } from "../../ts/arquivos";

vi.mock("../../ts/galeriaPublica", () => ({ getEvento: vi.fn(), getGaleria: vi.fn() }));
vi.mock("../../ts/arquivos", () => ({ baixarArquivo: vi.fn() }));
vi.mock("../../ts/compartilhar", () => ({ podeCompartilharArquivos: () => false, compartilharFoto: vi.fn() }));
const roteador = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("../../router", () => ({ router: roteador }));

const eventoDoisDias = {
    nome: "Correndo com Elas",
    data_inicio: "2026-09-26",
    data_fim: "2026-09-27",
    total_fotos: 3,
    dias: [
        { dia: "2026-09-26", qtd: 2 },
        { dia: "2026-09-27", qtd: 1 },
    ],
    capa: null,
};

const fotos = (ids: number[]) =>
    ids.map((id) => ({ id_foto: id, thumb: `/arquivos/7/${id}_thumb.jpg?md5=x`, web: `/arquivos/7/${id}_web.jpg?md5=x` }));

describe("galeria pública", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getGaleria).mockResolvedValue({ fotos: fotos([1, 2]) });
    });

    test("dois dias: primeiro dia ativo e filtro na chamada", async () => {
        vi.mocked(getEvento).mockResolvedValue(eventoDoisDias);

        await actions.init("correndo-com-elas", "");

        expect(state.dias).toHaveLength(2);
        expect(state.diaAtivo).toBe("2026-09-26");
        expect(vi.mocked(getGaleria)).toHaveBeenCalledWith({ slug: "correndo-com-elas", chaveAcesso: undefined }, 0, "2026-09-26");
    });

    test("um dia só: sem chips e sem filtro", async () => {
        vi.mocked(getEvento).mockResolvedValue({ ...eventoDoisDias, dias: [{ dia: "2026-09-27", qtd: 3 }] });

        await actions.init("correndo-com-elas", "");

        expect(state.diaAtivo).toBeNull();
        expect(vi.mocked(getGaleria)).toHaveBeenCalledWith({ slug: "correndo-com-elas", chaveAcesso: undefined }, 0, undefined);
    });

    test("trocar de dia zera a grade e recomeça do offset 0", async () => {
        vi.mocked(getEvento).mockResolvedValue(eventoDoisDias);
        await actions.init("correndo-com-elas", "");
        vi.mocked(getGaleria).mockClear();
        vi.mocked(getGaleria).mockResolvedValue({ fotos: fotos([9]) });

        await actions.trocarDia("2026-09-27");

        expect(state.fotos.map((f) => f.id_foto)).toEqual([9]);
        expect(vi.mocked(getGaleria)).toHaveBeenCalledWith(expect.anything(), 0, "2026-09-27");
    });

    test("'Ver mais' mantém o dia e soma o offset", async () => {
        vi.mocked(getEvento).mockResolvedValue(eventoDoisDias);
        await actions.init("correndo-com-elas", "");
        vi.mocked(getGaleria).mockClear();
        vi.mocked(getGaleria).mockResolvedValue({ fotos: fotos([3]) });

        await actions.carregarMais();

        expect(vi.mocked(getGaleria)).toHaveBeenCalledWith(expect.anything(), 2, "2026-09-26");
        expect(state.acabou).toBe(true); // 1 < 60: última página
    });

    test("o total do dia escolhido vai para o contador da foto aberta", async () => {
        vi.mocked(getEvento).mockResolvedValue(eventoDoisDias);
        await actions.init("correndo-com-elas", "");
        expect(actions.totalDoDia()).toBe(2);

        await actions.trocarDia("2026-09-27");

        expect(actions.totalDoDia()).toBe(1);
    });

    test("com um dia só, o total é o do evento", async () => {
        vi.mocked(getEvento).mockResolvedValue({ ...eventoDoisDias, dias: [{ dia: "2026-09-27", qtd: 3 }] });

        await actions.init("correndo-com-elas", "");

        expect(actions.totalDoDia()).toBe(3);
    });

    test("evento sem foto nenhuma mostra o recado de 'ainda chegando'", async () => {
        vi.mocked(getEvento).mockResolvedValue({ ...eventoDoisDias, total_fotos: 0, dias: [] });
        vi.mocked(getGaleria).mockResolvedValue({ fotos: [] });

        await actions.init("correndo-com-elas", "");

        expect(state.fotos).toHaveLength(0);
        expect(state.acabou).toBe(true);
        expect(state.mensagem).toBe("");
    });

    test("baixar uma foto da lista leva a versão grande como anexo", async () => {
        vi.mocked(getEvento).mockResolvedValue(eventoDoisDias);
        await actions.init("correndo-com-elas", "");

        actions.salvar(1);

        expect(baixarArquivo).toHaveBeenCalledWith(`${fotos([1, 2])[1].web}&dl=1`);
    });

    test("voltar leva à página inicial do evento, pública ou privada", async () => {
        vi.mocked(getEvento).mockResolvedValue(eventoDoisDias);
        await actions.init("correndo-com-elas", "");
        actions.voltar();
        expect(roteador.push).toHaveBeenLastCalledWith("/e/correndo-com-elas");

        await actions.init("", "CHAVE123");
        actions.voltar();
        expect(roteador.push).toHaveBeenLastCalledWith("/p/CHAVE123");
    });
});
