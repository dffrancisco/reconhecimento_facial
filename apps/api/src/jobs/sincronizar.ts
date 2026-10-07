import fs from "node:fs/promises";
import path from "node:path";
import { Queue } from "bullmq";
import ConexaoPostgres from "../db/conexaoPostgres";
import { config } from "../services/config";
import { chamarVps } from "../services/vpsHttp";
import { criarFila, criarWorker } from "../services/fila";
import { PayloadSincronizacao } from "../_ESTACAO/sincronizacao/i.sincronizacao";
import { registrarSincronizacao } from "../services/sincronizacaoEstacao";
import { pastaDoEvento } from "../services/caminhos";
import { slugValido } from "../_ADMIN/evento/regras";
import { caminhoParcial } from "../_FOTOGRAFO/upload/ctrl.upload";

const NOME_FILA = "sincronizar";

// Evento excluído no VPS: apaga do banco o que a estação tem dele e devolve o que apagar do
// disco depois do COMMIT. Id que a estação não tem (já apagado, ou nunca veio) não faz nada.
async function excluirEventosLocais(conexao: ConexaoPostgres, ids: number[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const eventos = await conexao.queryParam<{ id_evento: number; slug: string }>(
        "SELECT id_evento, slug FROM evento WHERE id_evento = ANY(?::int[])",
        [ids]
    );
    if (eventos.length === 0) return [];
    const presentes = eventos.map((e) => e.id_evento);

    // Um evento grande passa dos 30 s do statement_timeout de sempre.
    await conexao.executeParamCount("SET LOCAL statement_timeout = '5min'");
    const uploads = await conexao.queryParam<{ id_upload: number }>(
        `SELECT u.id_upload FROM upload u JOIN evento_fotografo ef ON ef.id_evento_fotografo = u.id_evento_fotografo
          WHERE ef.id_evento = ANY(?::int[])`,
        [presentes]
    );
    // `upload` e `foto` apontam para o vínculo e para o evento sem cascade: saem antes deles.
    await conexao.executeParamCount(
        "DELETE FROM upload WHERE id_evento_fotografo IN (SELECT id_evento_fotografo FROM evento_fotografo WHERE id_evento = ANY(?::int[]))",
        [presentes]
    );
    await conexao.executeParamCount("DELETE FROM foto WHERE id_evento = ANY(?::int[])", [presentes]);
    await conexao.executeParamCount("DELETE FROM evento_fotografo WHERE id_evento = ANY(?::int[])", [presentes]);
    await conexao.executeParamCount("DELETE FROM evento WHERE id_evento = ANY(?::int[])", [presentes]);

    const caminhos: (string | null)[] = uploads.map((u) => caminhoParcial(u.id_upload));
    for (const ev of eventos) {
        // Os originais ficam na pasta do slug: um slug fora da regra poderia apontar para a raiz.
        if (slugValido(ev.slug)) caminhos.push(pastaDoEvento(config.raizOriginais, ev.slug));
        else console.error(`[Sincronizar] Evento ${ev.id_evento} excluído com slug inválido (${ev.slug}): os originais ficaram no disco.`);
        caminhos.push(pastaDoEvento(config.raizPublicar, String(ev.id_evento)), path.join(config.raizMarcas, `${ev.id_evento}.png`));
    }
    return caminhos.filter((c): c is string => c !== null);
}

export async function processarSincronizar(conexao: ConexaoPostgres): Promise<void> {
    const payload = (await chamarVps("/api/estacao/sincronizacao", { call: "getSincronizacao" })) as PayloadSincronizacao;

    let paraApagar: string[] = [];
    await conexao.openTransaction();
    try {
        // Antes dos eventos: um evento novo com o slug de um excluído colidiria com a linha velha.
        paraApagar = await excluirEventosLocais(conexao, payload.eventos_excluidos ?? []);

        for (const op of payload.operadores)
            await conexao.executeParamCount(
                `INSERT INTO operador (id_operador, nome, login, senha_hash, deletado) VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT (id_operador) DO UPDATE SET nome = EXCLUDED.nome, login = EXCLUDED.login,
                     senha_hash = EXCLUDED.senha_hash, deletado = EXCLUDED.deletado`,
                [op.id_operador, op.nome, op.login, op.senha_hash, op.deletado]
            );

        for (const ev of payload.eventos)
            await conexao.executeParamCount(
                `INSERT INTO evento (id_evento, nome, slug, tipo, privado, chave_acesso, chave_anfitriao, data_inicio, data_fim, ativo, config)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT (id_evento) DO UPDATE SET nome = EXCLUDED.nome, slug = EXCLUDED.slug, tipo = EXCLUDED.tipo,
                     privado = EXCLUDED.privado, chave_acesso = EXCLUDED.chave_acesso, chave_anfitriao = EXCLUDED.chave_anfitriao,
                     data_inicio = EXCLUDED.data_inicio, data_fim = EXCLUDED.data_fim, ativo = EXCLUDED.ativo, config = EXCLUDED.config`,
                [ev.id_evento, ev.nome, ev.slug, ev.tipo, ev.privado, ev.chave_acesso, ev.chave_anfitriao, ev.data_inicio, ev.data_fim, ev.ativo, JSON.stringify(ev.config)]
            );

        for (const f of payload.fotografos)
            await conexao.executeParamCount(
                `INSERT INTO fotografo (id_fotografo, nome, telefone, deletado) VALUES (?, ?, ?, ?)
                 ON CONFLICT (id_fotografo) DO UPDATE SET nome = EXCLUDED.nome, telefone = EXCLUDED.telefone, deletado = EXCLUDED.deletado`,
                [f.id_fotografo, f.nome, f.telefone, f.deletado]
            );

        for (const v of payload.vinculos)
            await conexao.executeParamCount(
                `INSERT INTO evento_fotografo (id_evento_fotografo, id_evento, id_fotografo, token_upload, ativo) VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT (id_evento_fotografo) DO UPDATE SET id_evento = EXCLUDED.id_evento, id_fotografo = EXCLUDED.id_fotografo,
                     token_upload = EXCLUDED.token_upload, ativo = EXCLUDED.ativo`,
                [v.id_evento_fotografo, v.id_evento, v.id_fotografo, v.token_upload, v.ativo]
            );
    } catch (erro) {
        conexao.marcarErro();
        throw erro;
    } finally {
        await conexao.close();
    }

    for (const caminho of paraApagar)
        await fs.rm(caminho, { recursive: true, force: true }).catch((erro) =>
            console.error(`[Sincronizar] Evento excluído, mas ${caminho} ficou no disco:`, (erro as Error).message)
        );

    for (const ev of payload.eventos) {
        if (!ev.marca_dagua_caminho) continue;
        const destino = path.join(config.raizMarcas, `${ev.id_evento}.png`);
        // O arquivo local carrega o mtime que a VPS informou: comparar os dois é o que faz a
        // marca trocada chegar aqui. Sem isso, a estação usaria a versão antiga para sempre.
        const versaoRemota = ev.marca_dagua_em ? new Date(ev.marca_dagua_em).getTime() : null;
        try {
            const local = await fs.stat(destino);
            if (versaoRemota === null || Math.abs(local.mtime.getTime() - versaoRemota) < 1000) continue;
        } catch {
            // não temos o arquivo: segue e baixa
        }
        try {
            const resposta = await fetch(`${config.vpsUrl}${ev.marca_dagua_caminho}`, { headers: { Authorization: config.estacaoChave } });
            if (!resposta.ok) continue;
            await fs.mkdir(config.raizMarcas, { recursive: true });
            await fs.writeFile(destino, Buffer.from(await resposta.arrayBuffer()));
            if (versaoRemota !== null) {
                const quando = new Date(versaoRemota);
                await fs.utimes(destino, quando, quando);
            }
        } catch (erro) {
            console.error(`[Sincronizar] Falha ao baixar a marca d'água do evento ${ev.id_evento}:`, (erro as Error).message);
        }
    }
}

export function iniciarWorkerSincronizar(): void {
    criarWorker(
        NOME_FILA,
        async () => {
            await processarSincronizar(new ConexaoPostgres());
            await registrarSincronizacao();
        },
        1
    );
}

export async function agendarSincronizacao(): Promise<Queue> {
    const fila = criarFila(NOME_FILA);
    await fila.add(NOME_FILA, {}, { attempts: 3 });
    await fila.add(NOME_FILA, {}, { repeat: { every: 60_000 }, jobId: "sincronizar-periodico", attempts: 3 });
    return fila;
}
