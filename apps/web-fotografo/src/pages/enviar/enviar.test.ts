import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import Enviar from "./index.vue";
import { actions, state } from "./enviar";
import { getSessao, iniciarUpload, statusUpload, enviarPedaco } from "./services/enviar.service";
import { ErroDaApi } from "../../ts/erros";
import { criarArmazenamento } from "../../ts/armazenamento";

vi.mock("./services/enviar.service", () => ({
    getSessao: vi.fn(),
    iniciarUpload: vi.fn(),
    statusUpload: vi.fn(),
    enviarPedaco: vi.fn(),
}));
vi.mock("../../ts/hash", () => ({ calcularHash: vi.fn(async (a: File) => `h-${a.name}`) }));

const foto = (nome: string, bytes = 10) => new File([new Uint8Array(bytes)], nome, { lastModified: 1 });
let tela: VueWrapper | undefined;
let tokenDoTeste = 0;

// O IndexedDB falso responde em ciclos próprios: espera a condição em vez de um número de ticks.
async function ate(condicao: () => boolean): Promise<void> {
    for (let i = 0; i < 200 && !condicao(); i++) await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
}

async function abrir(): Promise<VueWrapper> {
    // O state é do módulo e sobra do teste anterior já "carregado".
    state.carregando = true;
    tela = mount(Enviar);
    await ate(() => !state.carregando);
    return tela;
}

const contador = (t: VueWrapper, nome: string) => t.get(`[data-contador="${nome}"]`).text();

beforeEach(() => {
    vi.clearAllMocks();
    // Um token por teste: o IndexedDB falso guarda a fila por token, entre um teste e outro.
    localStorage.setItem("token_upload", `token-${++tokenDoTeste}`);
    vi.mocked(getSessao).mockResolvedValue({ evento: { nome: "Corrida da Serra" }, fotografo: { nome: "Ana Souza" }, pedaco_bytes: 8 });
    vi.mocked(statusUpload).mockResolvedValue({ enviadas: 0, processando: 0, prontas: 0, com_erro: 0, erros: [] });
    let id = 0;
    vi.mocked(iniciarUpload).mockImplementation(async () => ({ situacao: "novo", id_upload: ++id, bytes_recebidos: 0 }));
    vi.mocked(enviarPedaco).mockImplementation(async (_token, e) => ({ bytes_recebidos: e.offset + e.pedaco.size, completo: true }));
});

afterEach(() => {
    tela?.unmount();
    tela = undefined;
});

describe("tela de envio", () => {
    test("mostra o evento, o fotógrafo e a conexão com a estação", async () => {
        const t = await abrir();

        expect(t.text()).toContain("Corrida da Serra");
        expect(t.text()).toContain("Ana Souza");
        expect(t.text()).toContain("Conectado à estação");
    });

    test("link fechado para tudo e explica", async () => {
        vi.mocked(getSessao).mockRejectedValue(new ErroDaApi("Este link não aceita mais fotos. Fale com o operador da estação.", "link_invalido", 422));
        const t = await abrir();

        expect(t.text()).toContain("Este link não aceita mais fotos. Fale com o operador da estação.");
        expect(t.find("input[type=file]").exists()).toBe(false);
    });

    test("fotos recebidas sobem e os contadores juntam o navegador e a estação", async () => {
        vi.mocked(statusUpload).mockResolvedValue({ enviadas: 2, processando: 1, prontas: 1, com_erro: 0, erros: [] });
        const t = await abrir();

        await actions.receber([
            { arquivo: foto("a.jpg"), caminho: "a.jpg" },
            { arquivo: foto("b.jpg"), caminho: "b.jpg" },
        ]);
        await flushPromises();
        await new Promise((r) => setTimeout(r, 0));

        expect(contador(t, "enviadas")).toContain("2");
        expect(contador(t, "prontas")).toContain("1");
        expect(contador(t, "esperando")).toContain("0");
    });

    test("RAW vira um resumo, JPEG grande demais e erros da estação aparecem na lista", async () => {
        vi.mocked(statusUpload).mockResolvedValue({
            enviadas: 0,
            processando: 0,
            prontas: 0,
            com_erro: 1,
            erros: [{ nome_arquivo: "IMG_9.JPG", mensagem: "A estação não conseguiu ler esta foto (arquivo corrompido)." }],
        });
        const t = await abrir();
        const gigante = { name: "gigante.jpg", size: 101 * 1024 * 1024, lastModified: 1 } as File;

        await actions.receber([
            { arquivo: foto("IMG_1.CR3"), caminho: "IMG_1.CR3" },
            { arquivo: gigante, caminho: "gigante.jpg" },
        ]);
        await flushPromises();

        expect(t.text()).toContain("1 arquivo que não é JPEG foi ignorado");
        expect(t.text()).toContain("Foto maior que 100 MB.");
        expect(t.text()).toContain("A estação não conseguiu ler esta foto (arquivo corrompido).");
        expect(contador(t, "erros")).toContain("2");
    });

    test("pendentes da visita anterior aparecem no aviso, e esquecer tira o aviso", async () => {
        const token = localStorage.getItem("token_upload")!;
        await criarArmazenamento(token).gravarItem("a.jpg|10|1", { situacao: "enviando", idUpload: 4 });
        const t = await abrir();

        expect(t.text()).toContain("1 foto ficou pendente da última vez");

        await t.get("[data-acao=esquecer]").trigger("click");
        await ate(() => state.pendentesAnteriores === 0);
        expect(t.text()).not.toContain("ficou pendente");
    });

    test("pausar vira continuar e volta", async () => {
        const t = await abrir();
        const botao = t.get("[data-acao=pausar]");

        await botao.trigger("click");
        expect(t.get("[data-acao=pausar]").text()).toBe("Continuar");
        await t.get("[data-acao=pausar]").trigger("click");
        expect(t.get("[data-acao=pausar]").text()).toBe("Pausar");
    });

    test("sem conexão, avisa que está tentando de novo", async () => {
        vi.mocked(iniciarUpload).mockRejectedValue(new ErroDaApi("Sem conexão com a estação.", undefined, undefined, true));
        const t = await abrir();

        await actions.receber([{ arquivo: foto("a.jpg"), caminho: "a.jpg" }]);
        await flushPromises();
        await new Promise((r) => setTimeout(r, 0));

        expect(t.text()).toContain("Sem conexão com a estação — tentando de novo");
    });

    test("com a fila parada, a estação fora do ar também muda o aviso de conexão", async () => {
        // Sem foto na fila, só a consulta periódica percebe a queda: o aviso não pode seguir "Conectado".
        vi.mocked(statusUpload).mockRejectedValue(new ErroDaApi("Sem conexão com a estação.", undefined, undefined, true));
        const t = await abrir();

        expect(t.text()).toContain("Sem conexão com a estação — tentando de novo");
        expect(t.text()).not.toContain("Conectado à estação");
    });

    test("sair com fotos na fila faz o navegador perguntar antes", async () => {
        vi.mocked(enviarPedaco).mockImplementation(() => new Promise(() => {}));
        await abrir();
        await actions.receber([{ arquivo: foto("a.jpg"), caminho: "a.jpg" }]);
        await flushPromises();

        const evento = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(evento);

        expect(evento.defaultPrevented).toBe(true);
    });
});
