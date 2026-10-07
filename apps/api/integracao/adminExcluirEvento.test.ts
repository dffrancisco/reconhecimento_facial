import { test, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { iniciarConfig, config } from "../src/services/config";
import { ErroTratado } from "../src/services/erro";
import EventoCtrl from "../src/_ADMIN/evento/ctrl.evento";
import FotografoCtrl from "../src/_ADMIN/fotografo/ctrl.fotografo";
import OperadorCtrl from "../src/_ADMIN/operador/ctrl.operador";
import FotoCtrl from "../src/_ESTACAO/foto/ctrl.foto";
import SincronizacaoCtrl from "../src/_ESTACAO/sincronizacao/ctrl.sincronizacao";

let conexao: ConexaoPostgres;
let idOperador: number;
let alvo: { id: number; slug: string };
let vizinho: { id: number; slug: string };
const marca = Date.now();
let sufixo = 0;
const unico = (prefixo: string) => `${prefixo}-${marca}-${++sufixo}`;

before(async () => {
    iniciarConfig({
        PAPEL: "vps",
        POSTGRES_HOST: "127.0.0.1",
        POSTGRES_PORT: "5433",
        POSTGRES_USER: "fotos",
        POSTGRES_PASSWORD: "fotos",
        POSTGRES_DB: "fotos_vps",
        REDIS_URL: "redis://127.0.0.1:6380",
        ESTACAO_CHAVE: "a".repeat(32),
        ARQUIVO_SEGREDO: "x",
        OPERADOR_SEGREDO: "a".repeat(32),
        VISION_URL: "http://127.0.0.1:1",
        RAIZ_FOTOS: await fs.mkdtemp(path.join(os.tmpdir(), "excluir-fotos-")),
        RAIZ_ZIPS: await fs.mkdtemp(path.join(os.tmpdir(), "excluir-zips-")),
        RAIZ_MARCAS: await fs.mkdtemp(path.join(os.tmpdir(), "excluir-marcas-")),
    });
    conexao = new ConexaoPostgres();
    await conexao.open();
    ({ id_operador: idOperador } = await new OperadorCtrl(conexao, 0).criarOperador({ nome: "Quem exclui", login: unico("exclui"), senha: "senha-de-quem-exclui" }));
    alvo = await eventoCompleto("Evento Para Excluir");
    vizinho = await eventoCompleto("Evento Vizinho");
});

// O caminho de verdade de uma foto até o VPS: a mesma chamada que a estação faz ao publicar.
async function publicar(idEvento: number, idVinculo: number | null, hash: string): Promise<{ ok: true }> {
    const transacao = new ConexaoPostgres();
    await transacao.openTransaction();
    try {
        return await new FotoCtrl(transacao).publicarFoto(
            {
                id_evento: idEvento,
                id_evento_fotografo: idVinculo,
                hash_arquivo: hash,
                largura: 100,
                altura: 100,
                bytes_web: 10,
                capturada_em: null,
                camera: null,
                rostos: [{ embedding: new Array(512).fill(0.01), bbox: [1, 2, 30, 40], det_score: 0.9, area_px: 900 }],
            },
            { web: Buffer.from("web"), thumb: Buffer.from("thumb"), previa: Buffer.from("previa") }
        );
    } finally {
        await transacao.close();
    }
}

// Um evento com tudo o que um evento de verdade junta: fotógrafo, fotos com rosto, uma busca
// com resultado, um ZIP e a marca d'água, no banco e no disco.
async function eventoCompleto(nome: string): Promise<{ id: number; slug: string }> {
    const slug = unico("evento-excluir");
    const evento = await new EventoCtrl(conexao).criarEvento({ nome, slug, tipo: "esportivo", data_fim: "2026-12-31" });
    const fotografos = new FotografoCtrl(conexao);
    const fotografo = await fotografos.criarFotografo({ nome: "Fotógrafa", telefone: null });
    const vinculo = await fotografos.vincularFotografo(evento.id_evento, fotografo.id_fotografo);

    for (const letra of ["a", "b"]) await publicar(evento.id_evento, vinculo.id_evento_fotografo, `${letra}${sufixo}`.padEnd(64, letra));
    const [busca] = await conexao.queryParam<{ id_busca: number }>(
        `INSERT INTO busca (id_evento, token, status, qtd_fotos, consentimento_em, versao_termo)
         VALUES (?, ?, 'liberada', 1, now(), 'v1') RETURNING id_busca`,
        [evento.id_evento, unico("tok")]
    );
    await conexao.executeParamCount(
        "INSERT INTO busca_foto (id_busca, id_foto, similaridade) SELECT ?, id_foto, 0.9 FROM foto WHERE id_evento = ? LIMIT 1",
        [busca.id_busca, evento.id_evento]
    );
    await conexao.executeParamCount("INSERT INTO arquivo_zip (id_evento, id_busca, status, expira_em) VALUES (?, ?, 'pronto', now() + interval '1 day')", [
        evento.id_evento,
        busca.id_busca,
    ]);
    await fs.mkdir(path.join(config.raizZips, String(evento.id_evento)), { recursive: true });
    await fs.writeFile(path.join(config.raizZips, String(evento.id_evento), "parte-1.zip"), "zip");
    await fs.writeFile(path.join(config.raizMarcas, `${evento.id_evento}.png`), "png");
    return { id: evento.id_evento, slug };
}

async function contar(tabela: string, idEvento: number): Promise<number> {
    const [linha] = await conexao.queryParam<{ n: number }>(`SELECT count(*)::int AS n FROM ${tabela} WHERE id_evento = ?`, [idEvento]);
    return linha.n;
}

const existe = (caminho: string) =>
    fs.access(caminho).then(
        () => true,
        () => false
    );

async function recusado(promessa: Promise<unknown>, mensagem: RegExp): Promise<void> {
    await assert.rejects(promessa, (erro) => erro instanceof ErroTratado && mensagem.test(erro.message));
}


test("obterEvento diz quantas fotos o evento tem, para a janela da exclusão", async () => {
    assert.strictEqual((await new EventoCtrl(conexao).obterEvento(alvo.id)).qtd_fotos, 2);
});

test("nome errado recusa e não apaga nada", async () => {
    await recusado(new EventoCtrl(conexao).excluirEvento(alvo.id, "Evento para excluir", idOperador), /não confere/);
    await recusado(new EventoCtrl(conexao).excluirEvento(alvo.id, "", idOperador), /não confere/);

    assert.strictEqual(await contar("foto", alvo.id), 2);
    assert.strictEqual(await existe(path.join(config.raizFotos, String(alvo.id))), true);
});

test("evento que não existe avisa", async () => {
    await recusado(new EventoCtrl(conexao).excluirEvento(999_999_999, "Qualquer", idOperador), /não encontrado/);
});

test("com o nome certo (espaços nas pontas não contam), apaga tudo do evento, do banco e do disco", async () => {
    const resposta = await new EventoCtrl(conexao).excluirEvento(alvo.id, "  Evento Para Excluir ", idOperador);

    assert.deepStrictEqual(resposta, { ok: true });
    for (const tabela of ["evento", "foto", "rosto", "busca", "arquivo_zip", "evento_fotografo"]) assert.strictEqual(await contar(tabela, alvo.id), 0, tabela);
    assert.strictEqual(await existe(path.join(config.raizFotos, String(alvo.id))), false);
    assert.strictEqual(await existe(path.join(config.raizZips, String(alvo.id))), false);
    assert.strictEqual(await existe(path.join(config.raizMarcas, `${alvo.id}.png`)), false);
});

test("fica o registro de quem excluiu, quando e quantas fotos o evento tinha", async () => {
    const [registro] = await conexao.queryParam<{ nome: string; slug: string; qtd_fotos: number; id_operador: number; excluido_em: Date }>(
        "SELECT nome, slug, qtd_fotos, id_operador, excluido_em FROM evento_excluido WHERE id_evento = ?",
        [alvo.id]
    );
    assert.deepStrictEqual(
        { nome: registro.nome, slug: registro.slug, qtd_fotos: registro.qtd_fotos, id_operador: registro.id_operador },
        { nome: "Evento Para Excluir", slug: alvo.slug, qtd_fotos: 2, id_operador: idOperador }
    );
    assert.ok(registro.excluido_em);
});

test("o evento vizinho não é tocado", async () => {
    assert.strictEqual(await contar("foto", vizinho.id), 2);
    assert.strictEqual(await contar("busca", vizinho.id), 1);
    assert.strictEqual(await existe(path.join(config.raizFotos, String(vizinho.id))), true);
    assert.strictEqual(await existe(path.join(config.raizMarcas, `${vizinho.id}.png`)), true);
});

test("o mesmo endereço fica livre para um evento novo", async () => {
    const novo = await new EventoCtrl(conexao).criarEvento({ nome: "De novo", slug: alvo.slug, tipo: "social", data_fim: "2026-12-31" });
    assert.notStrictEqual(novo.id_evento, alvo.id);
});

test("a sincronização avisa a estação, para ela apagar a parte dela", async () => {
    const payload = await new SincronizacaoCtrl(conexao).getSincronizacao();

    assert.ok(payload.eventos_excluidos.includes(alvo.id));
    assert.ok(!payload.eventos.some((e) => e.id_evento === alvo.id));
});

test("foto que a estação publica depois da exclusão é aceita e descartada", async () => {
    // Responder erro faria a estação tentar de novo para sempre uma foto de evento que não existe.
    const resposta = await publicar(alvo.id, null, "c".repeat(64));

    assert.deepStrictEqual(resposta, { ok: true });
    assert.strictEqual(await contar("foto", alvo.id), 0);
    assert.strictEqual(await existe(path.join(config.raizFotos, String(alvo.id))), false);
});

after(async () => {
    await conexao?.close();
});

// Fecha o pool: sem isso o processo de teste fica ~30s ocioso antes de sair.
after(async () => {
    await fecharBanco();
});
