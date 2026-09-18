import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { deveRodar, iMigracao, interpretarMigracao, nomeDeMigracaoValido, tAlvo, tPapel } from "./migrateParse";

export interface iArquivoMigracao {
    versao: string;
    nome: string;
    caminho: string;
}

export function listarMigracoes(dir: string): iArquivoMigracao[] {
    if (!fs.existsSync(dir)) return [];
    const arquivos = fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".sql"))
        .sort();

    const invalidos = arquivos.filter((f) => !nomeDeMigracaoValido(f));
    if (invalidos.length)
        throw new Error(`Nome de migração fora do padrão AAAAMMDDHHMMSS_nome.sql: ${invalidos.join(", ")}`);

    return arquivos.map((f) => ({ versao: f.replace(/\.sql$/, ""), nome: f, caminho: path.join(dir, f) }));
}

export function criarArquivo(dir: string, nome: string, alvo: tAlvo, agora = new Date()): string {
    const slug = nome
        .trim()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
    if (!slug) throw new Error("Informe um nome para a migração");

    const p = (n: number) => String(n).padStart(2, "0");
    const carimbo =
        `${agora.getFullYear()}${p(agora.getMonth() + 1)}${p(agora.getDate())}` +
        `${p(agora.getHours())}${p(agora.getMinutes())}${p(agora.getSeconds())}`;
    const arquivo = `${carimbo}_${slug}.sql`;

    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
        path.join(dir, arquivo),
        `-- migrate:target ${alvo}\n-- migrate:up\n\n\n-- migrate:down\n\n`,
        {
            flag: "wx",
        }
    );
    return arquivo;
}

/** Mesma mensagem em prepararControle e situacao — extraída para não duplicar. */
function checarPapelDoBanco(papelBanco: string, papel: tPapel): void {
    if (papelBanco !== papel)
        throw new Error(
            `Este banco pertence ao papel "${papelBanco}", não a "${papel}". Confira PAPEL e POSTGRES_DB.`
        );
}

export async function prepararControle(client: Client, papel: tPapel): Promise<void> {
    await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version    varchar(255) PRIMARY KEY,
            name       varchar(255) NOT NULL,
            applied_at timestamptz  NOT NULL DEFAULT now()
        )`);
    await client.query(`
        CREATE TABLE IF NOT EXISTS schema_papel (
            unica boolean     PRIMARY KEY DEFAULT true CHECK (unica),
            papel varchar(10) NOT NULL
        )`);
    await client.query("INSERT INTO schema_papel (papel) VALUES ($1) ON CONFLICT (unica) DO NOTHING", [papel]);

    const { rows } = await client.query<{ papel: string }>("SELECT papel FROM schema_papel");
    checarPapelDoBanco(rows[0].papel, papel);
}

async function versoesAplicadas(client: Client): Promise<string[]> {
    const { rows } = await client.query<{ version: string }>(
        "SELECT version FROM schema_migrations ORDER BY version"
    );
    return rows.map((r) => r.version);
}

function ler(arquivo: iArquivoMigracao): iMigracao {
    return interpretarMigracao(fs.readFileSync(arquivo.caminho, "utf8"), arquivo.nome);
}

async function emTransacao(client: Client, semTransacao: boolean, executar: () => Promise<void>): Promise<void> {
    if (semTransacao) return executar();
    await client.query("BEGIN");
    try {
        await executar();
        await client.query("COMMIT");
    } catch (erro) {
        await client.query("ROLLBACK").catch(() => {});
        throw erro;
    }
}

export async function aplicarPendentes(
    client: Client,
    arquivos: iArquivoMigracao[],
    papel: tPapel
): Promise<string[]> {
    // Interpreta todas antes de aplicar a primeira: um arquivo malformado não deixa o banco pela metade.
    const migracoes = arquivos.map((arquivo) => ({ arquivo, migracao: ler(arquivo) }));

    await prepararControle(client, papel);
    const aplicadas = new Set(await versoesAplicadas(client));
    const feitas: string[] = [];

    for (const { arquivo, migracao } of migracoes) {
        if (aplicadas.has(arquivo.versao) || !deveRodar(migracao.alvo, papel)) continue;
        try {
            await emTransacao(client, migracao.semTransacao, async () => {
                await client.query(migracao.up);
                await client.query("INSERT INTO schema_migrations (version, name) VALUES ($1, $2)", [
                    arquivo.versao,
                    arquivo.nome,
                ]);
            });
        } catch (erro) {
            throw new Error(`Falha em ${arquivo.versao}: ${(erro as Error).message}`);
        }
        feitas.push(arquivo.versao);
    }
    return feitas;
}

export async function reverterUltima(
    client: Client,
    arquivos: iArquivoMigracao[],
    papel: tPapel
): Promise<string | null> {
    await prepararControle(client, papel);
    const aplicadas = await versoesAplicadas(client);
    const ultima = aplicadas[aplicadas.length - 1];
    if (!ultima) return null;

    const arquivo = arquivos.find((a) => a.versao === ultima);
    if (!arquivo) throw new Error(`Arquivo da migração ${ultima} não encontrado em db/migrations`);

    const migracao = ler(arquivo);
    if (!migracao.down) throw new Error(`A migração ${ultima} não tem seção "-- migrate:down"`);

    try {
        await emTransacao(client, migracao.semTransacao, async () => {
            await client.query(migracao.down);
            await client.query("DELETE FROM schema_migrations WHERE version = $1", [ultima]);
        });
    } catch (erro) {
        throw new Error(`Falha ao reverter ${ultima}: ${(erro as Error).message}`);
    }
    return ultima;
}

export async function situacao(
    client: Client,
    arquivos: iArquivoMigracao[],
    papel: tPapel
): Promise<{ versao: string; aplicada: boolean }[]> {
    // status é somente-leitura: não cria as tabelas de controle nem grava o papel do banco.
    const { rows: papelReg } = await client.query<{ reg: string | null }>(
        "SELECT to_regclass('public.schema_papel') AS reg"
    );
    if (papelReg[0].reg) {
        const { rows } = await client.query<{ papel: string }>("SELECT papel FROM schema_papel");
        checarPapelDoBanco(rows[0].papel, papel);
    }

    const { rows: migracoesReg } = await client.query<{ reg: string | null }>(
        "SELECT to_regclass('public.schema_migrations') AS reg"
    );
    const aplicadas = migracoesReg[0].reg ? new Set(await versoesAplicadas(client)) : new Set<string>();

    return arquivos
        .filter((a) => deveRodar(ler(a).alvo, papel))
        .map((a) => ({ versao: a.versao, aplicada: aplicadas.has(a.versao) }));
}
