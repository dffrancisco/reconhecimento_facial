import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import Estacao from "./index.vue";
import { state } from "./estacao";
import { encerrarEvento, getPainel, login, reprocessar } from "./services/estacao.service";
import { ErroDaApi } from "../../ts/erros";
import type { RespostaPainel } from "./interfaces";

vi.mock("./services/estacao.service", () => ({ login: vi.fn(), getPainel: vi.fn(), reprocessar: vi.fn(), encerrarEvento: vi.fn() }));

function painel(parcial: Partial<RespostaPainel> = {}): RespostaPainel {
    return {
        evento: { id_evento: 7, nome: "Corrida da Serra", desde: "2026-09-26T10:10:00.000Z" },
        metricas: { fotos_min: 38, latencia_p50_ms: 9000, latencia_p95_ms: 21000, taxa_erro: 0.004, gpu: null },
        fila: { recebidas: 146, rostos: 58, derivados: 17, esperando_publicar: 34 },
        vps: { ultima_sincronizacao: new Date().toISOString() },
        enderecos: { lan: "http://192.168.0.10", tunel: "https://estacao.exemplo.com.br" },
        fotografos: [{ id_evento_fotografo: 1, nome: "Ana Souza", token_upload: "tok-ana", enviadas: 460, prontas: 288, com_erro: 2 }],
        erros: [
            { id_foto: 41, nome_arquivo: "IMG_4402.JPG", fotografo: "Ana Souza", etapa: "rostos", erro: "vision recusou a imagem", tem_arquivo: true },
            { id_foto: 42, nome_arquivo: "IMG_4403.JPG", fotografo: "Ana Souza", etapa: "registrada", erro: "sumiu", tem_arquivo: false },
        ],
        em_processamento: 0,
        ...parcial,
    };
}

let tela: VueWrapper | undefined;

async function abrir(): Promise<VueWrapper> {
    state.carregando = true;
    tela = mount(Estacao, { attachTo: document.body });
    for (let i = 0; i < 50 && state.carregando; i++) await new Promise((r) => setTimeout(r, 0));
    await flushPromises();
    return tela;
}

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.mocked(getPainel).mockResolvedValue(painel());
});

afterEach(() => {
    tela?.unmount();
    tela = undefined;
    vi.useRealTimers();
});

const entrar = () => localStorage.setItem("sessao_operador", JSON.stringify({ token: "sessao", nome: "Ana" }));

describe("login do painel", () => {
    test("sem sessão, pede login e senha", async () => {
        const t = await abrir();
        expect(t.find("input[name=login]").exists()).toBe(true);
        expect(t.find("input[name=senha]").exists()).toBe(true);
        expect(getPainel).not.toHaveBeenCalled();
    });

    test("login certo guarda a sessão e mostra o painel", async () => {
        vi.mocked(login).mockResolvedValue({ token: "novo", nome: "Ana" });
        const t = await abrir();

        await t.get("input[name=login]").setValue("ana");
        await t.get("input[name=senha]").setValue("senha");
        await t.get("form").trigger("submit");
        await flushPromises();

        expect(login).toHaveBeenCalledWith("ana", "senha");
        expect(JSON.parse(localStorage.getItem("sessao_operador")!)).toEqual({ token: "novo", nome: "Ana" });
        expect(t.text()).toContain("Corrida da Serra");
    });

    test("login errado mostra a mensagem da estação", async () => {
        vi.mocked(login).mockRejectedValue(new ErroDaApi("Login ou senha inválidos.", undefined, 422));
        const t = await abrir();

        await t.get("input[name=login]").setValue("ana");
        await t.get("input[name=senha]").setValue("errada");
        await t.get("form").trigger("submit");
        await flushPromises();

        expect(t.text()).toContain("Login ou senha inválidos.");
    });
});

describe("painel", () => {
    test("sem evento em andamento, explica o que fazer", async () => {
        entrar();
        vi.mocked(getPainel).mockResolvedValue(painel({ evento: null, fotografos: [], erros: [] }));
        const t = await abrir();

        expect(t.text()).toContain("Nenhum evento em andamento nesta estação");
    });

    test("mostra os números, a fila por etapa e a placa de vídeo como — quando não informada", async () => {
        entrar();
        const t = await abrir();

        expect(t.get("[data-numero=fotos-min]").text()).toContain("38");
        expect(t.get("[data-numero=gpu]").text()).toContain("—");
        expect(t.get("[data-etapa=recebidas]").text()).toContain("146");
        expect(t.get("[data-etapa=esperando_publicar]").text()).toContain("34");
    });

    test("cada fotógrafo tem o link com o endereço da rede local, para copiar e em QR", async () => {
        entrar();
        const escrever = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", { value: { writeText: escrever }, configurable: true });
        const t = await abrir();

        expect(t.text()).toContain("http://192.168.0.10/#/?t=tok-ana");
        await t.get("[data-acao=copiar]").trigger("click");
        expect(escrever).toHaveBeenCalledWith("http://192.168.0.10/#/?t=tok-ana");

        await t.get("[data-acao=qr-grande]").trigger("click");
        await flushPromises();
        expect(t.find("[data-qr-grande] svg").exists()).toBe(true);
    });

    test("sem endereço configurado, avisa que o link aberto em localhost não serve no celular", async () => {
        entrar();
        vi.mocked(getPainel).mockResolvedValue(painel({ enderecos: { lan: null, tunel: null } }));
        const t = await abrir();

        expect(t.text()).toContain("Este endereço só funciona neste computador");
    });

    test("erro com arquivo pode ser reprocessado; sem arquivo, pede reenvio", async () => {
        entrar();
        vi.mocked(reprocessar).mockResolvedValue({ reenfileiradas: 1, sem_arquivo: 0 });
        const t = await abrir();

        await t.get("[data-acao=reprocessar-41]").trigger("click");
        await flushPromises();

        expect(reprocessar).toHaveBeenCalledWith(41);
        expect(t.text()).toContain("Peça ao fotógrafo para reenviar");
        expect(t.find("[data-acao=reprocessar-42]").exists()).toBe(false);
    });

    test("encerrar fica travado com foto em processamento", async () => {
        entrar();
        vi.mocked(getPainel).mockResolvedValue(painel({ em_processamento: 3 }));
        const t = await abrir();

        expect(t.get("[data-acao=encerrar]").attributes("disabled")).toBeDefined();
    });

    test("encerrar pede confirmação, avisa das fotos com erro e só então encerra", async () => {
        entrar();
        vi.mocked(encerrarEvento).mockResolvedValue({ encerrado: true });
        const t = await abrir();

        await t.get("[data-acao=encerrar]").trigger("click");
        expect(encerrarEvento).not.toHaveBeenCalled();
        expect(t.text()).toContain("Encerrar apaga os rostos guardados nesta estação");
        expect(t.text()).toContain("2 fotos com erro não serão publicadas");

        await t.get("[data-acao=confirmar-encerrar]").trigger("click");
        await flushPromises();
        expect(encerrarEvento).toHaveBeenCalledWith(7);
    });

    test("atualiza a cada 2 segundos e para ao sair da tela", async () => {
        entrar();
        vi.useFakeTimers();
        const t = mount(Estacao);
        await vi.advanceTimersByTimeAsync(0);
        const antes = vi.mocked(getPainel).mock.calls.length;

        await vi.advanceTimersByTimeAsync(4000);
        expect(vi.mocked(getPainel).mock.calls.length).toBe(antes + 2);

        t.unmount();
        await vi.advanceTimersByTimeAsync(4000);
        expect(vi.mocked(getPainel).mock.calls.length).toBe(antes + 2);
    });

    test("sessão expirada volta para o login", async () => {
        entrar();
        vi.mocked(getPainel).mockRejectedValue(new ErroDaApi("Sessão expirada, faça login novamente.", "sessao_expirada", 422));
        const t = await abrir();

        expect(t.find("input[name=login]").exists()).toBe(true);
        expect(localStorage.getItem("sessao_operador")).toBeNull();
    });
});
