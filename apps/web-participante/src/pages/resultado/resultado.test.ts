import { beforeEach, describe, expect, test, vi } from "vitest";
import { actions, state, validadeParaTela } from "./resultado";
import { getResultado, gerarLinks, pedirZip, situacaoZip } from "./services/resultado.service";
import { baixarArquivo } from "../../ts/arquivos";
import { ErroDaApi } from "../../ts/api";

vi.mock("./services/resultado.service", () => ({
    getResultado: vi.fn(),
    gerarLinks: vi.fn(),
    pedirZip: vi.fn(),
    situacaoZip: vi.fn(),
}));

vi.mock("../../ts/arquivos", () => ({ baixarArquivo: vi.fn() }));

const roteador = vi.hoisted(() => ({
    push: vi.fn(),
    back: vi.fn(),
    options: { history: { state: { back: null as string | null } } },
}));
vi.mock("../../router", () => ({ router: roteador }));

const resultadoCheio = {
    evento: { nome: "Corrida da Serra", slug: "corrida-da-serra" },
    validade_ate: "2026-12-31T00:00:00.000Z",
    fotos: [
        { id_foto: 1, thumb: "/arquivos/7/a_thumb.jpg?md5=x&expires=1", similaridade: 0.97 },
        { id_foto: 2, thumb: "/arquivos/7/b_thumb.jpg?md5=y&expires=1", similaridade: 0.8 },
    ],
};

const linkDaFoto = { links: [{ id_foto: 1, url: "/arquivos/7/a_web.jpg?md5=x&expires=1&dl=1" }] };

describe("tela de resultado", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.unstubAllGlobals();
        state.fotos = [];
        state.mensagem = "";
        state.zip = "nenhum";
        state.urlsZip = [];
        state.slug = "";
        state.aberta = null;
        roteador.options.history.state.back = null;
    });

    test("carrega as fotos da busca", async () => {
        vi.mocked(getResultado).mockResolvedValue(resultadoCheio);

        await actions.init("tok123");

        expect(state.evento).toBe("Corrida da Serra");
        expect(state.fotos).toHaveLength(2);
        expect(state.carregando).toBe(false);
    });

    test("zero fotos não é erro: é a tela de 'ainda não achamos'", async () => {
        vi.mocked(getResultado).mockResolvedValue({ ...resultadoCheio, fotos: [] });

        await actions.init("tok123");

        expect(state.fotos).toHaveLength(0);
        expect(state.mensagem).toBe("");
    });

    test("token vencido mostra a mensagem da API", async () => {
        vi.mocked(getResultado).mockRejectedValue(new ErroDaApi("O prazo para baixar estas fotos venceu. Faça a busca de novo."));

        await actions.init("tok123");

        expect(state.mensagem).toContain("prazo");
        expect(state.fotos).toHaveLength(0);
    });

    test("pedir o ZIP marca como montando e depois pronto", async () => {
        vi.mocked(pedirZip).mockResolvedValue({ partes: [7], status: "pendente" });
        vi.mocked(situacaoZip).mockResolvedValue({ status: "pronto", url: "/arquivos/zips/7/7.zip?md5=x&expires=1" });
        state.token = "tok123";

        await actions.pedirZip();

        expect(state.zip).toBe("pronto");
        expect(state.urlsZip[0]).toContain("/arquivos/zips/");
    });

    test("ZIP em partes devolve um link por parte, sem deixar fotos de fora", async () => {
        // Acima de 500 fotos a API divide o ZIP: olhar só a primeira parte perderia o resto calado.
        vi.mocked(pedirZip).mockResolvedValue({ partes: [7, 8], status: "pendente" });
        vi.mocked(situacaoZip).mockImplementation(async (_token, id) => ({ status: "pronto", url: `/arquivos/zips/3/${id}.zip?md5=x&expires=1` }));
        state.token = "tok123";

        await actions.pedirZip();

        expect(state.zip).toBe("pronto");
        expect(state.urlsZip).toEqual(["/arquivos/zips/3/7.zip?md5=x&expires=1", "/arquivos/zips/3/8.zip?md5=x&expires=1"]);
    });

    test("ZIP que falha volta ao estado inicial com recado", async () => {
        vi.mocked(pedirZip).mockResolvedValue({ partes: [7], status: "pendente" });
        vi.mocked(situacaoZip).mockResolvedValue({ status: "erro" });
        state.token = "tok123";

        await actions.pedirZip();

        expect(state.zip).toBe("nenhum");
        expect(state.mensagem).toContain("ZIP");
    });

    test("salvar baixa a versão web pelo link assinado", async () => {
        vi.mocked(gerarLinks).mockResolvedValue(linkDaFoto);
        state.fotos = resultadoCheio.fotos;

        await actions.salvar(0);

        expect(baixarArquivo).toHaveBeenCalledWith(linkDaFoto.links[0].url);
    });

    test("compartilhar só aparece quando o navegador aceita arquivo, não só link", () => {
        // O navigator.share do computador existe, mas recusa anexo: o clique daria erro.
        vi.stubGlobal("navigator", { share: vi.fn(), canShare: () => false });
        expect(actions.podeCompartilhar()).toBe(false);

        vi.stubGlobal("navigator", { share: vi.fn(), canShare: () => true });
        expect(actions.podeCompartilhar()).toBe(true);

        vi.stubGlobal("navigator", {});
        expect(actions.podeCompartilhar()).toBe(false);
    });

    test("compartilhamento que o navegador não consegue fazer cai no download", async () => {
        vi.mocked(gerarLinks).mockResolvedValue(linkDaFoto);
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob([new Uint8Array([1])]) }));
        vi.stubGlobal("navigator", { canShare: () => true, share: vi.fn().mockRejectedValue(new TypeError("arquivo não aceito")) });
        state.fotos = resultadoCheio.fotos;

        await actions.compartilhar(0);

        expect(baixarArquivo).toHaveBeenCalledWith(linkDaFoto.links[0].url);
    });

    test("toque que venceu enquanto a foto baixava deixa a foto pronta para um segundo toque", async () => {
        // No iPhone o menu de compartilhar só abre logo depois do toque, e baixar a foto pode
        // passar desse tempo. Baixar para Arquivos no lugar não põe a foto na galeria dela.
        vi.mocked(gerarLinks).mockResolvedValue(linkDaFoto);
        const baixar = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob([new Uint8Array([1])]) });
        const compartilhar = vi
            .fn()
            .mockRejectedValueOnce(new DOMException("sem gesto", "NotAllowedError"))
            .mockResolvedValueOnce(undefined);
        vi.stubGlobal("fetch", baixar);
        vi.stubGlobal("navigator", { canShare: () => true, share: compartilhar });
        state.fotos = resultadoCheio.fotos;
        state.aberta = 0;

        await actions.compartilhar(0);
        expect(baixarArquivo).not.toHaveBeenCalled();
        expect(actions.prontaParaCompartilhar()).toBe(true);

        await actions.compartilhar(0);
        expect(baixar).toHaveBeenCalledTimes(1);
        expect(gerarLinks).toHaveBeenCalledTimes(1);
        expect(compartilhar.mock.calls[1][0].files[0]).toBe(compartilhar.mock.calls[0][0].files[0]);
        expect(actions.prontaParaCompartilhar()).toBe(false);
    });

    test("foto que não baixou não vira anexo vazio: cai no download", async () => {
        vi.mocked(gerarLinks).mockResolvedValue(linkDaFoto);
        const compartilhar = vi.fn();
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 410, blob: async () => new Blob(["vencido"]) }));
        vi.stubGlobal("navigator", { canShare: () => true, share: compartilhar });
        state.fotos = resultadoCheio.fotos;

        await actions.compartilhar(0);

        expect(compartilhar).not.toHaveBeenCalled();
        expect(baixarArquivo).toHaveBeenCalledWith(linkDaFoto.links[0].url);
    });

    test("cancelar o menu de compartilhar não baixa nada", async () => {
        vi.mocked(gerarLinks).mockResolvedValue(linkDaFoto);
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob([new Uint8Array([1])]) }));
        vi.stubGlobal("navigator", { canShare: () => true, share: vi.fn().mockRejectedValue(new DOMException("cancelou", "AbortError")) });
        state.fotos = resultadoCheio.fotos;

        await actions.compartilhar(0);

        expect(baixarArquivo).not.toHaveBeenCalled();
        expect(state.mensagem).toBe("");
    });

    test("salvar com o prazo vencido fecha a foto e mostra o recado", async () => {
        vi.mocked(gerarLinks).mockRejectedValue(new ErroDaApi("O prazo para baixar estas fotos venceu. Faça a busca de novo."));
        state.fotos = resultadoCheio.fotos;
        state.aberta = 0;

        await actions.salvar(0);

        expect(state.aberta).toBeNull();
        expect(state.mensagem).toContain("prazo");
    });

    test("deslizar anda pelas fotos sem passar das pontas", () => {
        state.fotos = resultadoCheio.fotos;
        state.aberta = 0;

        actions.anterior();
        expect(state.aberta).toBe(0);
        actions.proxima();
        expect(state.aberta).toBe(1);
        actions.proxima();
        expect(state.aberta).toBe(1);
    });

    test("buscar de novo volta pela história quando a pessoa veio da câmera", () => {
        roteador.options.history.state.back = "/e/corrida-da-serra";

        actions.voltarParaCamera();

        expect(roteador.back).toHaveBeenCalled();
    });

    test("aberto direto pelo link, buscar de novo vai para a câmera do evento", () => {
        // O link do resultado é reaberto dias depois: não há tela anterior para onde voltar.
        state.slug = "corrida-da-serra";

        actions.voltarParaCamera();

        expect(roteador.push).toHaveBeenCalledWith({ name: "evento", params: { slug: "corrida-da-serra" } });
    });

    test("link reaberto de evento privado volta pela entrada guardada, não pelo slug", () => {
        // Pelo slug a API recusa evento privado: mandar para /e/<slug> seria uma armadilha.
        localStorage.setItem("entrada:tok123", "/p/chave-privada");
        state.token = "tok123";
        state.slug = "corrida-privada";

        actions.voltarParaCamera();

        expect(roteador.push).toHaveBeenCalledWith("/p/chave-privada");
        localStorage.clear();
    });

    test("prazo vencido num link reaberto ainda oferece a volta para a câmera", async () => {
        // A API recusa antes de dizer o evento; a entrada guardada na busca é o que sobra.
        localStorage.setItem("entrada:tokVelho", "/e/corrida-da-serra");
        vi.mocked(getResultado).mockRejectedValue(new ErroDaApi("O prazo para baixar estas fotos venceu. Faça a busca de novo."));

        await actions.init("tokVelho");

        expect(actions.temCaminhoParaCamera()).toBe(true);
        localStorage.clear();
    });

    test("um token que falha não herda o evento do resultado anterior", async () => {
        vi.mocked(getResultado).mockResolvedValueOnce(resultadoCheio);
        await actions.init("tok123");
        vi.mocked(getResultado).mockRejectedValueOnce(new ErroDaApi("Não encontramos suas fotos. Faça a busca de novo."));

        await actions.init("tok-de-outro-evento");

        expect(state.slug).toBe("");
        expect(actions.temCaminhoParaCamera()).toBe(false);
    });

    test("sem histórico e sem evento conhecido, não há caminho de volta para oferecer", () => {
        expect(actions.temCaminhoParaCamera()).toBe(false);
        state.slug = "corrida-da-serra";
        expect(actions.temCaminhoParaCamera()).toBe(true);
    });
});

describe("validadeParaTela", () => {
    test("mostra dia e mês", () => {
        expect(validadeParaTela("2026-12-31T15:00:00.000Z")).toBe("31/12");
    });

    test("sem prazo, nada aparece", () => {
        expect(validadeParaTela(null)).toBe("");
    });
});
