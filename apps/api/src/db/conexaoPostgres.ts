import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { config } from "../services/config";

let pool: Pool | undefined;

function obterPool(): Pool {
    if (!pool) {
        pool = new Pool({
            host: config.postgres.host,
            port: config.postgres.porta,
            user: config.postgres.usuario,
            password: config.postgres.senha,
            database: config.postgres.banco,
            max: 20,
            idleTimeoutMillis: 30_000,
            connectionTimeoutMillis: 5_000,
            statement_timeout: 30_000,
            keepAlive: true,
            application_name: `fotos-api:${config.papel}`,
        });
        pool.on("error", (erro) => console.error("[Postgres] Erro inesperado no pool:", erro.message));
    }
    return pool;
}

export async function fecharBanco(): Promise<void> {
    const atual = pool;
    pool = undefined;
    await atual?.end();
}

// Aceita `?` posicional (traduzido para $N) ou `$N` nativo, nunca os dois na mesma query:
// numerar os `?` a partir de 1 colidiria com os $N escritos à mão.
export function parseParams(sql: string, valores: unknown[]): { text: string; values: unknown[] } {
    // Primeiro, verifica mistura de ? e $N, ignorando conteúdo de strings.
    let inString = false;
    let temInterrogacao = false;
    let temNativo = false;

    for (let i = 0; i < sql.length; i++) {
        if (sql[i] === "'") {
            if (i + 1 < sql.length && sql[i + 1] === "'") {
                // Aspas escapadas '' — pula ambas
                i++;
            } else {
                // Abre ou fecha a string
                inString = !inString;
            }
        } else if (!inString) {
            if (sql[i] === "?") {
                temInterrogacao = true;
            } else if (sql[i] === "$" && i + 1 < sql.length && /\d/.test(sql[i + 1])) {
                temNativo = true;
            }
        }
    }

    if (temInterrogacao && temNativo)
        throw new Error("SQL mistura placeholder `?` com `$N`: use apenas uma das duas sintaxes");

    if (temNativo) return { text: sql, values: valores };

    // Traduz ? para $N, ignorando placeholders dentro de strings.
    const values: unknown[] = [];
    let valIdx = 0;
    let result = "";
    inString = false;

    for (let i = 0; i < sql.length; i++) {
        if (sql[i] === "'") {
            if (i + 1 < sql.length && sql[i + 1] === "'") {
                // Aspas escapadas — copia ambas
                result += "''";
                i++;
            } else {
                // Abre ou fecha a string
                inString = !inString;
                result += "'";
            }
        } else if (sql[i] === "?" && !inString) {
            values.push(valores[valIdx] ?? null);
            valIdx++;
            result += `$${valIdx}`;
        } else {
            result += sql[i];
        }
    }

    return { text: result, values };
}

export default class ConexaoPostgres {
    private client: PoolClient | null = null;
    private aberta = false;
    private emTransacao = false;
    private comErro = false;

    async open(): Promise<boolean> {
        await this.liberar();
        obterPool();
        this.aberta = true;
        this.comErro = false;
        return true;
    }

    async openTransaction(): Promise<boolean> {
        await this.open();
        this.client = await obterPool().connect();
        await this.client.query("BEGIN");
        this.emTransacao = true;
        return true;
    }

    async queryParam<T extends QueryResultRow = QueryResultRow>(sql: string, valores: unknown[] = []): Promise<T[]> {
        return (await this.executar<T>(sql, valores)).rows;
    }

    async queryOneParam<T extends QueryResultRow = QueryResultRow>(
        sql: string,
        valores: unknown[] = []
    ): Promise<T | undefined> {
        return (await this.queryParam<T>(sql, valores))[0];
    }

    async executeParamCount(sql: string, valores: unknown[] = []): Promise<number> {
        return (await this.executar(sql, valores)).rowCount ?? 0;
    }

    async commit(): Promise<boolean> {
        if (!this.client) throw new Error("Nenhuma transação aberta");
        await this.client.query("COMMIT");
        this.emTransacao = false;
        return true;
    }

    async rollback(): Promise<boolean> {
        if (!this.client) throw new Error("Nenhuma transação aberta");
        await this.client.query("ROLLBACK");
        this.emTransacao = false;
        return true;
    }

    async close(): Promise<boolean> {
        let erroTransacao: Error | undefined;
        try {
            if (this.client && this.emTransacao) {
                if (this.comErro) await this.rollback();
                else await this.commit();
            }
        } catch (erro) {
            erroTransacao = erro instanceof Error ? erro : new Error(String(erro));
            console.error("[Postgres] Erro ao encerrar a transação:", erroTransacao.message);
        } finally {
            await this.liberar(erroTransacao);
        }
        return true;
    }

    private async executar<T extends QueryResultRow = QueryResultRow>(
        sql: string,
        valores: unknown[]
    ): Promise<QueryResult<T>> {
        if (!this.aberta) throw new Error("Conexão não aberta (chame open())");
        const { text, values } = parseParams(sql, valores);
        try {
            if (this.client) return await this.client.query<T>(text, values);
            return await obterPool().query<T>(text, values);
        } catch (erro) {
            this.comErro = true;
            // Sem os parâmetros: podem conter telefone ou embedding.
            const erroFormatado = erro instanceof Error ? erro : new Error(String(erro));
            console.error("[Postgres] Erro na query:", erroFormatado.message);
            console.error("[Postgres] SQL:", sql);
            throw erro;
        }
    }

    private async liberar(erro?: Error): Promise<void> {
        if (!this.client) {
            this.aberta = false;
            this.emTransacao = false;
            return;
        }

        let erroParaDestruir: Error | undefined = erro;

        if (!erro && this.emTransacao) {
            // Transação não foi fechada explicitamente — faz rollback para não danificar a conexão do pool.
            try {
                await this.client.query("ROLLBACK");
            } catch (erroRaw) {
                erroParaDestruir = erroRaw instanceof Error ? erroRaw : new Error(String(erroRaw));
                console.error("[Postgres] Erro ao fazer rollback na transação:", erroParaDestruir.message);
            }
        }

        try {
            if (erroParaDestruir) {
                this.client.release(erroParaDestruir);
            } else {
                this.client.release();
            }
        } catch (erroRelease) {
            console.error("[Postgres] Erro ao devolver a conexão ao pool:", erroRelease);
        }

        this.client = null;
        this.aberta = false;
        this.emTransacao = false;
    }
}
