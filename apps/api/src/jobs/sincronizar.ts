import fs from "node:fs/promises";
import path from "node:path";
import { Queue } from "bullmq";
import ConexaoPostgres from "../db/conexaoPostgres";
import { config } from "../services/config";
import { chamarVps } from "../services/vpsHttp";
import { criarFila, criarWorker } from "../services/fila";
import { PayloadSincronizacao } from "../_ESTACAO/sincronizacao/i.sincronizacao";
import { registrarSincronizacao } from "../services/sincronizacaoEstacao";

const NOME_FILA = "sincronizar";

export async function processarSincronizar(conexao: ConexaoPostgres): Promise<void> {
    const payload = (await chamarVps("/api/estacao/sincronizacao", { call: "getSincronizacao" })) as PayloadSincronizacao;

    await conexao.openTransaction();
    try {
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
