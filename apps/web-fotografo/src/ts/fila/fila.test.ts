import { describe, expect, test, vi } from "vitest";
import { FilaDeEnvio } from "./fila";
import { FalhaDeEnvio, type ServicosFila } from "./tipos";

const arquivo = (bytes: number, nome = "a.jpg") => new File([new Uint8Array(bytes)], nome, { type: "image/jpeg" });
const tick = () => new Promise((r) => setTimeout(r, 0));

async function ate(condicao: () => boolean, limite = 500): Promise<void> {
    for (let i = 0; i < limite && !condicao(); i++) await tick();
    if (!condicao()) throw new Error("condição não atingida");
}

// Estação falsa que aceita tudo: guarda o que recebeu para o teste conferir.
function estacaoFalsa(sobrescrever: Partial<ServicosFila> = {}) {
    const recebidos: { idUpload: number; offset: number; tamanho: number }[] = [];
    let proximoId = 1;
    const servicos: ServicosFila = {
        calcularHash: vi.fn(async (a: File) => `hash-${a.name}`),
        iniciar: vi.fn(async () => ({ situacao: "novo" as const, id_upload: proximoId++, bytes_recebidos: 0 })),
        enviarPedaco: vi.fn(async ({ idUpload, offset, pedaco }) => {
            recebidos.push({ idUpload, offset, tamanho: pedaco.size });
            const bytes = offset + pedaco.size;
            return { bytes_recebidos: bytes, completo: bytes >= 20 };
        }),
        esperar: vi.fn(async () => {}),
        ...sobrescrever,
    };
    return { servicos, recebidos };
}

describe("FilaDeEnvio", () => {
    test("manda o arquivo em pedaços do tamanho combinado e marca enviado", async () => {
        const { servicos, recebidos } = estacaoFalsa();
        const fila = new FilaDeEnvio(servicos, { pedacoBytes: 8 });

        fila.adicionar([{ chave: "a", arquivo: arquivo(20) }]);
        await ate(() => fila.estado().enviados === 1);

        expect(recebidos.map((r) => [r.offset, r.tamanho])).toEqual([
            [0, 8],
            [8, 8],
            [16, 4],
        ]);
        expect(fila.estado().itens[0].progresso).toBe(1);
    });

    test("nunca passa de N envios ao mesmo tempo", async () => {
        let emCurso = 0;
        let maximo = 0;
        const { servicos } = estacaoFalsa({
            enviarPedaco: vi.fn(async ({ offset, pedaco }) => {
                emCurso++;
                maximo = Math.max(maximo, emCurso);
                await tick();
                emCurso--;
                return { bytes_recebidos: offset + pedaco.size, completo: offset + pedaco.size >= 20 };
            }),
        });
        const fila = new FilaDeEnvio(servicos, { pedacoBytes: 8, porVez: 3 });

        fila.adicionar(Array.from({ length: 10 }, (_, i) => ({ chave: `k${i}`, arquivo: arquivo(20, `f${i}.jpg`) })));
        await ate(() => fila.estado().enviados === 10);

        expect(maximo).toBe(3);
    });

    test("só calcula a impressão digital quando a foto vai ocupar uma vaga", async () => {
        // Pasta com 2 000 fotos: calcular tudo antes de enviar travaria o começo por minutos.
        const { servicos } = estacaoFalsa({ enviarPedaco: vi.fn(() => new Promise<never>(() => {})) });
        const fila = new FilaDeEnvio(servicos, { pedacoBytes: 8, porVez: 3 });

        fila.adicionar(Array.from({ length: 100 }, (_, i) => ({ chave: `k${i}`, arquivo: arquivo(20, `f${i}.jpg`) })));
        await ate(() => vi.mocked(servicos.enviarPedaco).mock.calls.length === 3);

        expect(vi.mocked(servicos.calcularHash).mock.calls.length).toBe(3);
    });

    test("foto que a estação já tem é pulada sem subir nada", async () => {
        const { servicos, recebidos } = estacaoFalsa({ iniciar: vi.fn(async () => ({ situacao: "ja_existe" as const })) });
        const fila = new FilaDeEnvio(servicos, { pedacoBytes: 8 });

        fila.adicionar([{ chave: "a", arquivo: arquivo(20) }]);
        await ate(() => fila.estado().pulados === 1);

        expect(recebidos).toHaveLength(0);
    });

    test("envio que parou no meio continua do byte que a estação diz", async () => {
        const { servicos, recebidos } = estacaoFalsa({
            iniciar: vi.fn(async () => ({ situacao: "continuar" as const, id_upload: 9, bytes_recebidos: 8 })),
        });
        const fila = new FilaDeEnvio(servicos, { pedacoBytes: 8 });

        fila.adicionar([{ chave: "a", arquivo: arquivo(20) }]);
        await ate(() => fila.estado().enviados === 1);

        expect(recebidos[0].offset).toBe(8);
    });

    test("estação que já tem o arquivo inteiro recebe um pedaço vazio para concluir", async () => {
        const { servicos, recebidos } = estacaoFalsa({
            iniciar: vi.fn(async () => ({ situacao: "continuar" as const, id_upload: 9, bytes_recebidos: 20 })),
        });
        const fila = new FilaDeEnvio(servicos, { pedacoBytes: 8 });

        fila.adicionar([{ chave: "a", arquivo: arquivo(20) }]);
        await ate(() => fila.estado().enviados === 1);

        expect(recebidos).toEqual([{ idUpload: 9, offset: 20, tamanho: 0 }]);
    });

    test("pedaço fora de ordem segue do byte certo, sem gastar tentativa", async () => {
        let primeira = true;
        const { servicos, recebidos } = estacaoFalsa();
        const original = servicos.enviarPedaco;
        servicos.enviarPedaco = vi.fn(async (e) => {
            if (primeira) {
                primeira = false;
                throw new FalhaDeEnvio("fora_de_ordem", "fora de ordem", 16);
            }
            return original(e);
        });
        const fila = new FilaDeEnvio(servicos, { pedacoBytes: 8 });

        fila.adicionar([{ chave: "a", arquivo: arquivo(20) }]);
        await ate(() => fila.estado().enviados === 1);

        expect(recebidos.map((r) => r.offset)).toEqual([16]);
        expect(fila.estado().itens[0].tentativas).toBe(0);
    });

    test("sem conexão, espera e continua sozinha, sem desistir e sem gastar tentativa", async () => {
        let falhas = 0;
        const agora = { valor: 1000 };
        const { servicos } = estacaoFalsa();
        const original = servicos.iniciar;
        const desdeDurante: (number | null)[] = [];
        let fila!: FilaDeEnvio;
        servicos.iniciar = vi.fn(async (e) => {
            if (falhas < 20) {
                falhas++;
                desdeDurante.push(fila.estado().semConexaoDesde);
                throw new FalhaDeEnvio("sem_conexao", "Sem conexão com a estação.");
            }
            return original(e);
        });
        fila = new FilaDeEnvio(servicos, { pedacoBytes: 8, agora: () => agora.valor });

        fila.adicionar([{ chave: "a", arquivo: arquivo(20) }]);
        await ate(() => fila.estado().enviados === 1);

        const esperas = vi.mocked(servicos.esperar).mock.calls.map(([ms]) => ms);
        expect(esperas.slice(0, 6)).toEqual([1000, 2000, 4000, 8000, 16000, 32000]);
        expect(Math.max(...esperas)).toBe(32000);
        expect(desdeDurante.slice(1).every((d) => d === 1000)).toBe(true);
        expect(fila.estado().semConexaoDesde).toBeNull();
        expect(fila.estado().itens[0].tentativas).toBe(0);
    });

    test("problema da estação inteira para a fila e espera o fotógrafo continuar", async () => {
        let recusar = true;
        const { servicos } = estacaoFalsa();
        const original = servicos.iniciar;
        servicos.iniciar = vi.fn(async (e) => {
            if (recusar) throw new FalhaDeEnvio("estacao", "A estação está sem espaço em disco. Avise o operador.");
            return original(e);
        });
        const fila = new FilaDeEnvio(servicos, { pedacoBytes: 8, porVez: 1 });

        fila.adicionar([
            { chave: "a", arquivo: arquivo(20, "a.jpg") },
            { chave: "b", arquivo: arquivo(20, "b.jpg") },
        ]);
        await ate(() => fila.estado().parada !== null);

        expect(fila.estado().parada).toBe("A estação está sem espaço em disco. Avise o operador.");
        expect(vi.mocked(servicos.iniciar).mock.calls).toHaveLength(1);

        recusar = false;
        fila.continuar();
        await ate(() => fila.estado().enviados === 2);
        expect(fila.estado().parada).toBeNull();
    });

    test("erro de uma foto tenta 6 vezes, marca só ela e as outras seguem", async () => {
        const { servicos } = estacaoFalsa();
        const original = servicos.iniciar;
        servicos.iniciar = vi.fn(async (e) => {
            if (e.nome_arquivo === "ruim.jpg") throw new FalhaDeEnvio("foto", "A estação recusou o envio (código 500).");
            return original(e);
        });
        const fila = new FilaDeEnvio(servicos, { pedacoBytes: 8 });

        fila.adicionar([
            { chave: "ruim", arquivo: arquivo(20, "ruim.jpg") },
            { chave: "boa", arquivo: arquivo(20, "boa.jpg") },
        ]);
        await ate(() => fila.estado().comErro === 1 && fila.estado().enviados === 1);

        const ruim = fila.estado().itens.find((i) => i.chave === "ruim")!;
        expect(ruim.situacao).toBe("erro");
        expect(ruim.mensagem).toBe("A estação recusou o envio (código 500).");
        expect(vi.mocked(servicos.iniciar).mock.calls.filter(([e]) => e.nome_arquivo === "ruim.jpg")).toHaveLength(6);
        const esperas = vi.mocked(servicos.esperar).mock.calls.map(([ms]) => ms);
        expect(esperas).toEqual([1000, 2000, 4000, 8000, 16000]);
    });

    test("recusa definitiva da estação marca o erro na hora, sem 6 tentativas inúteis", async () => {
        // Um .jpg que é PNG por dentro vai ser recusado igual em todas as tentativas.
        const { servicos } = estacaoFalsa({
            enviarPedaco: vi.fn(async () => {
                throw new FalhaDeEnvio("recusada", "Não é JPEG — exporte em JPEG para enviar.");
            }),
        });
        const fila = new FilaDeEnvio(servicos, { pedacoBytes: 8 });

        fila.adicionar([{ chave: "a", arquivo: arquivo(20) }]);
        await ate(() => fila.estado().comErro === 1);

        expect(vi.mocked(servicos.enviarPedaco).mock.calls).toHaveLength(1);
        expect(fila.estado().itens[0].mensagem).toBe("Não é JPEG — exporte em JPEG para enviar.");
    });

    test("tentar de novo devolve a foto com erro para a fila, com as tentativas zeradas", async () => {
        let recusar = true;
        const { servicos } = estacaoFalsa();
        const original = servicos.iniciar;
        servicos.iniciar = vi.fn(async (e) => {
            if (recusar) throw new FalhaDeEnvio("foto", "erro");
            return original(e);
        });
        const fila = new FilaDeEnvio(servicos, { pedacoBytes: 8 });
        fila.adicionar([{ chave: "a", arquivo: arquivo(20) }]);
        await ate(() => fila.estado().comErro === 1);

        recusar = false;
        fila.tentarDeNovo("a");
        await ate(() => fila.estado().enviados === 1);

        expect(fila.estado().itens[0].tentativas).toBe(0);
    });

    test("foto que chega diferente é reenviada do zero uma vez; na segunda, vira erro", async () => {
        const diferente = () => {
            throw new FalhaDeEnvio("hash_diferente", "A foto chegou diferente do original.");
        };
        const { servicos: umaVez, recebidos } = estacaoFalsa();
        const original = umaVez.enviarPedaco;
        let falhou = false;
        umaVez.enviarPedaco = vi.fn(async (e) => {
            if (!falhou && e.offset === 16) {
                falhou = true;
                diferente();
            }
            return original(e);
        });
        const fila = new FilaDeEnvio(umaVez, { pedacoBytes: 8 });
        fila.adicionar([{ chave: "a", arquivo: arquivo(20) }]);
        await ate(() => fila.estado().enviados === 1);
        expect(recebidos.filter((r) => r.offset === 0)).toHaveLength(2);

        const { servicos: sempre } = estacaoFalsa({ enviarPedaco: vi.fn(async () => diferente()) });
        const fila2 = new FilaDeEnvio(sempre, { pedacoBytes: 8 });
        fila2.adicionar([{ chave: "a", arquivo: arquivo(20) }]);
        await ate(() => fila2.estado().comErro === 1);
        expect(fila2.estado().itens[0].mensagem).toBe("A foto chegou diferente do original.");
    });

    test("pausar termina o pedaço no ar e não começa outro; continuar retoma", async () => {
        let liberar: () => void = () => {};
        // Como a estação de verdade: quem pergunta de novo recebe "continue de onde parou".
        let jaRecebido = 0;
        const { servicos, recebidos } = estacaoFalsa({
            iniciar: vi.fn(async () =>
                jaRecebido > 0
                    ? { situacao: "continuar" as const, id_upload: 1, bytes_recebidos: jaRecebido }
                    : { situacao: "novo" as const, id_upload: 1, bytes_recebidos: 0 }
            ),
        });
        const original = servicos.enviarPedaco;
        servicos.enviarPedaco = vi.fn(async (e) => {
            if (e.offset === 0) await new Promise<void>((r) => (liberar = r));
            const resposta = await original(e);
            jaRecebido = resposta.bytes_recebidos;
            return resposta;
        });
        const fila = new FilaDeEnvio(servicos, { pedacoBytes: 8 });
        fila.adicionar([{ chave: "a", arquivo: arquivo(20) }]);
        await ate(() => vi.mocked(servicos.enviarPedaco).mock.calls.length === 1);

        fila.pausar();
        liberar();
        await ate(() => recebidos.length === 1);
        await tick();
        await tick();

        expect(recebidos).toHaveLength(1);
        expect(fila.estado().pausada).toBe(true);

        fila.continuar();
        await ate(() => fila.estado().enviados === 1);
        expect(recebidos.map((r) => r.offset)).toEqual([0, 8, 16]);
    });

    test("a mesma foto solta duas vezes entra uma vez só na fila", () => {
        const { servicos } = estacaoFalsa({ enviarPedaco: vi.fn(() => new Promise<never>(() => {})) });
        const fila = new FilaDeEnvio(servicos, { pedacoBytes: 8 });

        fila.adicionar([{ chave: "a", arquivo: arquivo(20) }]);
        fila.adicionar([{ chave: "a", arquivo: arquivo(20) }]);

        expect(fila.estado().itens).toHaveLength(1);
    });

    test("avisa quem assina a cada mudança e guarda cada item pelo aoMudar", async () => {
        const aoMudar = vi.fn();
        const { servicos } = estacaoFalsa({ aoMudar });
        const fila = new FilaDeEnvio(servicos, { pedacoBytes: 8 });
        const ouvinte = vi.fn();
        fila.assinar(ouvinte);

        fila.adicionar([{ chave: "a", arquivo: arquivo(20) }]);
        await ate(() => fila.estado().enviados === 1);

        expect(ouvinte).toHaveBeenCalled();
        expect(aoMudar.mock.calls.at(-1)?.[0]).toMatchObject({ chave: "a", situacao: "enviado", hash: "hash-a.jpg" });
    });
});
