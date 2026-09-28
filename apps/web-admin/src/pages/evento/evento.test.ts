import { beforeEach, describe, expect, test, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import PaginaEvento from "./index.vue";
import { editarEvento, obterEvento, subirMarcaDagua } from "./services/evento.service";
import { ErroDaApi } from "../../ts/erros";
import { entrarComo } from "../../ts/sessao";
import type { Evento } from "./interfaces";

vi.mock("./services/evento.service", () => ({
    obterEvento: vi.fn(),
    editarEvento: vi.fn(),
    subirMarcaDagua: vi.fn(),
}));

function eventoFalso(parcial: Partial<Evento> = {}): Evento {
    return {
        id_evento: 7,
        nome: "Corrida da Serra",
        slug: "corrida-da-serra",
        tipo: "esportivo",
        privado: "N",
        chave_acesso: null,
        chave_anfitriao: "anf123",
        data_inicio: "2026-09-27",
        data_fim: "2026-09-27",
        ativo: "S",
        config: {
            limiar: 0.42,
            exigir_whatsapp: false,
            marca_dagua: false,
            organizador: "Corrida da Serra",
            dias_expurgo: 90,
            validade_resultado_dias: 30,
            max_selfies: 3,
        },
        links: { participante: "http://localhost:8080/#/e/corrida-da-serra", anfitriao: "http://localhost:8080/#/a/anf123" },
        ...parcial,
    };
}

async function abrir(id = 7) {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: "/eventos/:id", component: PaginaEvento },
            { path: "/", component: { template: "<p>lista</p>" } },
            { path: "/entrar", name: "entrar", component: { template: "<p>entrar</p>" } },
        ],
    });
    await router.push(`/eventos/${id}`);
    const tela = mount(PaginaEvento, { global: { plugins: [router] } });
    await flushPromises();
    return { tela, router };
}

const valor = (tela: VueWrapper, seletor: string) => (tela.get(seletor).element as HTMLInputElement).value;

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    entrarComo({ token: "tok", nome: "Ana" });
    vi.mocked(obterEvento).mockResolvedValue(eventoFalso());
});

describe("página do evento — dados", () => {
    test("mostra os dados para editar; endereço e tipo só para leitura", async () => {
        const { tela } = await abrir();

        expect(obterEvento).toHaveBeenCalledWith(7);
        expect(valor(tela, "input[name=nome]")).toBe("Corrida da Serra");
        expect(tela.text()).toContain("corrida-da-serra");
        expect(tela.find("input[name=endereco]").exists()).toBe(false);
        expect(tela.text()).toContain("A verificação por WhatsApp ainda não existe: ligado, o participante não vê as fotos.");
    });

    test("salvar manda os campos e a config; validade apagada vai como null", async () => {
        vi.mocked(editarEvento).mockResolvedValue(eventoFalso({ nome: "Corrida Nova" }));
        const { tela } = await abrir();

        await tela.get("input[name=nome]").setValue("Corrida Nova");
        await tela.get("input[name=validade_resultado_dias]").setValue("");
        await tela.get("form[data-form=dados]").trigger("submit");
        await flushPromises();

        expect(editarEvento).toHaveBeenCalledWith(7, {
            nome: "Corrida Nova",
            data_inicio: "2026-09-27",
            data_fim: "2026-09-27",
            privado: false,
            ativo: true,
            config: {
                organizador: "Corrida da Serra",
                exigir_whatsapp: false,
                marca_dagua: false,
                limiar: 0.42,
                max_selfies: 3,
                dias_expurgo: 90,
                validade_resultado_dias: null,
            },
        });
        expect(tela.text()).toContain("Salvo. A estação recebe a mudança em até 1 minuto.");
    });

    test("erro da API aparece sem perder o que foi digitado", async () => {
        vi.mocked(editarEvento).mockRejectedValue(new ErroDaApi("O máximo de selfies deve ser de 1 a 5.", undefined, 422));
        const { tela } = await abrir();

        await tela.get("input[name=nome]").setValue("Corrida Nova");
        await tela.get("form[data-form=dados]").trigger("submit");
        await flushPromises();

        expect(tela.text()).toContain("O máximo de selfies deve ser de 1 a 5.");
        expect(valor(tela, "input[name=nome]")).toBe("Corrida Nova");
    });

    test("fim antes do início não chega à API", async () => {
        const { tela } = await abrir();

        await tela.get("input[name=data_fim]").setValue("2026-09-20");
        await tela.get("form[data-form=dados]").trigger("submit");
        await flushPromises();

        expect(editarEvento).not.toHaveBeenCalled();
        expect(tela.text()).toContain("O fim do evento não pode ser antes do início.");
    });

    test("evento que não existe: mensagem e caminho de volta para a lista", async () => {
        vi.mocked(obterEvento).mockRejectedValue(new ErroDaApi("Evento não encontrado.", undefined, 422));
        const { tela } = await abrir(999);

        expect(tela.text()).toContain("Evento não encontrado.");
        // O cabeçalho também leva a "/": o que importa é o botão de volta dentro da página.
        expect(tela.get("[data-acao=voltar]").text()).toBe("Voltar aos eventos");
    });

    test("enviar a marca d'água: sucesso e recusa", async () => {
        const { tela } = await abrir();
        const arquivo = new File(["png"], "marca.png", { type: "image/png" });
        const campo = tela.get("input[name=marca]");
        Object.defineProperty(campo.element, "files", { value: [arquivo], configurable: true });

        vi.mocked(subirMarcaDagua).mockResolvedValue({ ok: true });
        await campo.trigger("change");
        await flushPromises();
        expect(subirMarcaDagua).toHaveBeenCalledWith(7, arquivo);
        expect(tela.text()).toContain("Marca d'água enviada.");

        vi.mocked(subirMarcaDagua).mockRejectedValue(new ErroDaApi("A marca d'água deve ser um PNG.", undefined, 422));
        await campo.trigger("change");
        await flushPromises();
        expect(tela.text()).toContain("A marca d'água deve ser um PNG.");
    });
});
