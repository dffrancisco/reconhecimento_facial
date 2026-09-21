import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { ErroTratado } from "../../services/erro";
import { gerarChave } from "../../services/aleatorio";
import { config } from "../../services/config";
import { ConfigEvento, LinhaEvento } from "./i.evento";
import { atualizarEventoSql, inserirEvento, listarEventosSql, obterEventoSql } from "./sql.evento";

const SLUG_VALIDO = /^[a-z0-9]+(-[a-z0-9]+)*$/;

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
        data_inicio?: string;
        data_fim: string;
    }): Promise<LinhaEvento> {
        if (dados.tipo !== "esportivo" && dados.tipo !== "social")
            throw new ErroTratado('tipo deve ser "esportivo" ou "social"');
        if (!SLUG_VALIDO.test(dados.slug))
            throw new ErroTratado("slug deve ter só letras minúsculas, números e hífen (ex.: corrida-da-serra-2026)");

        const privado = dados.privado ?? dados.tipo === "social";
        return inserirEvento(this.conexao, {
            nome: dados.nome,
            slug: dados.slug,
            tipo: dados.tipo,
            privado: privado ? "S" : "N",
            chave_acesso: privado ? gerarChave() : null,
            chave_anfitriao: gerarChave(),
            data_inicio: dados.data_inicio ?? null,
            data_fim: dados.data_fim,
            config: configPadrao(dados.tipo, dados.nome),
        });
    }

    async listarEventos(): Promise<LinhaEvento[]> {
        return listarEventosSql(this.conexao);
    }

    async obterEvento(idEvento: number): Promise<LinhaEvento> {
        const evento = await obterEventoSql(this.conexao, idEvento);
        if (!evento) throw new ErroTratado("Evento não encontrado.");
        return evento;
    }

    async editarEvento(dados: {
        id_evento: number;
        nome?: string;
        data_inicio?: string | null;
        data_fim?: string;
        ativo?: boolean;
        privado?: boolean;
        config?: Partial<ConfigEvento>;
    }): Promise<LinhaEvento> {
        const atual = await this.obterEvento(dados.id_evento);
        const privado = dados.privado ?? atual.privado === "S";
        await atualizarEventoSql(this.conexao, dados.id_evento, {
            nome: dados.nome ?? atual.nome,
            data_inicio: dados.data_inicio !== undefined ? dados.data_inicio : atual.data_inicio,
            data_fim: dados.data_fim ?? atual.data_fim,
            ativo: (dados.ativo ?? atual.ativo === "S") ? "S" : "N",
            privado: privado ? "S" : "N",
            // Gera a chave na hora em que o evento vira privado pela primeira vez.
            chave_acesso: privado ? (atual.chave_acesso ?? gerarChave()) : null,
            config: dados.config ? mesclarConfig(atual.config, dados.config) : atual.config,
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
}
