import { beforeEach, describe, expect, test, vi } from "vitest";
import { actions, state } from "./anfitriao";
import { getGaleria, pedirZipDoEvento, situacaoZipDoEvento } from "./services/anfitriao.service";
import { baixarArquivo } from "../../ts/arquivos";
import { ErroDaApi } from "../../ts/api";

vi.mock("./services/anfitriao.service", () => ({ getGaleria: vi.fn(), pedirZipDoEvento: vi.fn(), situacaoZipDoEvento: vi.fn() }));
vi.mock("../../ts/arquivos", () => ({ baixarArquivo: vi.fn() }));

function fotos(quantas: number) {
    return Array.from({ length: quantas }, (_, i) => ({
        id_foto: i + 1,
        thumb: `/arquivos/7/${i}_thumb.jpg?md5=x&expires=1`,
        web: `/arquivos/7/${i}_web.jpg?md5=x&expires=1`,
    }));
}

describe("galeria do anfitrião", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.fotos = [];
        state.offset = 0;
        state.acabou = false;
        state.mensagem = "";
        state.zip = "nenhum";
        state.urlsZip = [];
        state.aberta = null;
    });

    test("carrega a primeira página", async () => {
        vi.mocked(getGaleria).mockResolvedValue({ evento: "Corrida da Serra", fotos: fotos(60) });

        await actions.init("chave-abc");

        expect(state.evento).toBe("Corrida da Serra");
        expect(state.fotos).toHaveLength(60);
        expect(state.acabou).toBe(false);
    });

    test("página incompleta significa que acabou", async () => {
        vi.mocked(getGaleria).mockResolvedValue({ evento: "Corrida", fotos: fotos(12) });

        await actions.init("chave-abc");

        expect(state.acabou).toBe(true);
    });

    test("carregar mais acumula em vez de substituir", async () => {
        vi.mocked(getGaleria).mockResolvedValueOnce({ evento: "Corrida", fotos: fotos(60) });
        await actions.init("chave-abc");

        vi.mocked(getGaleria).mockResolvedValueOnce({ evento: "Corrida", fotos: fotos(5) });
        await actions.carregarMais();

        expect(state.fotos).toHaveLength(65);
        expect(state.acabou).toBe(true);
    });

    test("chave errada mostra o recado da API", async () => {
        vi.mocked(getGaleria).mockRejectedValue(new ErroDaApi("Galeria não encontrada. Confira o link."));

        await actions.init("chave-errada");

        expect(state.mensagem).toContain("não encontrada");
        expect(state.fotos).toHaveLength(0);
    });

    test("baixar tudo espera as partes e mostra um link por parte", async () => {
        vi.mocked(pedirZipDoEvento).mockResolvedValue({ partes: [4, 5], status: "pendente" });
        vi.mocked(situacaoZipDoEvento).mockImplementation(async (_chave, id) => ({ status: "pronto", url: `/arquivos/zips/7/${id}.zip` }));
        state.chave = "chave-abc";

        await actions.pedirZip();

        expect(situacaoZipDoEvento).toHaveBeenCalledWith("chave-abc", 4);
        expect(state.zip).toBe("pronto");
        expect(state.urlsZip).toEqual(["/arquivos/zips/7/4.zip", "/arquivos/zips/7/5.zip"]);
    });

    test("ZIP ainda montando libera o botão e diz para voltar depois", async () => {
        vi.mocked(pedirZipDoEvento).mockResolvedValue({ partes: [4], status: "pendente" });
        vi.mocked(situacaoZipDoEvento).mockResolvedValue({ status: "pendente" });
        state.chave = "chave-abc";

        await actions.pedirZip({ tentativas: 2, esperaMs: 0 });

        expect(state.zip).toBe("nenhum");
        expect(state.mensagem).toContain("Volte");
    });

    test("baixar uma foto da lista leva a versão grande como anexo", async () => {
        vi.mocked(getGaleria).mockResolvedValue({ evento: "Corrida", fotos: fotos(3) });
        await actions.init("chave-abc");

        actions.abrir(1);
        actions.salvar(2);

        expect(state.aberta).toBe(1);
        expect(baixarArquivo).toHaveBeenCalledWith(`${fotos(3)[2].web}&dl=1`);
    });
});
