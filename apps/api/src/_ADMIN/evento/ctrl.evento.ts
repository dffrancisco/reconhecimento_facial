import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { ErroTratado } from "../../services/erro";
import { gerarChave } from "../../services/aleatorio";
import { config } from "../../services/config";
import { pastaDoEvento } from "../../services/caminhos";
import { ConfigEvento, EventoComLinks, LinhaEvento } from "./i.evento";
import { montarLinks, slugRepetido, slugValido, validarConfig, validarDatas, validarNome } from "./regras";
import { apagarEventoSql, atualizarEventoSql, inserirEvento, listarEventosSql, obterEventoSql, travarEvento } from "./sql.evento";

function exigir(erro: string | null): void {
    if (erro) throw new ErroTratado(erro);
}

function configValida(bruto: unknown): Partial<ConfigEvento> {
    const r = validarConfig(bruto);
    if ("erro" in r) throw new ErroTratado(r.erro);
    return r.valores;
}

export function configPadrao(tipo: "esportivo" | "social", nomeEvento: string): ConfigEvento {
    return {
        limiar: 0.42,
        exigir_whatsapp: tipo === "esportivo",
        marca_dagua: false,
        organizador: nomeEvento,
        dias_expurgo: 90,
        validade_resultado_dias: null,
        max_selfies: 3,
    };
}

export function mesclarConfig(atual: ConfigEvento, novo: Partial<ConfigEvento>): ConfigEvento {
    return { ...atual, ...novo };
}

export default class EventoCtrl {
    constructor(private conexao: ConexaoPostgres) {}

    async criarEvento(dados: {
        nome: string;
        slug: string;
        tipo: string;
        privado?: boolean;
        data_inicio?: string | null;
        data_fim: string;
        config?: unknown;
    }): Promise<LinhaEvento> {
        if (dados.tipo !== "esportivo" && dados.tipo !== "social")
            throw new ErroTratado('tipo deve ser "esportivo" ou "social"');
        if (!slugValido(dados.slug))
            throw new ErroTratado("O endereço deve ter só letras minúsculas, números e hífen, até 80 caracteres (ex.: corrida-da-serra-2026).");
        exigir(validarNome(dados.nome));
        const dataInicio = dados.data_inicio || null;
        exigir(validarDatas(dataInicio, dados.data_fim));
        const extra = configValida(dados.config);

        const nome = dados.nome.trim();
        const privado = dados.privado ?? dados.tipo === "social";
        try {
            return await inserirEvento(this.conexao, {
                nome,
                slug: dados.slug,
                tipo: dados.tipo,
                privado: privado ? "S" : "N",
                chave_acesso: privado ? gerarChave() : null,
                chave_anfitriao: gerarChave(),
                data_inicio: dataInicio,
                data_fim: dados.data_fim,
                config: mesclarConfig(configPadrao(dados.tipo, nome), extra),
            });
        } catch (erro) {
            if (slugRepetido(erro)) throw new ErroTratado("Esse endereço já é de outro evento.", "endereco_repetido");
            throw erro;
        }
    }

    async listarEventos(): Promise<LinhaEvento[]> {
        return listarEventosSql(this.conexao);
    }

    async obterEvento(idEvento: number): Promise<EventoComLinks> {
        const evento = await obterEventoSql(this.conexao, idEvento);
        if (!evento) throw new ErroTratado("Evento não encontrado.");
        return { ...evento, links: montarLinks(config.enderecoParticipante, evento) };
    }

    async editarEvento(dados: {
        id_evento: number;
        nome?: string;
        data_inicio?: string | null;
        data_fim?: string;
        ativo?: boolean;
        privado?: boolean;
        config?: unknown;
    }): Promise<EventoComLinks> {
        const atual = await this.obterEvento(dados.id_evento);
        const nome = dados.nome !== undefined ? dados.nome : atual.nome;
        exigir(validarNome(nome));
        // "" chega da tela quando o operador apaga o início: é evento sem data de início.
        const dataInicio = dados.data_inicio !== undefined ? dados.data_inicio || null : atual.data_inicio;
        const dataFim = dados.data_fim ?? atual.data_fim;
        exigir(validarDatas(dataInicio, dataFim));
        const extra = configValida(dados.config);

        const privado = dados.privado ?? atual.privado === "S";
        await atualizarEventoSql(this.conexao, dados.id_evento, {
            nome: nome.trim(),
            data_inicio: dataInicio,
            data_fim: dataFim,
            ativo: (dados.ativo ?? atual.ativo === "S") ? "S" : "N",
            privado: privado ? "S" : "N",
            // Gera a chave na hora em que o evento vira privado pela primeira vez.
            chave_acesso: privado ? (atual.chave_acesso ?? gerarChave()) : null,
            config: mesclarConfig(atual.config, extra),
        });
        return this.obterEvento(dados.id_evento);
    }

    async subirMarcaDagua(idEvento: number, png: { data: Buffer; mimetype: string; size: number }): Promise<{ ok: true }> {
        await this.obterEvento(idEvento);
        if (png.mimetype !== "image/png") throw new ErroTratado("A marca d'água deve ser um PNG.");
        if (png.size > 2 * 1024 * 1024) throw new ErroTratado("A marca d'água deve ter até 2 MB.");

        // Recodifica com sharp: além de validar que é um PNG de verdade, remove metadados.
        const normalizado = await sharp(png.data).png().toBuffer();
        await fs.mkdir(config.raizMarcas, { recursive: true });
        await fs.writeFile(path.join(config.raizMarcas, `${idEvento}.png`), normalizado);
        return { ok: true };
    }

    // Sem volta: o nome digitado é conferido aqui também, e não só na tela. O banco vai numa
    // transação própria e o disco só depois do COMMIT: se o rm falhar, sobra arquivo sem dono,
    // nunca evento sem foto. A estação apaga a parte dela ao ver o id em `eventos_excluidos`.
    async excluirEvento(idEvento: number, nomeConfirmacao: unknown, idOperador: number): Promise<{ ok: true }> {
        const transacao = new ConexaoPostgres();
        await transacao.openTransaction();
        try {
            // Um evento grande passa dos 30 s do statement_timeout de sempre.
            await transacao.executeParamCount("SET LOCAL statement_timeout = '5min'");
            const evento = await travarEvento(transacao, idEvento);
            if (!evento) throw new ErroTratado("Evento não encontrado.");
            if (typeof nomeConfirmacao !== "string" || nomeConfirmacao.trim() !== evento.nome.trim())
                throw new ErroTratado("O nome digitado não confere com o do evento.");
            await apagarEventoSql(transacao, idEvento, { ...evento, idOperador });
        } catch (erro) {
            transacao.marcarErro();
            throw erro;
        } finally {
            await transacao.close();
        }

        const id = String(idEvento);
        for (const alvo of [pastaDoEvento(config.raizFotos, id), pastaDoEvento(config.raizZips, id), path.join(config.raizMarcas, `${id}.png`)]) {
            if (!alvo) continue;
            await fs.rm(alvo, { recursive: true, force: true }).catch((erro) =>
                console.error(`[Evento] Excluído o evento ${id}, mas ${alvo} ficou no disco:`, (erro as Error).message)
            );
        }
        return { ok: true };
    }
}
