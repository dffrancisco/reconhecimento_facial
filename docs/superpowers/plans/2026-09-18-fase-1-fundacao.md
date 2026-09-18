# Fase 1 — Fundação: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Monorepo npm com a API Express nos dois papéis (estação e VPS), runner de migrations com alvo por papel, schema inicial das seções 5.1 e 5.2 e composes (dev, estação, VPS) com Postgres + pgvector e Redis.

**Architecture:** Um único pacote `apps/api` sobe como `PAPEL=estacao` ou `PAPEL=vps` e monta só as áreas do seu papel. Toda chamada de negócio passa pelo despachante `per` (`POST /api/<area>/<modulo>` com `{ call }`), que instancia o `Router` do módulo, abre a `ConexaoPostgres` e a fecha no `finally`. As migrations ficam em `db/`, um pacote à parte que roda tanto localmente quanto num container de uso único antes da API subir.

**Tech Stack:** Node 22, TypeScript 5.9 (`strict`, CommonJS), Express 5, express-fileupload, pg, ioredis 5, dotenv 17, tsx (`node:test`), PostgreSQL 16 + pgvector 0.8.1, Redis 7, Traefik 3.6, Docker Compose.

**Spec:** [docs/superpowers/specs/2026-09-18-plataforma-fotos-design.md](../specs/2026-09-18-plataforma-fotos-design.md) — seções 3, 4, 5 e 11. Leia o spec junto com este plano.

## Global Constraints

- Node 22 nas imagens (`node:22-bookworm-slim`). Localmente os testes também rodam no Node 20 (`tsx --test` recebe a lista de arquivos pelo shell, porque o Node 20 não aceita glob no `--test`).
- TypeScript `strict`, CommonJS, imports relativos (sem alias). npm workspaces.
- Estilo do `erp_server`: aspas duplas, `;` obrigatório, indentação de 4 espaços, `printWidth` 115 (o `.prettierrc` é criado na Task 1).
- Tudo em português: nomes, mensagens de erro, logs. Log com `console.log`/`console.error` e prefixo `[Componente]`.
- Comentários só para o porquê não óbvio.
- Erro de negócio: a `ctrl` devolve `{ msg, error: true }` (HTTP 200). `ErroTratado` vira HTTP 422 `{ msg }`. Qualquer outro erro vira HTTP 500 `{ msg: "Erro ao processar sua solicitação" }`, sem detalhe interno.
- Nunca logar parâmetros de query nem corpo de requisição (telefone, embedding e selfie são dado pessoal).
- Variável obrigatória do papel faltando: a API **encerra na inicialização** com a lista do que falta.
- Schema: tabelas no singular, PK `id_<tabela>`, flags `varchar(1)` `'S'/'N'` com `CHECK`, `timestamptz` para instantes, DDL idempotente (`IF NOT EXISTS`).
- Toda migration declara `-- migrate:target estacao|vps|ambos`. Sem diretiva, o runner recusa o arquivo.
- Imagens: `pgvector/pgvector:0.8.1-pg16`, `redis:7-alpine`, `traefik:v3.6` (o Docker 29 recusa a API antiga usada por Traefik < 3.6.1).
- Portas locais do dev: Postgres `127.0.0.1:5433`, Redis `127.0.0.1:6380`, API estação `127.0.0.1:3001`, API VPS `127.0.0.1:3002`.
- Todo commit termina com a linha `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## Fora desta fase

`vision`, `worker`, `web-*`, `cloudflared`, os volumes `/data/*`, autenticação do operador e `packages/shared` entram nas fases em que o primeiro consumidor aparece. As rotas de exceção ao RPC (`PUT /api/fotografo/upload/:id_upload`, webhook do WhatsApp) também.

## Mapa de arquivos

```
.
├── package.json                      # workspaces + scripts agregados
├── tsconfig.base.json
├── .prettierrc  .nvmrc  .gitignore  .dockerignore
├── README.md
├── docker-compose.dev.yml            # Postgres (2 bancos) + Redis + os 2 papéis
├── docker-compose.estacao.yml
├── docker-compose.vps.yml
├── .env.estacao.example  .env.vps.example
├── apps/api/
│   ├── package.json  tsconfig.json  tsconfig.build.json  Dockerfile  .env.example
│   ├── src/
│   │   ├── index.ts                  # entrada: config → app → listen → encerramento
│   │   ├── loadEnv.ts
│   │   ├── services/
│   │   │   ├── config.ts             # carregarConfig (pura) + objeto único `config`
│   │   │   ├── erro.ts               # ErroTratado
│   │   │   ├── per.ts                # despachante RPC
│   │   │   ├── servidor.ts           # criarApp
│   │   │   ├── saude.ts              # GET /test
│   │   │   └── redis.ts
│   │   ├── db/conexaoPostgres.ts     # pool único + ConexaoPostgres + parseParams
│   │   ├── routes/
│   │   │   ├── areas.ts              # papel → áreas
│   │   │   └── fotografoRoute.ts painelRoute.ts participanteRoute.ts
│   │   │       anfitriaoRoute.ts adminRoute.ts estacaoRoute.ts
│   │   └── _template/                # módulo modelo: route/ctrl/sql/i/.http
│   └── integracao/                   # testes com Postgres e Redis reais
├── db/
│   ├── package.json  tsconfig.json  Dockerfile
│   ├── loadEnv.ts
│   ├── migrateParse.ts               # funções puras
│   ├── migrador.ts                   # aplica/reverte com um pg.Client
│   ├── migrate.ts                    # CLI
│   ├── migrations/                   # 6 arquivos iniciais
│   └── integracao/                   # testes do runner e do schema
├── infra/
│   ├── postgres/dev-bancos.sql
│   ├── traefik/vps-dinamico.yml
│   └── certs/.gitkeep
└── docs/desenvolvimento.md
```

---

### Task 0: Branch de trabalho

- [ ] **Step 1: Criar a branch**

O spec tem alterações ainda não commitadas. Commite o spec antes (ou confirme com o usuário) e depois crie a branch:

```bash
git status --short
git checkout -b fase-1-fundacao
```

---

### Task 1: Monorepo e configuração da API

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.prettierrc`, `.nvmrc`, `.gitignore`
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/tsconfig.build.json`
- Create: `apps/api/src/services/config.ts`
- Test: `apps/api/src/services/config.test.ts`

**Interfaces:**
- Produces:
  - `type tPapel = "estacao" | "vps"`
  - `interface iConfig { papel: tPapel; porta: number; postgres: { host: string; porta: number; usuario: string; senha: string; banco: string }; redis: { url: string; prefixo: string }; estacaoChave: string; vpsUrl: string; arquivoSegredo: string }`
  - `carregarConfig(env: NodeJS.ProcessEnv): iConfig` — pura, lança `Error` com mensagem em português
  - `const config: iConfig` — objeto único, vazio até `iniciarConfig`
  - `iniciarConfig(env: NodeJS.ProcessEnv): iConfig` — preenche `config` e o devolve

- [ ] **Step 1: Arquivos da raiz**

`package.json`:

```json
{
    "name": "plataforma-fotos",
    "private": true,
    "engines": {
        "node": ">=22"
    },
    "workspaces": [
        "apps/api"
    ],
    "scripts": {
        "typecheck": "npm run typecheck --workspaces --if-present",
        "test": "npm run test --workspaces --if-present",
        "test:integracao": "npm run test:integracao --workspaces --if-present"
    }
}
```

`tsconfig.base.json`:

```json
{
    "compilerOptions": {
        "target": "ES2023",
        "module": "commonjs",
        "moduleResolution": "node",
        "strict": true,
        "esModuleInterop": true,
        "resolveJsonModule": true,
        "skipLibCheck": true,
        "forceConsistentCasingInFileNames": true,
        "removeComments": true
    }
}
```

`.prettierrc`:

```json
{
    "arrowParens": "always",
    "endOfLine": "lf",
    "printWidth": 115,
    "semi": true,
    "singleQuote": false,
    "tabWidth": 4,
    "trailingComma": "es5",
    "useTabs": false
}
```

`.nvmrc`:

```
22
```

`.gitignore`:

```
node_modules/
dist/
.env
.env.estacao
.env.vps
infra/certs/*
!infra/certs/.gitkeep
```

- [ ] **Step 2: Pacote da API**

`apps/api/package.json`:

```json
{
    "name": "@fotos/api",
    "version": "0.1.0",
    "private": true,
    "main": "dist/index.js",
    "scripts": {
        "dev": "tsx watch src/index.ts",
        "build": "tsc -p tsconfig.build.json",
        "start": "node dist/index.js",
        "typecheck": "tsc -p tsconfig.json",
        "test": "tsx --test $(find src -name '*.test.ts')",
        "test:integracao": "tsx --test --test-concurrency=1 $(find integracao -name '*.test.ts')"
    }
}
```

`apps/api/tsconfig.json` (usado pelo typecheck, inclui testes):

```json
{
    "extends": "../../tsconfig.base.json",
    "compilerOptions": {
        "noEmit": true,
        "types": ["node"]
    },
    "include": ["src", "integracao"]
}
```

`apps/api/tsconfig.build.json`:

```json
{
    "extends": "./tsconfig.json",
    "compilerOptions": {
        "noEmit": false,
        "rootDir": "src",
        "outDir": "dist"
    },
    "include": ["src"],
    "exclude": ["src/**/*.test.ts"]
}
```

Instale as dependências (as versões reais ficam no `package-lock.json`):

```bash
npm install -w apps/api express@^5 express-fileupload@^1 ioredis@^5 pg@^8 dotenv@^17
npm install -w apps/api -D typescript@~5.9 tsx@^4 @types/node@^22 @types/express@^5 @types/express-fileupload@^1 @types/pg@^8
```

- [ ] **Step 3: Escrever o teste da configuração**

`apps/api/src/services/config.test.ts`:

```ts
import { test, describe } from "node:test";
import assert from "node:assert";
import { carregarConfig, config, iniciarConfig } from "./config";

const BASE = {
    POSTGRES_HOST: "localhost",
    POSTGRES_USER: "fotos",
    POSTGRES_PASSWORD: "segredo",
    POSTGRES_DB: "fotos_vps",
    REDIS_URL: "redis://localhost:6379",
    ESTACAO_CHAVE: "a".repeat(32),
};

describe("carregarConfig", () => {
    test("recusa PAPEL ausente", () => {
        assert.throws(() => carregarConfig({ ...BASE }), /PAPEL deve ser "estacao" ou "vps"/);
    });

    test("recusa PAPEL inválido", () => {
        assert.throws(() => carregarConfig({ ...BASE, PAPEL: "servidor" }), /recebido: "servidor"/);
    });

    test("VPS exige ARQUIVO_SEGREDO", () => {
        assert.throws(() => carregarConfig({ ...BASE, PAPEL: "vps" }), /faltando para o papel vps: ARQUIVO_SEGREDO/);
    });

    test("estação exige VPS_URL e não exige ARQUIVO_SEGREDO", () => {
        assert.throws(() => carregarConfig({ ...BASE, PAPEL: "estacao" }), /faltando para o papel estacao: VPS_URL$/);
    });

    test("lista todas as variáveis faltando de uma vez", () => {
        assert.throws(
            () => carregarConfig({ PAPEL: "vps" }),
            /POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, REDIS_URL, ESTACAO_CHAVE, ARQUIVO_SEGREDO/
        );
    });

    test("recusa ESTACAO_CHAVE curta", () => {
        assert.throws(
            () => carregarConfig({ ...BASE, PAPEL: "vps", ARQUIVO_SEGREDO: "x", ESTACAO_CHAVE: "curta" }),
            /ESTACAO_CHAVE deve ter pelo menos 32 caracteres/
        );
    });

    test("recusa porta que não é inteiro positivo", () => {
        assert.throws(
            () => carregarConfig({ ...BASE, PAPEL: "vps", ARQUIVO_SEGREDO: "x", PORTA: "abc" }),
            /PORTA deve ser um número inteiro positivo/
        );
    });

    test("aplica os padrões", () => {
        const c = carregarConfig({ ...BASE, PAPEL: "vps", ARQUIVO_SEGREDO: "x" });

        assert.strictEqual(c.porta, 3000);
        assert.strictEqual(c.postgres.porta, 5432);
        assert.strictEqual(c.redis.prefixo, "fotos:vps:");
        assert.strictEqual(c.vpsUrl, "");
    });

    test("lê os valores informados", () => {
        const c = carregarConfig({
            ...BASE,
            PAPEL: "estacao",
            VPS_URL: "https://admin.exemplo.com.br",
            PORTA: "8080",
            POSTGRES_PORT: "5433",
            REDIS_PREFIXO: "teste:",
        });

        assert.strictEqual(c.papel, "estacao");
        assert.strictEqual(c.porta, 8080);
        assert.deepStrictEqual(c.postgres, {
            host: "localhost",
            porta: 5433,
            usuario: "fotos",
            senha: "segredo",
            banco: "fotos_vps",
        });
        assert.strictEqual(c.redis.prefixo, "teste:");
        assert.strictEqual(c.vpsUrl, "https://admin.exemplo.com.br");
    });
});

describe("iniciarConfig", () => {
    test("preenche o objeto compartilhado", () => {
        const devolvido = iniciarConfig({ ...BASE, PAPEL: "vps", ARQUIVO_SEGREDO: "x" });

        assert.strictEqual(devolvido, config);
        assert.strictEqual(config.papel, "vps");
    });
});
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `npm test -w apps/api`
Expected: FAIL — `Cannot find module './config'`.

- [ ] **Step 5: Implementar**

`apps/api/src/services/config.ts`:

```ts
export type tPapel = "estacao" | "vps";

export interface iConfig {
    papel: tPapel;
    porta: number;
    postgres: { host: string; porta: number; usuario: string; senha: string; banco: string };
    redis: { url: string; prefixo: string };
    estacaoChave: string;
    vpsUrl: string;
    arquivoSegredo: string;
}

const OBRIGATORIAS: Record<"comum" | tPapel, string[]> = {
    comum: ["POSTGRES_HOST", "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB", "REDIS_URL", "ESTACAO_CHAVE"],
    estacao: ["VPS_URL"],
    vps: ["ARQUIVO_SEGREDO"],
};

const helper = {
    numero(valor: string | undefined, padrao: number, nome: string): number {
        if (!valor) return padrao;
        const n = Number(valor);
        if (!Number.isInteger(n) || n <= 0)
            throw new Error(`[Config] ${nome} deve ser um número inteiro positivo (recebido: "${valor}")`);
        return n;
    },
};

export function carregarConfig(env: NodeJS.ProcessEnv): iConfig {
    const papel = env.PAPEL;
    if (papel !== "estacao" && papel !== "vps")
        throw new Error(`[Config] PAPEL deve ser "estacao" ou "vps" (recebido: "${papel ?? ""}")`);

    const faltando = [...OBRIGATORIAS.comum, ...OBRIGATORIAS[papel]].filter((nome) => !env[nome]);
    if (faltando.length)
        throw new Error(`[Config] Variáveis obrigatórias faltando para o papel ${papel}: ${faltando.join(", ")}`);

    const estacaoChave = env.ESTACAO_CHAVE as string;
    if (estacaoChave.length < 32) throw new Error("[Config] ESTACAO_CHAVE deve ter pelo menos 32 caracteres");

    return {
        papel,
        porta: helper.numero(env.PORTA, 3000, "PORTA"),
        postgres: {
            host: env.POSTGRES_HOST as string,
            porta: helper.numero(env.POSTGRES_PORT, 5432, "POSTGRES_PORT"),
            usuario: env.POSTGRES_USER as string,
            senha: env.POSTGRES_PASSWORD as string,
            banco: env.POSTGRES_DB as string,
        },
        redis: {
            url: env.REDIS_URL as string,
            prefixo: env.REDIS_PREFIXO || `fotos:${papel}:`,
        },
        estacaoChave,
        vpsUrl: env.VPS_URL ?? "",
        arquivoSegredo: env.ARQUIVO_SEGREDO ?? "",
    };
}

// Preenchido uma vez na inicialização; os módulos leem daqui, como no erp_server.
export const config = {} as iConfig;

export function iniciarConfig(env: NodeJS.ProcessEnv): iConfig {
    return Object.assign(config, carregarConfig(env));
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `npm test -w apps/api && npm run typecheck -w apps/api`
Expected: 10 testes PASS; typecheck sem erros.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json tsconfig.base.json .prettierrc .nvmrc .gitignore apps/api
git commit -m "feat(api): monorepo e configuração por papel" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: ConexaoPostgres

**Files:**
- Create: `apps/api/src/db/conexaoPostgres.ts`
- Test: `apps/api/src/db/conexaoPostgres.test.ts`

**Interfaces:**
- Consumes: `config.postgres`, `config.papel` (Task 1)
- Produces:
  - `parseParams(sql: string, valores: unknown[]): { text: string; values: unknown[] }`
  - `fecharBanco(): Promise<void>` — encerra o pool único
  - `default class ConexaoPostgres` com `open(): Promise<boolean>`, `openTransaction(): Promise<boolean>`, `queryParam<T>(sql, valores): Promise<T[]>`, `queryOneParam<T>(sql, valores): Promise<T | undefined>`, `executeParamCount(sql, valores): Promise<number>`, `commit()`, `rollback()`, `close(): Promise<boolean>`

Diferenças deliberadas em relação ao `erp_server`: um pool só (um banco por papel), sem a sintaxe `:nome` (ela quebraria o cast `?::vector` da busca), `queryOneParam` devolve `undefined` quando não há linha, e o erro do driver é relançado sem logar os parâmetros.

- [ ] **Step 1: Escrever o teste**

`apps/api/src/db/conexaoPostgres.test.ts`:

```ts
import { test, describe } from "node:test";
import assert from "node:assert";
import ConexaoPostgres, { parseParams } from "./conexaoPostgres";

// parseParams passa por toda query do sistema: um erro aqui desalinha valores em silêncio.

describe("parseParams com ?", () => {
    test("traduz para $N na ordem e leva os valores", () => {
        const r = parseParams("SELECT x FROM t WHERE a ilike ? AND b = ?", ["%", 0]);

        assert.strictEqual(r.text, "SELECT x FROM t WHERE a ilike $1 AND b = $2");
        assert.deepStrictEqual(r.values, ["%", 0]);
    });

    test("SQL sem parâmetro passa intacto", () => {
        assert.deepStrictEqual(parseParams("SELECT 1", []), { text: "SELECT 1", values: [] });
    });

    test("placeholder sem valor vira null", () => {
        assert.deepStrictEqual(parseParams("SELECT x WHERE a = ? AND b = ?", ["só-um"]).values, ["só-um", null]);
    });

    test("null explícito é preservado", () => {
        assert.deepStrictEqual(parseParams("SELECT x WHERE a = ?", [null]).values, [null]);
    });

    test("cast ::vector depois do ? é mantido", () => {
        const r = parseParams("SELECT 1 - (embedding <=> ?::vector) FROM rosto WHERE id_evento = ?", ["[1,0]", 7]);

        assert.strictEqual(r.text, "SELECT 1 - (embedding <=> $1::vector) FROM rosto WHERE id_evento = $2");
    });
});

describe("parseParams com $N", () => {
    test("repassa intacto, permitindo reusar o mesmo valor", () => {
        const r = parseParams("SELECT x WHERE a = $1 OR b = $1", [5]);

        assert.deepStrictEqual(r, { text: "SELECT x WHERE a = $1 OR b = $1", values: [5] });
    });

    test("recusa misturar ? com $N", () => {
        assert.throws(() => parseParams("SELECT x WHERE a = ? AND b = $2", [1, 2]), /mistura placeholder/);
    });

    test("$N dentro de string não conta como mistura", () => {
        const r = parseParams("SELECT x WHERE a = ? AND b = 'custa $1'", [1]);

        assert.strictEqual(r.text, "SELECT x WHERE a = $1 AND b = 'custa $1'");
    });
});

describe("ConexaoPostgres sem banco", () => {
    test("recusa query antes de open()", async () => {
        const conexao = new ConexaoPostgres();

        await assert.rejects(conexao.queryParam("SELECT 1", []), /Conexão não aberta/);
    });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w apps/api`
Expected: FAIL — `Cannot find module './conexaoPostgres'`.

- [ ] **Step 3: Implementar**

`apps/api/src/db/conexaoPostgres.ts`:

```ts
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

function semStrings(sql: string): string {
    return sql.replace(/'([^']|'')*'/g, "''");
}

// Aceita `?` posicional (traduzido para $N) ou `$N` nativo, nunca os dois na mesma query:
// numerar os `?` a partir de 1 colidiria com os $N escritos à mão.
export function parseParams(sql: string, valores: unknown[]): { text: string; values: unknown[] } {
    const visivel = semStrings(sql);
    const temInterrogacao = visivel.includes("?");
    const temNativo = /\$\d/.test(visivel);

    if (temInterrogacao && temNativo)
        throw new Error("SQL mistura placeholder `?` com `$N`: use apenas uma das duas sintaxes");

    if (temNativo) return { text: sql, values: valores };

    const values: unknown[] = [];
    let i = 0;
    const text = sql.replace(/\?/g, () => {
        values.push(valores[i] ?? null);
        i++;
        return `$${i}`;
    });
    return { text, values };
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
        try {
            if (this.client && this.emTransacao) {
                if (this.comErro) await this.rollback();
                else await this.commit();
            }
        } catch (erro) {
            console.error("[Postgres] Erro ao encerrar a transação:", erro);
        } finally {
            await this.liberar();
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
            console.error("[Postgres] Erro na query:", (erro as Error).message);
            console.error("[Postgres] SQL:", sql);
            throw erro;
        }
    }

    private async liberar(): Promise<void> {
        if (this.client) {
            try {
                this.client.release();
            } catch (erro) {
                console.error("[Postgres] Erro ao devolver a conexão ao pool:", erro);
            }
            this.client = null;
        }
        this.aberta = false;
        this.emTransacao = false;
    }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -w apps/api && npm run typecheck -w apps/api`
Expected: todos PASS; typecheck sem erros.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db
git commit -m "feat(api): ConexaoPostgres com pool único por papel" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Despachante `per` e `ErroTratado`

**Files:**
- Create: `apps/api/src/services/erro.ts`, `apps/api/src/services/per.ts`
- Test: `apps/api/src/services/per.test.ts`

**Interfaces:**
- Produces:
  - `class ErroTratado extends Error` — erro com mensagem exibível ao usuário
  - `interface iContexto { authorization?: string }`
  - `interface iRota { conexao?: { close(): Promise<unknown> }; init(): Promise<void> }`
  - `type tClasseRota = new (contexto: iContexto) => iRota`
  - `chamadaValida(Classe: tClasseRota, call: unknown): call is string`
  - `default per(req, res, next, Classe: tClasseRota): Promise<void>`
- Contrato de resposta: `null`/`undefined` → 200 `[]`; `{ status: number, data }` → `status` com `data`; qualquer outro valor → 200 com o valor; `call` ausente, reservado (`init`, `constructor`, começando com `_`) ou que não seja método do protótipo → 400 `{ msg: "Chamada inválida" }`.

O `call` vem do corpo de uma API pública, por isso só métodos declarados na própria classe podem ser chamados (nada herdado de `Object.prototype`, nada de `init`).

- [ ] **Step 1: Escrever o teste**

`apps/api/src/services/per.test.ts`:

```ts
import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert";
import express, { NextFunction, Request, Response } from "express";
import fileUpload from "express-fileupload";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import per, { chamadaValida, iContexto } from "./per";
import { ErroTratado } from "./erro";

let eventos: string[] = [];

class RotaFalsa {
    conexao = {
        close: async () => {
            eventos.push("close");
            return true;
        },
    };

    constructor(private contexto: iContexto) {}

    async init() {
        eventos.push("init");
    }

    async ola(req: Request) {
        return { ola: req.body.nome, authorization: this.contexto.authorization ?? null };
    }

    async negocio() {
        return { msg: "Nome já existe", error: true };
    }

    async tratado() {
        throw new ErroTratado("Evento encerrado");
    }

    async quebrado() {
        throw new Error("detalhe interno");
    }

    async vazio() {
        return null;
    }

    async comStatus() {
        return { status: 202, data: { aceito: true } };
    }
}

class RotaInitFalha {
    conexao = {
        close: async () => {
            eventos.push("close");
            return true;
        },
    };

    async init() {
        throw new Error("banco fora");
    }

    async ola() {
        return {};
    }
}

let servidor: Server;
let base: string;

before(async () => {
    const app = express();
    app.use(express.json());
    app.use(fileUpload());
    app.post("/rota", (req: Request, res: Response, next: NextFunction) => per(req, res, next, RotaFalsa));
    app.post("/init-falha", (req: Request, res: Response, next: NextFunction) => per(req, res, next, RotaInitFalha));
    servidor = app.listen(0);
    await new Promise((resolve) => servidor.once("listening", resolve));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

after(() => {
    servidor.close();
});

beforeEach(() => {
    eventos = [];
});

async function chamar(caminho: string, corpo: object, headers: Record<string, string> = {}) {
    const resposta = await fetch(base + caminho, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(corpo),
    });
    return { status: resposta.status, corpo: await resposta.json() };
}

describe("per", () => {
    test("despacha o call e repassa o contexto", async () => {
        const r = await chamar("/rota", { call: "ola", nome: "Ana" }, { Authorization: "tok" });

        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual(r.corpo, { ola: "Ana", authorization: "tok" });
        assert.deepStrictEqual(eventos, ["init", "close"]);
    });

    test("erro de negócio sai com 200 e o corpo da ctrl", async () => {
        const r = await chamar("/rota", { call: "negocio" });

        assert.strictEqual(r.status, 200);
        assert.deepStrictEqual(r.corpo, { msg: "Nome já existe", error: true });
    });

    test("ErroTratado vira 422 com a mensagem", async () => {
        const r = await chamar("/rota", { call: "tratado" });

        assert.strictEqual(r.status, 422);
        assert.deepStrictEqual(r.corpo, { msg: "Evento encerrado" });
    });

    test("erro inesperado vira 500 sem detalhe interno e fecha a conexão", async () => {
        const r = await chamar("/rota", { call: "quebrado" });

        assert.strictEqual(r.status, 500);
        assert.deepStrictEqual(r.corpo, { msg: "Erro ao processar sua solicitação" });
        assert.deepStrictEqual(eventos, ["init", "close"]);
    });

    test("fecha a conexão mesmo quando init falha", async () => {
        const r = await chamar("/init-falha", { call: "ola" });

        assert.strictEqual(r.status, 500);
        assert.deepStrictEqual(eventos, ["close"]);
    });

    test("retorno nulo vira lista vazia", async () => {
        assert.deepStrictEqual((await chamar("/rota", { call: "vazio" })).corpo, []);
    });

    test("retorno com status e data define o HTTP", async () => {
        const r = await chamar("/rota", { call: "comStatus" });

        assert.strictEqual(r.status, 202);
        assert.deepStrictEqual(r.corpo, { aceito: true });
    });

    for (const call of [undefined, "init", "constructor", "toString", "conexao", "naoExiste", "_privado"]) {
        test(`recusa call ${String(call)} com 400 sem instanciar a rota`, async () => {
            const r = await chamar("/rota", { call });

            assert.strictEqual(r.status, 400);
            assert.deepStrictEqual(r.corpo, { msg: "Chamada inválida" });
            assert.deepStrictEqual(eventos, []);
        });
    }

    test("aceita call em formulário multipart", async () => {
        const form = new FormData();
        form.append("call", "ola");
        form.append("nome", "Bia");

        const resposta = await fetch(base + "/rota", { method: "POST", body: form });

        assert.deepStrictEqual(await resposta.json(), { ola: "Bia", authorization: null });
    });
});

describe("chamadaValida", () => {
    test("aceita método próprio da classe", () => {
        assert.strictEqual(chamadaValida(RotaFalsa, "ola"), true);
    });

    test("recusa valor que não é texto", () => {
        assert.strictEqual(chamadaValida(RotaFalsa, 42), false);
    });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w apps/api`
Expected: FAIL — `Cannot find module './per'`.

- [ ] **Step 3: Implementar**

`apps/api/src/services/erro.ts`:

```ts
export class ErroTratado extends Error {
    constructor(mensagem: string) {
        super(mensagem);
        this.name = "ErroTratado";
    }
}
```

`apps/api/src/services/per.ts`:

```ts
import { NextFunction, Request, Response } from "express";
import { ErroTratado } from "./erro";

export interface iContexto {
    authorization?: string;
}

export interface iRota {
    conexao?: { close(): Promise<unknown> };
    init(): Promise<void>;
}

export type tClasseRota = new (contexto: iContexto) => iRota;

const RESERVADOS = new Set(["constructor", "init"]);

export function chamadaValida(Classe: tClasseRota, call: unknown): call is string {
    if (typeof call !== "string" || RESERVADOS.has(call) || call.startsWith("_")) return false;
    return typeof Object.getOwnPropertyDescriptor(Classe.prototype, call)?.value === "function";
}

function responder(res: Response, rs: unknown): void {
    if (rs === null || rs === undefined) {
        res.send([]);
        return;
    }
    if (typeof rs === "object" && "data" in rs && typeof (rs as { status?: unknown }).status === "number") {
        const { status, data } = rs as { status: number; data: unknown };
        res.status(status).send(data);
        return;
    }
    res.send(rs);
}

export default async function per(
    req: Request,
    res: Response,
    _next: NextFunction,
    Classe: tClasseRota
): Promise<void> {
    const call: unknown = req.body?.call;
    if (!chamadaValida(Classe, call)) {
        res.status(400).send({ msg: "Chamada inválida" });
        return;
    }

    let rota: iRota | undefined;
    try {
        rota = new Classe({ authorization: req.headers.authorization });
        await rota.init();
        const metodo = (rota as unknown as Record<string, (req: Request) => Promise<unknown>>)[call];
        responder(res, await metodo.call(rota, req));
    } catch (erro) {
        if (erro instanceof ErroTratado) {
            res.status(422).send({ msg: erro.message });
            return;
        }
        console.error(`[per] Erro em ${req.originalUrl} (${call}):`, erro);
        res.status(500).send({ msg: "Erro ao processar sua solicitação" });
    } finally {
        if (rota?.conexao) {
            try {
                await rota.conexao.close();
            } catch (erro) {
                console.error("[per] Erro ao fechar a conexão:", erro);
            }
        }
    }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test -w apps/api && npm run typecheck -w apps/api`
Expected: todos PASS (o teste "erro inesperado" imprime o `console.error` do `per`, é esperado).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/erro.ts apps/api/src/services/per.ts apps/api/src/services/per.test.ts
git commit -m "feat(api): despachante RPC per com lista de chamadas permitidas" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Servidor, áreas por papel, `/test`, entrada e módulo modelo

**Files:**
- Create: `apps/api/src/services/servidor.ts`, `apps/api/src/services/saude.ts`, `apps/api/src/services/redis.ts`
- Create: `apps/api/src/routes/areas.ts` e as seis rotas de área
- Create: `apps/api/src/loadEnv.ts`, `apps/api/src/index.ts`
- Create: `apps/api/src/_template/route._template.ts`, `ctrl._template.ts`, `sql._template.ts`, `i._template.ts`, `_template.http`
- Test: `apps/api/src/routes/areas.test.ts`, `apps/api/src/services/servidor.test.ts`

**Interfaces:**
- Consumes: `config`, `iniciarConfig` (Task 1); `ConexaoPostgres`, `fecharBanco` (Task 2); `per`, `iContexto` (Task 3)
- Produces:
  - `interface iArea { caminho: string; router: Router }`
  - `areasDoPapel(papel: tPapel): iArea[]` — estação: `fotografo`, `painel`; VPS: `participante`, `anfitriao`, `admin`, `estacao`
  - `criarApp(areas?: iArea[]): express.Express` — padrão `areasDoPapel(config.papel)`; monta cada área em `/api/<caminho>`
  - `redis(): Redis`, `fecharRedis(): Promise<void>`
  - `verificarSaude(): Promise<iSaude>` com `iSaude { ok: boolean; papel: tPapel; versao: string; banco: boolean; redis: boolean }`
  - Módulo `_template` com `getAgora` → `{ agora: Date }` e `ecoar { texto }` → `{ texto: string }` (texto em maiúsculas)
- Convenção para as próximas fases: um módulo `X` da área `admin` fica em `src/_ADMIN/X/` e é registrado em `routes/adminRoute.ts` com `router.post("/X", routeX)`.

- [ ] **Step 1: Escrever os testes**

`apps/api/src/routes/areas.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert";
import { areasDoPapel } from "./areas";

test("estação monta só fotógrafo e painel", () => {
    assert.deepStrictEqual(
        areasDoPapel("estacao").map((a) => a.caminho),
        ["fotografo", "painel"]
    );
});

test("VPS monta participante, anfitrião, admin e estação", () => {
    assert.deepStrictEqual(
        areasDoPapel("vps").map((a) => a.caminho),
        ["participante", "anfitriao", "admin", "estacao"]
    );
});
```

`apps/api/src/services/servidor.test.ts`:

```ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import { Router } from "express";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import { criarApp } from "./servidor";

let servidor: Server;
let base: string;

before(async () => {
    const area = Router();
    area.post("/eco", (req, res) => {
        res.send(req.body);
    });
    servidor = criarApp([{ caminho: "teste", router: area }]).listen(0);
    await new Promise((resolve) => servidor.once("listening", resolve));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

after(() => {
    servidor.close();
});

function postar(caminho: string, corpo: string) {
    return fetch(base + caminho, { method: "POST", headers: { "Content-Type": "application/json" }, body: corpo });
}

describe("criarApp", () => {
    test("monta a área em /api/<area>/<modulo>", async () => {
        const resposta = await postar("/api/teste/eco", JSON.stringify({ a: 1 }));

        assert.strictEqual(resposta.status, 200);
        assert.deepStrictEqual(await resposta.json(), { a: 1 });
    });

    test("rota desconhecida vira 404 em JSON", async () => {
        const resposta = await postar("/api/fotografo/upload", "{}");

        assert.strictEqual(resposta.status, 404);
        assert.deepStrictEqual(await resposta.json(), { msg: "Rota não encontrada" });
    });

    test("JSON malformado vira 400 em JSON", async () => {
        const resposta = await postar("/api/teste/eco", "{ruim");

        assert.strictEqual(resposta.status, 400);
        assert.deepStrictEqual(await resposta.json(), { msg: "JSON inválido" });
    });

    test("não expõe o X-Powered-By", async () => {
        const resposta = await postar("/api/teste/eco", "{}");

        assert.strictEqual(resposta.headers.get("x-powered-by"), null);
    });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test -w apps/api`
Expected: FAIL — `Cannot find module './areas'` e `Cannot find module './servidor'`.

- [ ] **Step 3: Rotas de área**

Crie estes seis arquivos com o mesmo conteúdo, trocando só o nome do arquivo: `apps/api/src/routes/fotografoRoute.ts`, `painelRoute.ts`, `participanteRoute.ts`, `anfitriaoRoute.ts`, `adminRoute.ts`, `estacaoRoute.ts`.

```ts
import { Router } from "express";

const router = Router();

export default router;
```

`apps/api/src/routes/areas.ts`:

```ts
import { Router } from "express";
import type { tPapel } from "../services/config";
import fotografoRoute from "./fotografoRoute";
import painelRoute from "./painelRoute";
import participanteRoute from "./participanteRoute";
import anfitriaoRoute from "./anfitriaoRoute";
import adminRoute from "./adminRoute";
import estacaoRoute from "./estacaoRoute";

export interface iArea {
    caminho: string;
    router: Router;
}

const AREAS: Record<tPapel, iArea[]> = {
    estacao: [
        { caminho: "fotografo", router: fotografoRoute },
        { caminho: "painel", router: painelRoute },
    ],
    vps: [
        { caminho: "participante", router: participanteRoute },
        { caminho: "anfitriao", router: anfitriaoRoute },
        { caminho: "admin", router: adminRoute },
        { caminho: "estacao", router: estacaoRoute },
    ],
};

export function areasDoPapel(papel: tPapel): iArea[] {
    return AREAS[papel];
}
```

- [ ] **Step 4: Redis, saúde e servidor**

`apps/api/src/services/redis.ts`:

```ts
import Redis from "ioredis";
import { config } from "./config";

let cliente: Redis | undefined;

export function redis(): Redis {
    if (!cliente) {
        cliente = new Redis(config.redis.url, { keyPrefix: config.redis.prefixo, maxRetriesPerRequest: 1 });
        cliente.on("error", (erro) => console.error("[Redis]", erro.message));
    }
    return cliente;
}

export async function fecharRedis(): Promise<void> {
    const atual = cliente;
    cliente = undefined;
    if (atual) await atual.quit().catch(() => atual.disconnect());
}
```

`apps/api/src/services/saude.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import ConexaoPostgres from "../db/conexaoPostgres";
import { config, tPapel } from "./config";
import { redis } from "./redis";

// Mesmo caminho relativo em src/services e dist/services.
const VERSAO: string = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8")).version;

export interface iSaude {
    ok: boolean;
    papel: tPapel;
    versao: string;
    banco: boolean;
    redis: boolean;
}

async function pingBanco(): Promise<boolean> {
    const conexao = new ConexaoPostgres();
    try {
        await conexao.open();
        await conexao.queryParam("SELECT 1", []);
        return true;
    } catch (erro) {
        console.error("[Saude] Banco indisponível:", (erro as Error).message);
        return false;
    } finally {
        await conexao.close();
    }
}

async function pingRedis(): Promise<boolean> {
    const limite = new Promise<never>((_, rejeitar) => {
        setTimeout(() => rejeitar(new Error("tempo esgotado")), 2_000).unref();
    });
    try {
        await Promise.race([redis().ping(), limite]);
        return true;
    } catch (erro) {
        console.error("[Saude] Redis indisponível:", (erro as Error).message);
        return false;
    }
}

export async function verificarSaude(): Promise<iSaude> {
    const [banco, redisOk] = await Promise.all([pingBanco(), pingRedis()]);
    return { ok: banco && redisOk, papel: config.papel, versao: VERSAO, banco, redis: redisOk };
}
```

`apps/api/src/services/servidor.ts`:

```ts
import express, { NextFunction, Request, Response } from "express";
import fileUpload from "express-fileupload";
import { areasDoPapel, iArea } from "../routes/areas";
import { config } from "./config";
import { verificarSaude } from "./saude";

export function criarApp(areas: iArea[] = areasDoPapel(config.papel)): express.Express {
    const app = express();
    app.disable("x-powered-by");
    app.use(express.json({ limit: "1mb" }));
    app.use(fileUpload({ limits: { fileSize: 25 * 1024 * 1024 }, abortOnLimit: true }));

    app.get("/test", async (_req: Request, res: Response) => {
        const saude = await verificarSaude();
        res.status(saude.ok ? 200 : 503).send(saude);
    });

    for (const area of areas) app.use(`/api/${area.caminho}`, area.router);

    app.use((_req: Request, res: Response) => {
        res.status(404).send({ msg: "Rota não encontrada" });
    });

    app.use((erro: Error & { type?: string }, _req: Request, res: Response, _next: NextFunction) => {
        if (erro.type === "entity.parse.failed") {
            res.status(400).send({ msg: "JSON inválido" });
            return;
        }
        if (erro.type === "entity.too.large") {
            res.status(413).send({ msg: "Requisição grande demais" });
            return;
        }
        console.error("[Servidor] Erro não tratado:", erro);
        res.status(500).send({ msg: "Erro ao processar sua solicitação" });
    });

    return app;
}
```

- [ ] **Step 5: Rodar os testes**

Run: `npm test -w apps/api && npm run typecheck -w apps/api`
Expected: todos PASS.

- [ ] **Step 6: Entrada da aplicação**

`apps/api/src/loadEnv.ts`:

```ts
import dotenv from "dotenv";
import path from "node:path";

// Em container as variáveis vêm do compose; o apps/api/.env só existe no desenvolvimento.
dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });
```

`apps/api/src/index.ts`:

```ts
import "./loadEnv";
import { iConfig, iniciarConfig } from "./services/config";
import { criarApp } from "./services/servidor";
import { fecharBanco } from "./db/conexaoPostgres";
import { fecharRedis } from "./services/redis";

function main(): void {
    let config: iConfig;
    try {
        config = iniciarConfig(process.env);
    } catch (erro) {
        console.error((erro as Error).message);
        process.exit(1);
    }

    const servidor = criarApp().listen(config.porta, () => {
        console.log(`[Api] Papel ${config.papel} ouvindo na porta ${config.porta}`);
    });

    const encerrar = async () => {
        console.log("[Api] Encerrando...");
        servidor.close();
        await Promise.allSettled([fecharBanco(), fecharRedis()]);
        process.exit(0);
    };
    process.on("SIGTERM", encerrar);
    process.on("SIGINT", encerrar);
}

main();
```

Confira a falha na inicialização (ainda não existe `apps/api/.env`):

Run: `cd apps/api && PAPEL=vps npx tsx src/index.ts; echo "saida=$?"; cd ../..`
Expected: `[Config] Variáveis obrigatórias faltando para o papel vps: POSTGRES_HOST, POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB, REDIS_URL, ESTACAO_CHAVE, ARQUIVO_SEGREDO` e `saida=1`.

- [ ] **Step 7: Módulo modelo `_template`**

É o esqueleto que as próximas fases copiam. Ele não é montado em nenhuma área; o teste de integração da Task 8 o monta numa área de teste.

`apps/api/src/_template/i._template.ts`:

```ts
export interface iEco {
    texto: string;
}
```

`apps/api/src/_template/sql._template.ts`:

```ts
import ConexaoPostgres from "../db/conexaoPostgres";

export default class Sql {
    constructor(private conexao: ConexaoPostgres) {}

    async getAgora() {
        return this.conexao.queryOneParam<{ agora: Date }>("SELECT now() AS agora", []);
    }
}
```

`apps/api/src/_template/ctrl._template.ts`:

```ts
import ConexaoPostgres from "../db/conexaoPostgres";
import Sql from "./sql._template";
import { iEco } from "./i._template";

export default class Ctrl {
    private sql: Sql;

    constructor(conexao: ConexaoPostgres) {
        this.sql = new Sql(conexao);
    }

    async getAgora() {
        return this.sql.getAgora();
    }

    async ecoar(texto: string): Promise<iEco | { msg: string; error: true }> {
        if (texto.length > 100) return { msg: "O texto deve ter no máximo 100 caracteres", error: true };
        return { texto: texto.toUpperCase() };
    }
}
```

`apps/api/src/_template/route._template.ts`:

```ts
import { NextFunction, Request, Response } from "express";
import per, { iContexto } from "../services/per";
import ConexaoPostgres from "../db/conexaoPostgres";
import Ctrl from "./ctrl._template";

class Router {
    conexao: ConexaoPostgres;
    private ctrl: Ctrl;

    constructor(private contexto: iContexto) {
        this.conexao = new ConexaoPostgres();
        this.ctrl = new Ctrl(this.conexao);
    }

    async init() {
        await this.conexao.open();
    }

    async getAgora(_req: Request) {
        return this.ctrl.getAgora();
    }

    async ecoar(req: Request) {
        const { texto } = req.body;
        if (!texto) return { msg: "texto é obrigatório", error: true };
        return this.ctrl.ecoar(texto);
    }
}

export default (req: Request, res: Response, next: NextFunction) => per(req, res, next, Router);
```

`apps/api/src/_template/_template.http`:

```http
# Modelo: depois de copiar o módulo, registre em routes/<area>Route.ts
# com router.post("/<modulo>", route<Modulo>) e ajuste @area e @modulo.
@porta = 3002
@area = admin
@modulo = template

###
POST http://localhost:{{porta}}/api/{{area}}/{{modulo}}
Content-Type: application/json

{
    "call": "getAgora"
}

###
POST http://localhost:{{porta}}/api/{{area}}/{{modulo}}
Content-Type: application/json

{
    "call": "ecoar",
    "texto": "olá"
}
```

Run: `npm run typecheck -w apps/api && npm run build -w apps/api && ls apps/api/dist`
Expected: sem erros; `dist` contém `index.js`, `loadEnv.js`, `services/`, `db/`, `routes/`, `_template/` e nenhum `*.test.js`.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src
git commit -m "feat(api): servidor com áreas por papel, /test e módulo modelo" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Runner de migrations

**Files:**
- Create: `db/package.json`, `db/tsconfig.json`, `db/loadEnv.ts`, `db/migrateParse.ts`, `db/migrador.ts`, `db/migrate.ts`
- Modify: `package.json` (raiz) — workspace `db` e scripts de migração
- Test: `db/migrateParse.test.ts`, `db/migrador.test.ts`

**Interfaces:**
- Produces (`db/migrateParse.ts`):
  - `type tPapel = "estacao" | "vps"`, `type tAlvo = tPapel | "ambos"`
  - `interface iMigracao { up: string; down: string; semTransacao: boolean; alvo: tAlvo }`
  - `interpretarMigracao(conteudo: string, nomeArquivo: string): iMigracao`
  - `deveRodar(alvo: tAlvo, papel: tPapel): boolean`
  - `nomeDeMigracaoValido(nome: string): boolean` — `^\d{14}_[a-z0-9_]+\.sql$`
- Produces (`db/migrador.ts`):
  - `interface iArquivoMigracao { versao: string; nome: string; caminho: string }`
  - `listarMigracoes(dir: string): iArquivoMigracao[]` — ordenadas; lança se algum `.sql` foge do padrão de nome
  - `criarArquivo(dir: string, nome: string, alvo: tAlvo, agora?: Date): string` — devolve o nome do arquivo
  - `prepararControle(client: Client, papel: tPapel): Promise<void>` — cria `schema_migrations` e `schema_papel`; lança se o banco pertence ao outro papel
  - `aplicarPendentes(client: Client, arquivos: iArquivoMigracao[], papel: tPapel): Promise<string[]>` — versões aplicadas; lança `Falha em <versao>: <motivo>` depois do rollback
  - `reverterUltima(client: Client, arquivos: iArquivoMigracao[], papel: tPapel): Promise<string | null>`
  - `situacao(client: Client, arquivos: iArquivoMigracao[], papel: tPapel): Promise<{ versao: string; aplicada: boolean }[]>` — só as do papel
- CLI: `npm run migrate -- create <nome> --target=<alvo>`, `up`, `down`, `status`. Papel e banco vêm de `PAPEL` e `POSTGRES_*`.

A tabela `schema_papel` guarda o papel do banco na primeira execução e impede rodar as migrations da VPS no banco da estação (e vice-versa) por engano de `.env`.

- [ ] **Step 1: Pacote `db`**

`db/package.json`:

```json
{
    "name": "@fotos/db",
    "version": "0.1.0",
    "private": true,
    "scripts": {
        "migrate": "tsx migrate.ts",
        "typecheck": "tsc -p tsconfig.json",
        "test": "tsx --test $(find . -maxdepth 1 -name '*.test.ts')",
        "test:integracao": "tsx --test --test-concurrency=1 $(find integracao -name '*.test.ts')"
    }
}
```

`db/tsconfig.json`:

```json
{
    "extends": "../tsconfig.base.json",
    "compilerOptions": {
        "noEmit": true,
        "types": ["node"]
    },
    "include": ["*.ts", "integracao/**/*.ts"]
}
```

No `package.json` da raiz, troque `workspaces` e acrescente os scripts:

```json
    "workspaces": [
        "apps/api",
        "db"
    ],
    "scripts": {
        "typecheck": "npm run typecheck --workspaces --if-present",
        "test": "npm run test --workspaces --if-present",
        "test:integracao": "npm run test:integracao --workspaces --if-present",
        "migrate": "npm run migrate -w db --",
        "migrate:dev": "PAPEL=estacao POSTGRES_DB=fotos_estacao npm run migrate -w db -- up && PAPEL=vps POSTGRES_DB=fotos_vps npm run migrate -w db -- up"
    }
```

O `tsx` é dependência de produção aqui porque o container de migração roda o TypeScript direto:

```bash
npm install -w db pg@^8 dotenv@^17 tsx@^4
npm install -w db -D typescript@~5.9 @types/node@^22 @types/pg@^8
```

- [ ] **Step 2: Escrever os testes puros**

`db/migrateParse.test.ts`:

```ts
import { test, describe } from "node:test";
import assert from "node:assert";
import { deveRodar, interpretarMigracao, nomeDeMigracaoValido } from "./migrateParse";

const COMPLETA = [
    "-- migrate:target vps",
    "-- migrate:up",
    "CREATE TABLE a (id int);",
    "",
    "-- migrate:down",
    "DROP TABLE a;",
].join("\n");

describe("interpretarMigracao", () => {
    test("separa up, down e alvo", () => {
        assert.deepStrictEqual(interpretarMigracao(COMPLETA, "x.sql"), {
            up: "CREATE TABLE a (id int);",
            down: "DROP TABLE a;",
            semTransacao: false,
            alvo: "vps",
        });
    });

    test("aceita quebras de linha CRLF", () => {
        assert.strictEqual(interpretarMigracao(COMPLETA.replace(/\n/g, "\r\n"), "x.sql").down, "DROP TABLE a;");
    });

    test("lê a diretiva no-transaction", () => {
        const m = interpretarMigracao(COMPLETA.replace("-- migrate:up", "-- migrate:up\n-- migrate:no-transaction"), "x.sql");

        assert.strictEqual(m.semTransacao, true);
        assert.strictEqual(m.up, "CREATE TABLE a (id int);");
    });

    for (const alvo of ["estacao", "vps", "ambos"]) {
        test(`aceita o alvo ${alvo}`, () => {
            assert.strictEqual(interpretarMigracao(COMPLETA.replace("target vps", `target ${alvo}`), "x.sql").alvo, alvo);
        });
    }

    test("recusa alvo inválido", () => {
        assert.throws(
            () => interpretarMigracao(COMPLETA.replace("target vps", "target todos"), "x.sql"),
            /"-- migrate:target todos" inválida em x.sql/
        );
    });

    test("recusa arquivo sem alvo", () => {
        assert.throws(
            () => interpretarMigracao(COMPLETA.replace("-- migrate:target vps\n", ""), "x.sql"),
            /sem "-- migrate:target" em x.sql/
        );
    });

    test("recusa up vazio", () => {
        assert.throws(
            () => interpretarMigracao("-- migrate:target vps\n-- migrate:up\n\n-- migrate:down\nDROP TABLE a;", "x.sql"),
            /sem seção "-- migrate:up" \(ou vazia\): x.sql/
        );
    });

    test("down é opcional", () => {
        assert.strictEqual(interpretarMigracao("-- migrate:target ambos\n-- migrate:up\nSELECT 1;", "x.sql").down, "");
    });
});

describe("deveRodar", () => {
    test("ambos roda nos dois papéis", () => {
        assert.strictEqual(deveRodar("ambos", "estacao"), true);
        assert.strictEqual(deveRodar("ambos", "vps"), true);
    });

    test("alvo de um papel roda só nele", () => {
        assert.strictEqual(deveRodar("vps", "vps"), true);
        assert.strictEqual(deveRodar("vps", "estacao"), false);
        assert.strictEqual(deveRodar("estacao", "vps"), false);
    });
});

describe("nomeDeMigracaoValido", () => {
    test("aceita AAAAMMDDHHMMSS_nome.sql", () => {
        assert.strictEqual(nomeDeMigracaoValido("20260918120000_cadastros.sql"), true);
    });

    for (const nome of ["2026_cadastros.sql", "20260918120000-cadastros.sql", "20260918120000_Cadastros.sql", "20260918120000_x.txt"]) {
        test(`recusa ${nome}`, () => {
            assert.strictEqual(nomeDeMigracaoValido(nome), false);
        });
    }
});
```

`db/migrador.test.ts` (só sistema de arquivos, sem banco):

```ts
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { criarArquivo, listarMigracoes } from "./migrador";
import { interpretarMigracao } from "./migrateParse";

let dir: string;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "migracoes-"));
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("listarMigracoes", () => {
    test("devolve os .sql em ordem e ignora outros arquivos", () => {
        fs.writeFileSync(path.join(dir, "20260918120100_b.sql"), "");
        fs.writeFileSync(path.join(dir, "20260918120000_a.sql"), "");
        fs.writeFileSync(path.join(dir, "LEIAME.md"), "");

        assert.deepStrictEqual(listarMigracoes(dir), [
            { versao: "20260918120000_a", nome: "20260918120000_a.sql", caminho: path.join(dir, "20260918120000_a.sql") },
            { versao: "20260918120100_b", nome: "20260918120100_b.sql", caminho: path.join(dir, "20260918120100_b.sql") },
        ]);
    });

    test("recusa .sql fora do padrão de nome", () => {
        fs.writeFileSync(path.join(dir, "cadastros.sql"), "");

        assert.throws(() => listarMigracoes(dir), /fora do padrão AAAAMMDDHHMMSS_nome.sql: cadastros.sql/);
    });

    test("pasta inexistente devolve lista vazia", () => {
        assert.deepStrictEqual(listarMigracoes(path.join(dir, "nao-existe")), []);
    });
});

describe("criarArquivo", () => {
    test("gera nome com carimbo e slug sem acento", () => {
        const nome = criarArquivo(dir, "Adiciona Coluna Ação", "vps", new Date(2026, 8, 18, 12, 0, 5));

        assert.strictEqual(nome, "20260918120005_adiciona_coluna_acao.sql");
    });

    test("o arquivo gerado já tem alvo e seções", () => {
        const nome = criarArquivo(dir, "x", "ambos", new Date(2026, 8, 18, 12, 0, 5));
        const conteudo = fs.readFileSync(path.join(dir, nome), "utf8");

        assert.match(conteudo, /^-- migrate:target ambos\n-- migrate:up\n/);
        assert.match(conteudo, /-- migrate:down/);
        assert.throws(() => interpretarMigracao(conteudo, nome), /ou vazia/);
    });

    test("recusa nome vazio", () => {
        assert.throws(() => criarArquivo(dir, " !! ", "vps"), /Informe um nome/);
    });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm test -w db`
Expected: FAIL — `Cannot find module './migrateParse'`.

- [ ] **Step 4: Implementar o parser**

`db/migrateParse.ts`:

```ts
export type tPapel = "estacao" | "vps";
export type tAlvo = tPapel | "ambos";

export interface iMigracao {
    up: string;
    down: string;
    semTransacao: boolean;
    alvo: tAlvo;
}

const ALVOS: tAlvo[] = ["estacao", "vps", "ambos"];

export function interpretarMigracao(conteudo: string, nomeArquivo: string): iMigracao {
    let secao: "nenhuma" | "up" | "down" = "nenhuma";
    const up: string[] = [];
    const down: string[] = [];
    let semTransacao = false;
    let alvo: tAlvo | undefined;

    for (const linha of conteudo.split(/\r?\n/)) {
        const marcador = linha.trim().toLowerCase();

        if (marcador === "-- migrate:up") {
            secao = "up";
            continue;
        }
        if (marcador === "-- migrate:down") {
            secao = "down";
            continue;
        }
        if (marcador === "-- migrate:no-transaction") {
            semTransacao = true;
            continue;
        }
        if (marcador.startsWith("-- migrate:target")) {
            const valor = marcador.replace("-- migrate:target", "").trim();
            if (!ALVOS.includes(valor as tAlvo))
                throw new Error(
                    `Diretiva "-- migrate:target ${valor}" inválida em ${nomeArquivo}. Use: ${ALVOS.join(", ")}`
                );
            alvo = valor as tAlvo;
            continue;
        }

        if (secao === "up") up.push(linha);
        else if (secao === "down") down.push(linha);
    }

    if (!alvo) throw new Error(`Migração sem "-- migrate:target" em ${nomeArquivo}`);

    const upSql = up.join("\n").trim();
    if (!upSql) throw new Error(`Migração sem seção "-- migrate:up" (ou vazia): ${nomeArquivo}`);

    return { up: upSql, down: down.join("\n").trim(), semTransacao, alvo };
}

export function deveRodar(alvo: tAlvo, papel: tPapel): boolean {
    return alvo === "ambos" || alvo === papel;
}

export function nomeDeMigracaoValido(nome: string): boolean {
    return /^\d{14}_[a-z0-9_]+\.sql$/.test(nome);
}
```

- [ ] **Step 5: Implementar o migrador**

`db/migrador.ts`:

```ts
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
    fs.writeFileSync(path.join(dir, arquivo), `-- migrate:target ${alvo}\n-- migrate:up\n\n\n-- migrate:down\n\n`, {
        flag: "wx",
    });
    return arquivo;
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
    if (rows[0].papel !== papel)
        throw new Error(
            `Este banco pertence ao papel "${rows[0].papel}", não a "${papel}". Confira PAPEL e POSTGRES_DB.`
        );
}

async function versoesAplicadas(client: Client): Promise<string[]> {
    const { rows } = await client.query<{ version: string }>("SELECT version FROM schema_migrations ORDER BY version");
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
    await prepararControle(client, papel);
    const aplicadas = new Set(await versoesAplicadas(client));
    return arquivos
        .filter((a) => deveRodar(ler(a).alvo, papel))
        .map((a) => ({ versao: a.versao, aplicada: aplicadas.has(a.versao) }));
}
```

- [ ] **Step 6: Rodar os testes**

Run: `npm test -w db && npm run typecheck -w db`
Expected: todos PASS.

- [ ] **Step 7: CLI**

`db/loadEnv.ts`:

```ts
import dotenv from "dotenv";
import path from "node:path";

// Localmente reaproveita o .env da API; no container as variáveis vêm do compose.
dotenv.config({ path: path.join(__dirname, "..", "apps", "api", ".env"), quiet: true });
```

`db/migrate.ts`:

```ts
import "./loadEnv";
import path from "node:path";
import { Client } from "pg";
import { aplicarPendentes, criarArquivo, listarMigracoes, reverterUltima, situacao } from "./migrador";
import { tAlvo, tPapel } from "./migrateParse";

const DIR = path.join(__dirname, "migrations");

const AJUDA = `Uso:
  npm run migrate -- create <nome> --target=estacao|vps|ambos
  npm run migrate -- up | down | status

O papel e o banco vêm de PAPEL e POSTGRES_HOST/PORT/USER/PASSWORD/DB.`;

function opcao(nome: string): string | undefined {
    return process.argv.find((a) => a.startsWith(`--${nome}=`))?.split("=")[1];
}

function lerPapel(): tPapel {
    const papel = process.env.PAPEL;
    if (papel !== "estacao" && papel !== "vps")
        throw new Error(`PAPEL deve ser "estacao" ou "vps" (recebido: "${papel ?? ""}")`);
    return papel;
}

function novoClient(papel: tPapel): Client {
    const faltando = ["POSTGRES_HOST", "POSTGRES_USER", "POSTGRES_PASSWORD", "POSTGRES_DB"].filter(
        (nome) => !process.env[nome]
    );
    if (faltando.length) throw new Error(`Variáveis faltando: ${faltando.join(", ")}`);

    return new Client({
        host: process.env.POSTGRES_HOST,
        port: Number(process.env.POSTGRES_PORT || 5432),
        user: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD,
        database: process.env.POSTGRES_DB,
        application_name: `fotos-migrate:${papel}`,
    });
}

async function main(): Promise<void> {
    const comando = process.argv[2];

    if (comando === "create") {
        const alvo = opcao("target");
        if (alvo !== "estacao" && alvo !== "vps" && alvo !== "ambos")
            throw new Error("Informe --target=estacao, --target=vps ou --target=ambos");
        const arquivo = criarArquivo(DIR, process.argv[3] ?? "", alvo as tAlvo);
        console.log(`[Migrate] Criada: db/migrations/${arquivo}`);
        return;
    }

    if (comando !== "up" && comando !== "down" && comando !== "status") {
        console.log(AJUDA);
        process.exitCode = 1;
        return;
    }

    const papel = lerPapel();
    const arquivos = listarMigracoes(DIR);
    const client = novoClient(papel);
    await client.connect();
    console.log(`[Migrate] Banco ${process.env.POSTGRES_DB}, papel ${papel}`);

    try {
        if (comando === "up") {
            const feitas = await aplicarPendentes(client, arquivos, papel);
            if (!feitas.length) console.log("[Migrate] Nada pendente");
            for (const versao of feitas) console.log(`[Migrate] ✓ aplicada ${versao}`);
        } else if (comando === "down") {
            const versao = await reverterUltima(client, arquivos, papel);
            console.log(versao ? `[Migrate] ✓ revertida ${versao}` : "[Migrate] Nada para reverter");
        } else {
            for (const item of await situacao(client, arquivos, papel))
                console.log(`[Migrate] [${item.aplicada ? "✓" : " "}] ${item.versao}`);
        }
    } finally {
        await client.end();
    }
}

main().catch((erro) => {
    console.error(`[Migrate] ${(erro as Error).message}`);
    process.exit(1);
});
```

Run: `npm run migrate; echo "saida=$?"`
Expected: imprime o texto de uso e `saida=1`.

Run: `npm run typecheck -w db`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json db
git commit -m "feat(db): runner de migrations com alvo por papel" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Postgres e Redis de desenvolvimento + integração do runner

**Files:**
- Create: `docker-compose.dev.yml` (só `postgres` e `redis` nesta task), `infra/postgres/dev-bancos.sql`, `apps/api/.env.example`
- Create: `db/integracao/bancoTeste.ts`, `db/integracao/migrador.test.ts`
- Create: `db/integracao/fixtures/basico/*.sql`, `db/integracao/fixtures/com-erro/*.sql`

**Interfaces:**
- Consumes: `listarMigracoes`, `aplicarPendentes`, `reverterUltima`, `situacao` (Task 5)
- Produces (`db/integracao/bancoTeste.ts`, usado também na Task 7):
  - `conexaoTeste(database: string): Client` — padrões `127.0.0.1:5433`, `fotos`/`fotos`, sobrescritos por `POSTGRES_*`
  - `criarBancoTeste(): Promise<{ client: Client; remover(): Promise<void> }>` — banco descartável `fotos_teste_*`
  - `tabelas(client: Client): Promise<string[]>` — tabelas do schema `public`, em ordem

- [ ] **Step 1: Compose de desenvolvimento (infraestrutura)**

`infra/postgres/dev-bancos.sql`:

```sql
CREATE DATABASE fotos_estacao;
CREATE DATABASE fotos_vps;
```

`docker-compose.dev.yml`:

```yaml
# Desenvolvimento: os dois papéis na mesma máquina.
# Só a infraestrutura:  docker compose -f docker-compose.dev.yml up -d postgres redis
name: fotos-dev

services:
  postgres:
    image: pgvector/pgvector:0.8.1-pg16
    environment:
      POSTGRES_USER: fotos
      POSTGRES_PASSWORD: fotos
    ports:
      - "127.0.0.1:5433:5432"
    volumes:
      - pg-dev:/var/lib/postgresql/data
      - ./infra/postgres/dev-bancos.sql:/docker-entrypoint-initdb.d/01-bancos.sql:ro
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U fotos"]
      interval: 5s
      retries: 10

  redis:
    image: redis:7-alpine
    ports:
      - "127.0.0.1:6380:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      retries: 10

volumes:
  pg-dev:
```

`apps/api/.env.example` (para rodar a API e as migrations fora do Docker):

```
PAPEL=vps
PORTA=3002
POSTGRES_HOST=127.0.0.1
POSTGRES_PORT=5433
POSTGRES_USER=fotos
POSTGRES_PASSWORD=fotos
POSTGRES_DB=fotos_vps
REDIS_URL=redis://127.0.0.1:6380
ESTACAO_CHAVE=dev-somente-local-dev-somente-local
ARQUIVO_SEGREDO=dev-somente-local
VPS_URL=http://127.0.0.1:3002
```

Run:

```bash
docker compose -f docker-compose.dev.yml up -d postgres redis
docker compose -f docker-compose.dev.yml ps
docker compose -f docker-compose.dev.yml exec postgres psql -U fotos -Atc "SELECT datname FROM pg_database WHERE datname LIKE 'fotos_%' ORDER BY 1"
cp apps/api/.env.example apps/api/.env
```

Expected: os dois serviços `healthy`; a consulta lista `fotos_estacao` e `fotos_vps`.

- [ ] **Step 2: Fixtures**

`db/integracao/fixtures/basico/20000101000001_tabela_comum.sql`:

```sql
-- migrate:target ambos
-- migrate:up
CREATE TABLE comum (id int);

-- migrate:down
DROP TABLE comum;
```

`db/integracao/fixtures/basico/20000101000002_tabela_vps.sql`:

```sql
-- migrate:target vps
-- migrate:up
CREATE TABLE so_vps (id int);

-- migrate:down
DROP TABLE so_vps;
```

`db/integracao/fixtures/basico/20000101000003_tabela_estacao.sql`:

```sql
-- migrate:target estacao
-- migrate:up
CREATE TABLE so_estacao (id int);

-- migrate:down
DROP TABLE so_estacao;
```

`db/integracao/fixtures/com-erro/20000101000001_boa.sql`:

```sql
-- migrate:target ambos
-- migrate:up
CREATE TABLE boa (id int);

-- migrate:down
DROP TABLE boa;
```

`db/integracao/fixtures/com-erro/20000101000002_quebrada.sql`:

```sql
-- migrate:target vps
-- migrate:up
CREATE TABLE parcial (id int);
SELECT * FROM tabela_que_nao_existe;

-- migrate:down
DROP TABLE parcial;
```

- [ ] **Step 3: Auxiliar de banco de teste**

`db/integracao/bancoTeste.ts`:

```ts
import { Client } from "pg";

export function conexaoTeste(database: string): Client {
    return new Client({
        host: process.env.POSTGRES_HOST ?? "127.0.0.1",
        port: Number(process.env.POSTGRES_PORT ?? 5433),
        user: process.env.POSTGRES_USER ?? "fotos",
        password: process.env.POSTGRES_PASSWORD ?? "fotos",
        database,
    });
}

export async function criarBancoTeste(): Promise<{ client: Client; remover(): Promise<void> }> {
    const nome = `fotos_teste_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
    const admin = conexaoTeste("postgres");
    await admin.connect();
    await admin.query(`CREATE DATABASE ${nome}`);

    const client = conexaoTeste(nome);
    await client.connect();

    return {
        client,
        async remover() {
            await client.end();
            await admin.query(`DROP DATABASE IF EXISTS ${nome} WITH (FORCE)`);
            await admin.end();
        },
    };
}

export async function tabelas(client: Client): Promise<string[]> {
    const { rows } = await client.query<{ tablename: string }>(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
    );
    return rows.map((r) => r.tablename);
}
```

- [ ] **Step 4: Escrever o teste de integração**

`db/integracao/migrador.test.ts`:

```ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import path from "node:path";
import { Client } from "pg";
import { aplicarPendentes, listarMigracoes, reverterUltima, situacao } from "../migrador";
import { criarBancoTeste, tabelas } from "./bancoTeste";

const BASICO = listarMigracoes(path.join(__dirname, "fixtures", "basico"));
const COM_ERRO = listarMigracoes(path.join(__dirname, "fixtures", "com-erro"));

describe("migrador com banco real", () => {
    let banco: { client: Client; remover(): Promise<void> };

    before(async () => {
        banco = await criarBancoTeste();
    });

    after(async () => {
        await banco.remover();
    });

    test("aplica só as migrações do papel, em ordem", async () => {
        const feitas = await aplicarPendentes(banco.client, BASICO, "vps");

        assert.deepStrictEqual(feitas, ["20000101000001_tabela_comum", "20000101000002_tabela_vps"]);
        assert.deepStrictEqual(await tabelas(banco.client), ["comum", "schema_migrations", "schema_papel", "so_vps"]);
    });

    test("segunda execução não aplica nada", async () => {
        assert.deepStrictEqual(await aplicarPendentes(banco.client, BASICO, "vps"), []);
    });

    test("recusa usar o banco com o outro papel", async () => {
        await assert.rejects(aplicarPendentes(banco.client, BASICO, "estacao"), /pertence ao papel "vps"/);
    });

    test("situacao lista só as do papel", async () => {
        assert.deepStrictEqual(await situacao(banco.client, BASICO, "vps"), [
            { versao: "20000101000001_tabela_comum", aplicada: true },
            { versao: "20000101000002_tabela_vps", aplicada: true },
        ]);
    });

    test("reverte uma por vez, da última para a primeira", async () => {
        assert.strictEqual(await reverterUltima(banco.client, BASICO, "vps"), "20000101000002_tabela_vps");
        assert.deepStrictEqual(await tabelas(banco.client), ["comum", "schema_migrations", "schema_papel"]);

        assert.strictEqual(await reverterUltima(banco.client, BASICO, "vps"), "20000101000001_tabela_comum");
        assert.strictEqual(await reverterUltima(banco.client, BASICO, "vps"), null);
        assert.deepStrictEqual(await tabelas(banco.client), ["schema_migrations", "schema_papel"]);
    });
});

describe("migração que falha", () => {
    let banco: { client: Client; remover(): Promise<void> };

    before(async () => {
        banco = await criarBancoTeste();
    });

    after(async () => {
        await banco.remover();
    });

    test("desfaz a que falhou e mantém as anteriores", async () => {
        await assert.rejects(aplicarPendentes(banco.client, COM_ERRO, "vps"), /Falha em 20000101000002_quebrada/);

        assert.deepStrictEqual(await tabelas(banco.client), ["boa", "schema_migrations", "schema_papel"]);
        const { rows } = await banco.client.query("SELECT version FROM schema_migrations");
        assert.deepStrictEqual(rows, [{ version: "20000101000001_boa" }]);
    });
});
```

- [ ] **Step 5: Rodar**

Run: `npm run test:integracao -w db`
Expected: 6 testes PASS. Se falhar com `ECONNREFUSED 127.0.0.1:5433`, o Postgres do Step 1 não está de pé.

- [ ] **Step 6: Commit**

```bash
git add docker-compose.dev.yml infra/postgres apps/api/.env.example db/integracao
git commit -m "test(db): integração do runner com Postgres real" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Migrations iniciais (seções 5.1 e 5.2)

**Files:**
- Create: `db/migrations/20260918120000_extensao_vector.sql` (ambos)
- Create: `db/migrations/20260918120100_cadastros.sql` (ambos)
- Create: `db/migrations/20260918120200_vps_fotos.sql` (vps)
- Create: `db/migrations/20260918120300_vps_participante_busca.sql` (vps)
- Create: `db/migrations/20260918120400_vps_admin.sql` (vps)
- Create: `db/migrations/20260918120500_estacao.sql` (estacao)
- Test: `db/integracao/esquema.test.ts`

**Interfaces:**
- Consumes: `listarMigracoes`, `aplicarPendentes`, `reverterUltima` (Task 5); `criarBancoTeste`, `tabelas` (Task 6)
- Produces: o schema que as fases 3 e 4 usam. Nomes que o código vai citar: `ux_foto_evento_hash`, `ix_rosto_embedding`, `ux_busca_codigo_aguardando`, `ux_participante_evento`, `ux_evento_fotografo`.

Decisões de schema que o spec deixa em aberto:
- `busca.id_busca_origem` usa `ON DELETE SET NULL`: a exclusão LGPD apaga buscas em lote e não pode travar na cadeia de "buscar de novo".
- `busca_foto.id_rosto` fica **sem** FK, como no spec: a exclusão LGPD apaga o rosto usando esse valor.
- `CHECK (privado = 'N' OR chave_acesso IS NOT NULL)` em `evento`: evento privado sem chave ficaria inacessível.
- `updated_at` é atualizado pelo SQL da aplicação (`SET updated_at = now()`), sem trigger.
- Índices extras para as cascatas e buscas por FK: `ix_evento_patrocinador_evento`, `ix_numero_peito_foto`, `ix_busca_participante`, `ix_busca_foto_foto`, `ix_estacao_sinal_recebido`, `ix_upload_fotografo_hash`, `ix_foto_etapa`.

- [ ] **Step 1: Escrever o teste do schema**

`db/integracao/esquema.test.ts`:

```ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import path from "node:path";
import { Client } from "pg";
import { aplicarPendentes, listarMigracoes, reverterUltima } from "../migrador";
import { tPapel } from "../migrateParse";
import { criarBancoTeste, tabelas } from "./bancoTeste";

const MIGRACOES = listarMigracoes(path.join(__dirname, "..", "migrations"));
const CONTROLE = ["schema_migrations", "schema_papel"];

const TABELAS_VPS = [
    "aparelho", "arquivo_zip", "busca", "busca_foto", "calibracao", "estacao_sinal", "evento",
    "evento_fotografo", "evento_patrocinador", "evento_resumo", "foto", "fotografo", "log",
    "numero_peito", "operador", "participante", "participante_evento", "rosto",
];
const TABELAS_ESTACAO = ["evento", "evento_fotografo", "foto", "fotografo", "numero_peito", "operador", "rosto", "upload"];

function vetor(posicao: number): string {
    const v = new Array(512).fill(0);
    v[posicao] = 1;
    return `[${v.join(",")}]`;
}

async function novoEvento(client: Client, slug: string): Promise<number> {
    const { rows } = await client.query(
        `INSERT INTO evento (nome, slug, tipo, chave_anfitriao, data_fim)
         VALUES ($1, $1, 'esportivo', $2, '2026-12-31') RETURNING id_evento`,
        [slug, `anf-${slug}`]
    );
    return rows[0].id_evento;
}

async function novaFotoVps(client: Client, idEvento: number, hash: string, situacao = "visivel"): Promise<number> {
    const { rows } = await client.query(
        `INSERT INTO foto (id_evento, hash_arquivo, largura, altura, bytes_web, situacao)
         VALUES ($1, $2, 2048, 1365, 500000, $3) RETURNING id_foto`,
        [idEvento, hash, situacao]
    );
    return rows[0].id_foto;
}

async function novoRosto(client: Client, idFoto: number, idEvento: number, embedding: string): Promise<void> {
    await client.query(
        `INSERT INTO rosto (id_foto, id_evento, embedding, bbox, det_score, area_px)
         VALUES ($1, $2, $3::vector, '[0,0,10,10]', 0.9, 100)`,
        [idFoto, idEvento, embedding]
    );
}

async function desfazerTudo(client: Client, papel: tPapel): Promise<void> {
    while (await reverterUltima(client, MIGRACOES, papel)) {}
}

describe("schema da VPS", () => {
    let banco: { client: Client; remover(): Promise<void> };

    before(async () => {
        banco = await criarBancoTeste();
        await aplicarPendentes(banco.client, MIGRACOES, "vps");
    });

    after(async () => {
        await banco.remover();
    });

    test("cria exatamente as tabelas da VPS", async () => {
        assert.deepStrictEqual(await tabelas(banco.client), [...TABELAS_VPS, ...CONTROLE].sort());
    });

    test("pgvector é 0.8 ou mais novo", async () => {
        const { rows } = await banco.client.query("SELECT extversion FROM pg_extension WHERE extname = 'vector'");
        const [maior, menor] = String(rows[0].extversion).split(".").map(Number);

        assert.ok(maior > 0 || menor >= 8, `pgvector ${rows[0].extversion}`);
    });

    test("rosto tem índice HNSW por cosseno", async () => {
        const { rows } = await banco.client.query("SELECT indexdef FROM pg_indexes WHERE indexname = 'ix_rosto_embedding'");

        assert.match(rows[0].indexdef, /USING hnsw \(embedding vector_cosine_ops\)/);
        assert.match(rows[0].indexdef, /m='16'/);
        assert.match(rows[0].indexdef, /ef_construction='200'/);
    });

    test("a consulta do spec filtra evento e foto oculta", async () => {
        const a = await novoEvento(banco.client, "corrida-a");
        const b = await novoEvento(banco.client, "corrida-b");
        const visivel = await novaFotoVps(banco.client, a, "h1");
        const oculta = await novaFotoVps(banco.client, a, "h2", "oculta");
        const outroEvento = await novaFotoVps(banco.client, b, "h3");
        const outraPessoa = await novaFotoVps(banco.client, a, "h4");
        await novoRosto(banco.client, visivel, a, vetor(0));
        await novoRosto(banco.client, oculta, a, vetor(0));
        await novoRosto(banco.client, outroEvento, b, vetor(0));
        await novoRosto(banco.client, outraPessoa, a, vetor(1));

        await banco.client.query("BEGIN");
        await banco.client.query("SET LOCAL hnsw.ef_search = 100");
        await banco.client.query("SET LOCAL hnsw.iterative_scan = relaxed_order");
        const { rows } = await banco.client.query(
            `SELECT r.id_foto, 1 - (r.embedding <=> $1::vector) AS similaridade
               FROM rosto r
               JOIN foto f ON f.id_foto = r.id_foto AND f.situacao = 'visivel'
              WHERE r.id_evento = $2
              ORDER BY r.embedding <=> $1::vector
              LIMIT 400`,
            [vetor(0), a]
        );
        await banco.client.query("COMMIT");

        assert.deepStrictEqual(
            rows.map((r) => [r.id_foto, Math.round(r.similaridade)]),
            [[visivel, 1], [outraPessoa, 0]]
        );
    });

    test("foto é única por evento e hash", async () => {
        const e = await novoEvento(banco.client, "unica");
        await novaFotoVps(banco.client, e, "repetido");

        await assert.rejects(novaFotoVps(banco.client, e, "repetido"), /ux_foto_evento_hash/);
    });

    test("apagar a foto leva rostos e vínculos de busca junto", async () => {
        const e = await novoEvento(banco.client, "cascata");
        const foto = await novaFotoVps(banco.client, e, "c1");
        await novoRosto(banco.client, foto, e, vetor(2));
        const { rows } = await banco.client.query(
            `INSERT INTO busca (id_evento, token, status, consentimento_em, versao_termo)
             VALUES ($1, 'tok-cascata', 'liberada', now(), 'v1') RETURNING id_busca`,
            [e]
        );
        await banco.client.query("INSERT INTO busca_foto (id_busca, id_foto, similaridade) VALUES ($1, $2, 0.9)", [
            rows[0].id_busca,
            foto,
        ]);

        await banco.client.query("DELETE FROM foto WHERE id_foto = $1", [foto]);

        const rostos = await banco.client.query("SELECT 1 FROM rosto WHERE id_foto = $1", [foto]);
        const vinculos = await banco.client.query("SELECT 1 FROM busca_foto WHERE id_foto = $1", [foto]);
        assert.strictEqual(rostos.rowCount, 0);
        assert.strictEqual(vinculos.rowCount, 0);
    });

    test("código de busca é único só entre as aguardando", async () => {
        const e = await novoEvento(banco.client, "codigos");
        const inserir = (token: string) =>
            banco.client.query(
                `INSERT INTO busca (id_evento, token, codigo, status, consentimento_em, versao_termo)
                 VALUES ($1, $2, '12345', 'aguardando', now(), 'v1')`,
                [e, token]
            );

        await inserir("t1");
        await assert.rejects(inserir("t2"), /ux_busca_codigo_aguardando/);

        await banco.client.query("UPDATE busca SET status = 'expirada' WHERE token = 't1'");
        await inserir("t2");
    });

    test("evento privado exige chave de acesso", async () => {
        await assert.rejects(
            banco.client.query(
                `INSERT INTO evento (nome, slug, tipo, privado, chave_anfitriao, data_fim)
                 VALUES ('Casamento', 'casamento', 'social', 'S', 'anf-cas', '2026-12-31')`
            ),
            /violates check constraint/
        );
    });

    test("desfazer tudo volta ao banco vazio e refazer funciona", async () => {
        await desfazerTudo(banco.client, "vps");
        assert.deepStrictEqual(await tabelas(banco.client), CONTROLE);

        const feitas = await aplicarPendentes(banco.client, MIGRACOES, "vps");
        assert.strictEqual(feitas.length, 5);
    });
});

describe("schema da estação", () => {
    let banco: { client: Client; remover(): Promise<void> };

    before(async () => {
        banco = await criarBancoTeste();
        await aplicarPendentes(banco.client, MIGRACOES, "estacao");
    });

    after(async () => {
        await banco.remover();
    });

    test("cria exatamente as tabelas da estação", async () => {
        assert.deepStrictEqual(await tabelas(banco.client), [...TABELAS_ESTACAO, ...CONTROLE].sort());
    });

    test("evento ganha encerrado_em", async () => {
        const { rowCount } = await banco.client.query(
            "SELECT 1 FROM information_schema.columns WHERE table_name = 'evento' AND column_name = 'encerrado_em'"
        );
        assert.strictEqual(rowCount, 1);
    });

    test("rosto não tem índice HNSW", async () => {
        const { rowCount } = await banco.client.query(
            "SELECT 1 FROM pg_indexes WHERE tablename = 'rosto' AND indexdef ILIKE '%hnsw%'"
        );
        assert.strictEqual(rowCount, 0);
    });

    test("foto nasce na etapa registrada e recusa etapa desconhecida", async () => {
        const e = await novoEvento(banco.client, "estacao-etapa");
        const { rows } = await banco.client.query(
            "INSERT INTO foto (id_evento, hash_arquivo, nome_arquivo) VALUES ($1, 'h1', 'IMG_0001.JPG') RETURNING etapa",
            [e]
        );
        assert.strictEqual(rows[0].etapa, "registrada");

        await assert.rejects(
            banco.client.query(
                "INSERT INTO foto (id_evento, hash_arquivo, nome_arquivo, etapa) VALUES ($1, 'h2', 'x.jpg', 'pronta')",
                [e]
            ),
            /violates check constraint/
        );
    });

    test("desfazer tudo volta ao banco vazio e refazer funciona", async () => {
        await desfazerTudo(banco.client, "estacao");
        assert.deepStrictEqual(await tabelas(banco.client), CONTROLE);

        const feitas = await aplicarPendentes(banco.client, MIGRACOES, "estacao");
        assert.strictEqual(feitas.length, 3);
    });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:integracao -w db`
Expected: FAIL nos testes de schema (nenhuma tabela criada: `db/migrations` ainda não existe).

- [ ] **Step 3: Extensão e cadastros (ambos)**

`db/migrations/20260918120000_extensao_vector.sql`:

```sql
-- migrate:target ambos
-- migrate:up
CREATE EXTENSION IF NOT EXISTS vector;

-- migrate:down
DROP EXTENSION IF EXISTS vector;
```

`db/migrations/20260918120100_cadastros.sql`:

```sql
-- migrate:target ambos
-- migrate:up
-- Na estação estas tabelas são cópias da VPS, gravadas com os mesmos IDs pela sincronização.
CREATE TABLE IF NOT EXISTS operador (
    id_operador serial       PRIMARY KEY,
    nome        varchar(100) NOT NULL,
    login       varchar(60)  NOT NULL UNIQUE,
    senha_hash  varchar(200) NOT NULL,
    deletado    varchar(1)   NOT NULL DEFAULT 'N' CHECK (deletado IN ('S', 'N')),
    criado_em   timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evento (
    id_evento       serial       PRIMARY KEY,
    nome            varchar(150) NOT NULL,
    slug            varchar(80)  NOT NULL UNIQUE,
    tipo            varchar(20)  NOT NULL CHECK (tipo IN ('esportivo', 'social')),
    privado         varchar(1)   NOT NULL DEFAULT 'N' CHECK (privado IN ('S', 'N')),
    chave_acesso    varchar(40)  UNIQUE,
    chave_anfitriao varchar(40)  NOT NULL UNIQUE,
    data_inicio     date,
    data_fim        date         NOT NULL,
    ativo           varchar(1)   NOT NULL DEFAULT 'S' CHECK (ativo IN ('S', 'N')),
    config          jsonb        NOT NULL DEFAULT '{}',
    expurgado_em    timestamptz,
    deletado        varchar(1)   NOT NULL DEFAULT 'N' CHECK (deletado IN ('S', 'N')),
    criado_em       timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT ck_evento_privado_com_chave CHECK (privado = 'N' OR chave_acesso IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS fotografo (
    id_fotografo serial       PRIMARY KEY,
    nome         varchar(100) NOT NULL,
    telefone     varchar(20),
    deletado     varchar(1)   NOT NULL DEFAULT 'N' CHECK (deletado IN ('S', 'N')),
    criado_em    timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evento_fotografo (
    id_evento_fotografo serial      PRIMARY KEY,
    id_evento           int         NOT NULL REFERENCES evento (id_evento),
    id_fotografo        int         NOT NULL REFERENCES fotografo (id_fotografo),
    token_upload        varchar(40) NOT NULL UNIQUE,
    ativo               varchar(1)  NOT NULL DEFAULT 'S' CHECK (ativo IN ('S', 'N')),
    criado_em           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ux_evento_fotografo UNIQUE (id_evento, id_fotografo)
);

-- migrate:down
DROP TABLE IF EXISTS evento_fotografo;
DROP TABLE IF EXISTS fotografo;
DROP TABLE IF EXISTS evento;
DROP TABLE IF EXISTS operador;
```

- [ ] **Step 4: Fotos e rostos (VPS)**

`db/migrations/20260918120200_vps_fotos.sql`:

```sql
-- migrate:target vps
-- migrate:up
CREATE TABLE IF NOT EXISTS evento_patrocinador (
    id_evento_patrocinador serial       PRIMARY KEY,
    id_evento              int          NOT NULL REFERENCES evento (id_evento) ON DELETE CASCADE,
    nome                   varchar(100) NOT NULL,
    site                   varchar(255),
    ordem                  int          NOT NULL DEFAULT 0,
    criado_em              timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_evento_patrocinador_evento ON evento_patrocinador (id_evento);

CREATE TABLE IF NOT EXISTS foto (
    id_foto             serial      PRIMARY KEY,
    id_evento           int         NOT NULL REFERENCES evento (id_evento) ON DELETE CASCADE,
    id_evento_fotografo int         REFERENCES evento_fotografo (id_evento_fotografo),
    hash_arquivo        varchar(64) NOT NULL,
    largura             int         NOT NULL,
    altura              int         NOT NULL,
    bytes_web           int         NOT NULL,
    capturada_em        timestamptz,
    camera              varchar(80),
    qtd_rostos          int         NOT NULL DEFAULT 0,
    publicada_em        timestamptz NOT NULL DEFAULT now(),
    situacao            varchar(20) NOT NULL DEFAULT 'visivel' CHECK (situacao IN ('visivel', 'oculta', 'excluida')),
    situacao_em         timestamptz,
    CONSTRAINT ux_foto_evento_hash UNIQUE (id_evento, hash_arquivo)
);

CREATE TABLE IF NOT EXISTS rosto (
    id_rosto  bigserial   PRIMARY KEY,
    id_foto   int         NOT NULL REFERENCES foto (id_foto) ON DELETE CASCADE,
    id_evento int         NOT NULL REFERENCES evento (id_evento) ON DELETE CASCADE,
    embedding vector(512) NOT NULL,
    bbox      jsonb       NOT NULL,
    det_score real        NOT NULL,
    area_px   int         NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_rosto_foto ON rosto (id_foto);
CREATE INDEX IF NOT EXISTS ix_rosto_embedding ON rosto
    USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 200);

-- Vazia até a Fase 2 do produto (OCR do número de peito).
CREATE TABLE IF NOT EXISTS numero_peito (
    id_numero_peito bigserial   PRIMARY KEY,
    id_foto         int         NOT NULL REFERENCES foto (id_foto) ON DELETE CASCADE,
    id_evento       int         NOT NULL REFERENCES evento (id_evento) ON DELETE CASCADE,
    numero          varchar(20) NOT NULL,
    confianca       real        NOT NULL,
    bbox            jsonb       NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_numero_peito_evento ON numero_peito (id_evento, numero);
CREATE INDEX IF NOT EXISTS ix_numero_peito_foto ON numero_peito (id_foto);

-- migrate:down
DROP TABLE IF EXISTS numero_peito;
DROP TABLE IF EXISTS rosto;
DROP TABLE IF EXISTS foto;
DROP TABLE IF EXISTS evento_patrocinador;
```

- [ ] **Step 5: Participantes e buscas (VPS)**

`db/migrations/20260918120300_vps_participante_busca.sql`:

```sql
-- migrate:target vps
-- migrate:up
CREATE TABLE IF NOT EXISTS participante (
    id_participante serial       PRIMARY KEY,
    telefone        varchar(20)  NOT NULL UNIQUE,
    nome_whatsapp   varchar(100),
    criado_em       timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS participante_evento (
    id_participante_evento serial      PRIMARY KEY,
    id_participante        int         NOT NULL REFERENCES participante (id_participante) ON DELETE CASCADE,
    id_evento              int         NOT NULL REFERENCES evento (id_evento) ON DELETE CASCADE,
    aceita_marketing       varchar(1)  NOT NULL DEFAULT 'N' CHECK (aceita_marketing IN ('S', 'N')),
    primeira_verificacao   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ux_participante_evento UNIQUE (id_participante, id_evento)
);

CREATE TABLE IF NOT EXISTS aparelho (
    id_aparelho            serial      PRIMARY KEY,
    id_participante_evento int         NOT NULL REFERENCES participante_evento (id_participante_evento) ON DELETE CASCADE,
    chave_hash             varchar(64) NOT NULL UNIQUE,
    criado_em              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS busca (
    id_busca         serial      PRIMARY KEY,
    id_evento        int         NOT NULL REFERENCES evento (id_evento) ON DELETE CASCADE,
    token            varchar(40) NOT NULL UNIQUE,
    codigo           varchar(5),
    status           varchar(20) NOT NULL CHECK (status IN ('aguardando', 'liberada', 'expirada')),
    qtd_fotos        int         NOT NULL DEFAULT 0,
    qtd_downloads    int         NOT NULL DEFAULT 0,
    consentimento_em timestamptz NOT NULL,
    versao_termo     varchar(20) NOT NULL,
    aceita_marketing varchar(1)  NOT NULL DEFAULT 'N' CHECK (aceita_marketing IN ('S', 'N')),
    id_participante  int         REFERENCES participante (id_participante),
    -- Preenchida no "buscar de novo". SET NULL para a exclusão LGPD apagar buscas em lote.
    id_busca_origem  int         REFERENCES busca (id_busca) ON DELETE SET NULL,
    criado_em        timestamptz NOT NULL DEFAULT now(),
    verificada_em    timestamptz,
    codigo_expira_em timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_busca_codigo_aguardando ON busca (codigo) WHERE status = 'aguardando';
CREATE INDEX IF NOT EXISTS ix_busca_evento ON busca (id_evento);
CREATE INDEX IF NOT EXISTS ix_busca_participante ON busca (id_participante);

CREATE TABLE IF NOT EXISTS busca_foto (
    id_busca     int    NOT NULL REFERENCES busca (id_busca) ON DELETE CASCADE,
    id_foto      int    NOT NULL REFERENCES foto (id_foto) ON DELETE CASCADE,
    -- Rosto do melhor match. Sem FK: a exclusão LGPD apaga o rosto a partir deste valor.
    id_rosto     bigint,
    similaridade real   NOT NULL,
    PRIMARY KEY (id_busca, id_foto)
);
CREATE INDEX IF NOT EXISTS ix_busca_foto_foto ON busca_foto (id_foto);

CREATE TABLE IF NOT EXISTS arquivo_zip (
    id_arquivo_zip serial      PRIMARY KEY,
    id_evento      int         NOT NULL REFERENCES evento (id_evento) ON DELETE CASCADE,
    id_busca       int         REFERENCES busca (id_busca) ON DELETE CASCADE,
    parte          int         NOT NULL DEFAULT 1,
    status         varchar(20) NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente', 'pronto', 'erro')),
    qtd_fotos      int         NOT NULL DEFAULT 0,
    bytes          bigint,
    criado_em      timestamptz NOT NULL DEFAULT now(),
    expira_em      timestamptz NOT NULL
);

-- migrate:down
DROP TABLE IF EXISTS arquivo_zip;
DROP TABLE IF EXISTS busca_foto;
DROP TABLE IF EXISTS busca;
DROP TABLE IF EXISTS aparelho;
DROP TABLE IF EXISTS participante_evento;
DROP TABLE IF EXISTS participante;
```

- [ ] **Step 6: Administração (VPS)**

`db/migrations/20260918120400_vps_admin.sql`:

```sql
-- migrate:target vps
-- migrate:up
CREATE TABLE IF NOT EXISTS calibracao (
    id_calibracao serial      PRIMARY KEY,
    id_evento     int         NOT NULL REFERENCES evento (id_evento) ON DELETE CASCADE,
    rotulo        varchar(60) NOT NULL,
    -- [{ similaridade, correta }]: sem imagem nem vetor.
    amostras      jsonb       NOT NULL,
    criado_em     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evento_resumo (
    id_evento                int         PRIMARY KEY REFERENCES evento (id_evento) ON DELETE CASCADE,
    qtd_fotos                int         NOT NULL DEFAULT 0,
    qtd_buscas               int         NOT NULL DEFAULT 0,
    qtd_buscas_com_resultado int         NOT NULL DEFAULT 0,
    qtd_verificados          int         NOT NULL DEFAULT 0,
    qtd_leads_marketing      int         NOT NULL DEFAULT 0,
    qtd_downloads            int         NOT NULL DEFAULT 0,
    qtd_zips                 int         NOT NULL DEFAULT 0,
    congelado_em             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS estacao_sinal (
    id_estacao_sinal serial      PRIMARY KEY,
    recebido_em      timestamptz NOT NULL DEFAULT now(),
    dados            jsonb       NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_estacao_sinal_recebido ON estacao_sinal (recebido_em);

CREATE TABLE IF NOT EXISTS log (
    id_log      serial      PRIMARY KEY,
    id_operador int         REFERENCES operador (id_operador),
    tela        varchar(60) NOT NULL,
    log         text        NOT NULL,
    criado_em   timestamptz NOT NULL DEFAULT now()
);

-- migrate:down
DROP TABLE IF EXISTS log;
DROP TABLE IF EXISTS estacao_sinal;
DROP TABLE IF EXISTS evento_resumo;
DROP TABLE IF EXISTS calibracao;
```

- [ ] **Step 7: Estação**

`db/migrations/20260918120500_estacao.sql`:

```sql
-- migrate:target estacao
-- migrate:up
ALTER TABLE evento ADD COLUMN IF NOT EXISTS encerrado_em timestamptz;

CREATE TABLE IF NOT EXISTS upload (
    id_upload           serial       PRIMARY KEY,
    id_evento_fotografo int          NOT NULL REFERENCES evento_fotografo (id_evento_fotografo),
    nome_arquivo        varchar(255) NOT NULL,
    tamanho             bigint       NOT NULL,
    hash_arquivo        varchar(64)  NOT NULL,
    bytes_recebidos     bigint       NOT NULL DEFAULT 0,
    status              varchar(20)  NOT NULL DEFAULT 'recebendo' CHECK (status IN ('recebendo', 'completo', 'cancelado')),
    criado_em           timestamptz  NOT NULL DEFAULT now(),
    updated_at          timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_upload_fotografo_hash ON upload (id_evento_fotografo, hash_arquivo);

CREATE TABLE IF NOT EXISTS foto (
    id_foto             serial       PRIMARY KEY,
    id_evento           int          NOT NULL REFERENCES evento (id_evento),
    id_evento_fotografo int          REFERENCES evento_fotografo (id_evento_fotografo),
    hash_arquivo        varchar(64)  NOT NULL,
    nome_arquivo        varchar(255) NOT NULL,
    caminho_original    text,
    largura             int,
    altura              int,
    bytes_original      bigint,
    bytes_web           int,
    capturada_em        timestamptz,
    camera              varchar(80),
    qtd_rostos          int,
    etapa               varchar(20)  NOT NULL DEFAULT 'registrada'
                        CHECK (etapa IN ('registrada', 'original', 'rostos', 'derivados', 'publicada')),
    erro                text,
    erro_etapa          varchar(20),
    criado_em           timestamptz  NOT NULL DEFAULT now(),
    processada_em       timestamptz,
    publicada_em        timestamptz,
    CONSTRAINT ux_foto_evento_hash UNIQUE (id_evento, hash_arquivo)
);
CREATE INDEX IF NOT EXISTS ix_foto_etapa ON foto (id_evento, etapa);

-- Igual à VPS, sem o índice HNSW: a estação não faz busca.
CREATE TABLE IF NOT EXISTS rosto (
    id_rosto  bigserial   PRIMARY KEY,
    id_foto   int         NOT NULL REFERENCES foto (id_foto) ON DELETE CASCADE,
    id_evento int         NOT NULL REFERENCES evento (id_evento) ON DELETE CASCADE,
    embedding vector(512) NOT NULL,
    bbox      jsonb       NOT NULL,
    det_score real        NOT NULL,
    area_px   int         NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_rosto_foto ON rosto (id_foto);

CREATE TABLE IF NOT EXISTS numero_peito (
    id_numero_peito bigserial   PRIMARY KEY,
    id_foto         int         NOT NULL REFERENCES foto (id_foto) ON DELETE CASCADE,
    id_evento       int         NOT NULL REFERENCES evento (id_evento) ON DELETE CASCADE,
    numero          varchar(20) NOT NULL,
    confianca       real        NOT NULL,
    bbox            jsonb       NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_numero_peito_evento ON numero_peito (id_evento, numero);
CREATE INDEX IF NOT EXISTS ix_numero_peito_foto ON numero_peito (id_foto);

-- migrate:down
DROP TABLE IF EXISTS numero_peito;
DROP TABLE IF EXISTS rosto;
DROP TABLE IF EXISTS foto;
DROP TABLE IF EXISTS upload;
ALTER TABLE evento DROP COLUMN IF EXISTS encerrado_em;
```

- [ ] **Step 8: Rodar os testes**

Run: `npm run test:integracao -w db`
Expected: todos PASS (runner + schema).

- [ ] **Step 9: Aplicar nos bancos de desenvolvimento**

Run:

```bash
npm run migrate:dev
PAPEL=vps POSTGRES_DB=fotos_vps npm run migrate -- status
```

Expected: 3 migrations aplicadas em `fotos_estacao`, 5 em `fotos_vps`; o `status` mostra as 5 da VPS com `✓`. Rodar `npm run migrate:dev` de novo imprime `Nada pendente` duas vezes.

- [ ] **Step 10: Commit**

```bash
git add db/migrations db/integracao/esquema.test.ts
git commit -m "feat(db): schema inicial da VPS e da estação" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Integração da API com Postgres e Redis

**Files:**
- Create: `apps/api/integracao/ambiente.ts`, `apps/api/integracao/api.test.ts`

**Interfaces:**
- Consumes: `iniciarConfig` (Task 1); `ConexaoPostgres`, `fecharBanco` (Task 2); `criarApp`, `fecharRedis`, `_template` (Task 4); Postgres e Redis do dev (Task 6)
- Produces: `envTeste(papel: tPapel): NodeJS.ProcessEnv` para os testes de integração das próximas fases

- [ ] **Step 1: Ambiente de teste**

`apps/api/integracao/ambiente.ts`:

```ts
import type { tPapel } from "../src/services/config";

// Aponta para o docker-compose.dev.yml; POSTGRES_* e REDIS_URL do shell têm prioridade.
export function envTeste(papel: tPapel): NodeJS.ProcessEnv {
    return {
        PAPEL: papel,
        POSTGRES_HOST: process.env.POSTGRES_HOST ?? "127.0.0.1",
        POSTGRES_PORT: process.env.POSTGRES_PORT ?? "5433",
        POSTGRES_USER: process.env.POSTGRES_USER ?? "fotos",
        POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD ?? "fotos",
        POSTGRES_DB: papel === "vps" ? "fotos_vps" : "fotos_estacao",
        REDIS_URL: process.env.REDIS_URL ?? "redis://127.0.0.1:6380",
        REDIS_PREFIXO: `fotos:teste:${papel}:`,
        ESTACAO_CHAVE: "c".repeat(32),
        VPS_URL: "http://127.0.0.1:9",
        ARQUIVO_SEGREDO: "segredo-de-teste",
    };
}
```

- [ ] **Step 2: Escrever o teste**

`apps/api/integracao/api.test.ts`:

```ts
import { test, describe, before, after } from "node:test";
import assert from "node:assert";
import { Router } from "express";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import { iniciarConfig } from "../src/services/config";
import { criarApp } from "../src/services/servidor";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { fecharRedis } from "../src/services/redis";
import routeTemplate from "../src/_template/route._template";
import { envTeste } from "./ambiente";

const TABELA = `teste_conexao_${process.pid}`;

let servidor: Server;
let base: string;

before(async () => {
    iniciarConfig(envTeste("vps"));
    const area = Router();
    area.post("/template", routeTemplate);
    servidor = criarApp([{ caminho: "teste", router: area }]).listen(0);
    await new Promise((resolve) => servidor.once("listening", resolve));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

after(async () => {
    servidor.close();
    await fecharBanco();
    await fecharRedis();
});

async function chamarTemplate(corpo: object) {
    const resposta = await fetch(`${base}/api/teste/template`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
    });
    return { status: resposta.status, corpo: await resposta.json() };
}

describe("GET /test", () => {
    test("responde 200 com banco e Redis de pé", async () => {
        const resposta = await fetch(`${base}/test`);
        const corpo = await resposta.json();

        assert.strictEqual(resposta.status, 200);
        assert.deepStrictEqual(corpo, { ok: true, papel: "vps", versao: "0.1.0", banco: true, redis: true });
    });
});

describe("módulo modelo pelo per", () => {
    test("getAgora consulta o banco", async () => {
        const r = await chamarTemplate({ call: "getAgora" });

        assert.strictEqual(r.status, 200);
        assert.ok(!Number.isNaN(Date.parse(r.corpo.agora)));
    });

    test("ecoar sem texto devolve erro de negócio", async () => {
        assert.deepStrictEqual((await chamarTemplate({ call: "ecoar" })).corpo, {
            msg: "texto é obrigatório",
            error: true,
        });
    });

    test("ecoar passa pela ctrl", async () => {
        assert.deepStrictEqual((await chamarTemplate({ call: "ecoar", texto: "olá" })).corpo, { texto: "OLÁ" });
    });
});

describe("ConexaoPostgres com transação", () => {
    before(async () => {
        const c = new ConexaoPostgres();
        await c.open();
        await c.queryParam(`CREATE TABLE IF NOT EXISTS ${TABELA} (x int)`, []);
        await c.close();
    });

    after(async () => {
        const c = new ConexaoPostgres();
        await c.open();
        await c.queryParam(`DROP TABLE IF EXISTS ${TABELA}`, []);
        await c.close();
    });

    async function contar(): Promise<number> {
        const c = new ConexaoPostgres();
        await c.open();
        const linha = await c.queryOneParam<{ n: number }>(`SELECT count(*)::int AS n FROM ${TABELA}`, []);
        await c.close();
        return linha?.n ?? -1;
    }

    test("close sem erro faz commit", async () => {
        const c = new ConexaoPostgres();
        await c.openTransaction();
        assert.strictEqual(await c.executeParamCount(`INSERT INTO ${TABELA} VALUES (?)`, [1]), 1);
        await c.close();

        assert.strictEqual(await contar(), 1);
    });

    test("close depois de erro faz rollback", async () => {
        const c = new ConexaoPostgres();
        await c.openTransaction();
        await c.executeParamCount(`INSERT INTO ${TABELA} VALUES (?)`, [2]);
        await assert.rejects(c.queryParam("SELECT * FROM tabela_que_nao_existe", []));
        await c.close();

        assert.strictEqual(await contar(), 1);
    });

    test("queryOneParam sem linha devolve undefined", async () => {
        const c = new ConexaoPostgres();
        await c.open();
        assert.strictEqual(await c.queryOneParam(`SELECT x FROM ${TABELA} WHERE x = ?`, [999]), undefined);
        await c.close();
    });
});
```

- [ ] **Step 3: Rodar**

Run: `npm run test:integracao -w apps/api`
Expected: 7 testes PASS. O teste "rollback" imprime o `console.error` do `[Postgres]`, é esperado. Se `versao` não bater, confira `version` em `apps/api/package.json` (deve ser `0.1.0`).

- [ ] **Step 4: Rodar a API de verdade**

Run (em um terminal): `npm run dev -w apps/api`
Em outro: `curl -s localhost:3002/test`
Expected: `{"ok":true,"papel":"vps","versao":"0.1.0","banco":true,"redis":true}`. Pare com Ctrl+C e confira que aparece `[Api] Encerrando...`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/integracao
git commit -m "test(api): integração do per, ConexaoPostgres e /test" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Imagens Docker, composes da estação e da VPS, `.env.*.example` e documentação

**Files:**
- Create: `.dockerignore`, `apps/api/Dockerfile`, `db/Dockerfile`
- Modify: `docker-compose.dev.yml` — acrescenta `migrate-estacao`, `migrate-vps`, `api-estacao`, `api-vps`
- Create: `docker-compose.estacao.yml`, `docker-compose.vps.yml`, `.env.estacao.example`, `.env.vps.example`
- Create: `infra/traefik/vps-dinamico.yml`, `infra/certs/.gitkeep`
- Create: `README.md`, `docs/desenvolvimento.md`

**Interfaces:**
- Consumes: scripts `build`/`start` da API (Task 1), `db/migrate.ts` (Task 5), `GET /test` (Task 4)
- Produces: imagens `api` (porta 3000, healthcheck em `/test`) e `migrate` (roda `up` e sai). Nas próximas fases, cada workspace novo precisa ter o `package.json` copiado nos dois Dockerfiles, porque o `npm ci` confere o lockfile inteiro.

- [ ] **Step 1: Imagens**

`.dockerignore`:

```
**/node_modules
**/dist
.git
docs
infra/certs
.env
.env.*
**/.env
```

`apps/api/Dockerfile` (contexto = raiz do repositório):

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY db/package.json db/
RUN npm ci -w apps/api

FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/api apps/api
RUN npm run build -w apps/api

FROM node:22-bookworm-slim AS deps-producao
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY db/package.json db/
# O npm pode não criar a pasta local quando tudo sobe para a raiz; o COPY abaixo precisa dela.
RUN npm ci -w apps/api --omit=dev && mkdir -p apps/api/node_modules

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps-producao /app/node_modules ./node_modules
COPY --from=deps-producao /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/package.json ./apps/api/
WORKDIR /app/apps/api
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/test').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/index.js"]
```

`db/Dockerfile` (contexto = raiz do repositório):

```dockerfile
# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY db/package.json db/
RUN npm ci -w db --omit=dev
COPY tsconfig.base.json ./
COPY db db
WORKDIR /app/db
USER node
CMD ["node", "--import", "tsx", "migrate.ts", "up"]
```

Run:

```bash
docker build -f apps/api/Dockerfile -t fotos-api:dev .
docker build -f db/Dockerfile -t fotos-migrate:dev .
docker run --rm -e PAPEL=vps fotos-api:dev; echo "saida=$?"
```

Expected: as duas imagens constroem; o `docker run` imprime `[Config] Variáveis obrigatórias faltando para o papel vps: ...` e `saida=1`.

- [ ] **Step 2: Compose de desenvolvimento completo**

Em `docker-compose.dev.yml`, acrescente estes serviços dentro de `services:` (depois de `redis`) e troque o comentário do topo:

```yaml
# Desenvolvimento: os dois papéis na mesma máquina.
# Só a infraestrutura:  docker compose -f docker-compose.dev.yml up -d postgres redis
# Tudo:                 docker compose -f docker-compose.dev.yml up -d --build
```

```yaml
  migrate-estacao:
    build: { context: ., dockerfile: db/Dockerfile }
    environment: &banco-dev
      POSTGRES_HOST: postgres
      POSTGRES_USER: fotos
      POSTGRES_PASSWORD: fotos
      PAPEL: estacao
      POSTGRES_DB: fotos_estacao
    depends_on:
      postgres: { condition: service_healthy }

  migrate-vps:
    build: { context: ., dockerfile: db/Dockerfile }
    environment:
      <<: *banco-dev
      PAPEL: vps
      POSTGRES_DB: fotos_vps
    depends_on:
      postgres: { condition: service_healthy }

  api-estacao:
    build: { context: ., dockerfile: apps/api/Dockerfile }
    environment:
      <<: *banco-dev
      REDIS_URL: redis://redis:6379
      REDIS_PREFIXO: "fotos:estacao:"
      ESTACAO_CHAVE: dev-somente-local-dev-somente-local
      VPS_URL: http://api-vps:3000
    ports:
      - "127.0.0.1:3001:3000"
    depends_on:
      migrate-estacao: { condition: service_completed_successfully }
      redis: { condition: service_healthy }

  api-vps:
    build: { context: ., dockerfile: apps/api/Dockerfile }
    environment:
      <<: *banco-dev
      PAPEL: vps
      POSTGRES_DB: fotos_vps
      REDIS_URL: redis://redis:6379
      REDIS_PREFIXO: "fotos:vps:"
      ESTACAO_CHAVE: dev-somente-local-dev-somente-local
      ARQUIVO_SEGREDO: dev-somente-local
    ports:
      - "127.0.0.1:3002:3000"
    depends_on:
      migrate-vps: { condition: service_completed_successfully }
      redis: { condition: service_healthy }
```

Pare o `npm run dev` da Task 8 se ainda estiver rodando (porta 3002). Depois:

Run:

```bash
docker compose -f docker-compose.dev.yml up -d --build
docker compose -f docker-compose.dev.yml ps -a
curl -s localhost:3001/test; echo
curl -s localhost:3002/test; echo
curl -s -X POST localhost:3002/api/fotografo/upload -H 'Content-Type: application/json' -d '{}'; echo
```

Expected: `migrate-*` com `Exited (0)`; `api-*` `healthy`; `/test` devolve `"papel":"estacao"` na 3001 e `"papel":"vps"` na 3002, os dois com `"ok":true`; a última chamada devolve `{"msg":"Rota não encontrada"}` (a VPS não monta a área do fotógrafo).

- [ ] **Step 3: Compose da estação**

`.env.estacao.example`:

```
PAPEL=estacao
PORTA=3000
# Porta HTTP em que os fotógrafos acessam a estação pela rede local.
PORTA_LAN=80

POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_USER=fotos
POSTGRES_PASSWORD=troque-esta-senha
POSTGRES_DB=fotos_estacao

REDIS_URL=redis://redis:6379
REDIS_PREFIXO=fotos:estacao:

# Segredo compartilhado com a VPS, igual nos dois .env. Gere com: openssl rand -hex 32
ESTACAO_CHAVE=
VPS_URL=https://admin.exemplo.com.br
```

`docker-compose.estacao.yml`:

```yaml
# Estação no local do evento.
# Uso: docker compose --env-file .env.estacao -f docker-compose.estacao.yml up -d --build
name: fotos-estacao

services:
  traefik:
    image: traefik:v3.6
    command:
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --entrypoints.lan.address=:80
    ports:
      - "${PORTA_LAN:-80}:80"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    restart: unless-stopped

  postgres:
    image: pgvector/pgvector:0.8.1-pg16
    env_file: .env.estacao
    volumes:
      - pg-estacao:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"]
      interval: 5s
      retries: 10
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - redis-estacao:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      retries: 10
    restart: unless-stopped

  migrate:
    build: { context: ., dockerfile: db/Dockerfile }
    env_file: .env.estacao
    depends_on:
      postgres: { condition: service_healthy }

  api:
    build: { context: ., dockerfile: apps/api/Dockerfile }
    env_file: .env.estacao
    depends_on:
      migrate: { condition: service_completed_successfully }
      redis: { condition: service_healthy }
    labels:
      - traefik.enable=true
      - traefik.http.routers.api.rule=PathPrefix(`/api`) || Path(`/test`)
      - traefik.http.routers.api.entrypoints=lan
      - traefik.http.services.api.loadbalancer.server.port=3000
    restart: unless-stopped

volumes:
  pg-estacao:
  redis-estacao:
```

Run:

```bash
cp .env.estacao.example .env.estacao
sed -i "s/^ESTACAO_CHAVE=.*/ESTACAO_CHAVE=$(openssl rand -hex 32)/; s/^PORTA_LAN=.*/PORTA_LAN=8080/" .env.estacao
docker compose --env-file .env.estacao -f docker-compose.estacao.yml up -d --build
docker compose --env-file .env.estacao -f docker-compose.estacao.yml ps -a
curl -s localhost:8080/test; echo
docker compose --env-file .env.estacao -f docker-compose.estacao.yml down -v
```

Expected: `migrate` com `Exited (0)`, `api` `healthy`, `curl` devolve `{"ok":true,"papel":"estacao",...}` passando pelo Traefik.

- [ ] **Step 4: Compose da VPS**

`.env.vps.example`:

```
PAPEL=vps
PORTA=3000

# Hosts atendidos pelo Traefik (proxy da Cloudflare na frente, SSL "Full (strict)").
DOMINIO_PARTICIPANTE=fotos.exemplo.com.br
DOMINIO_ADMIN=admin.fotos.exemplo.com.br
PORTA_HTTP=80
PORTA_HTTPS=443

POSTGRES_HOST=postgres
POSTGRES_PORT=5432
POSTGRES_USER=fotos
POSTGRES_PASSWORD=troque-esta-senha
POSTGRES_DB=fotos_vps

REDIS_URL=redis://redis:6379
REDIS_PREFIXO=fotos:vps:

# Segredo compartilhado com a estação, igual nos dois .env. Gere com: openssl rand -hex 32
ESTACAO_CHAVE=
# Assinatura dos links de arquivo (nginx secure_link). Gere com: openssl rand -hex 32
ARQUIVO_SEGREDO=
```

`infra/traefik/vps-dinamico.yml`:

```yaml
# Certificado de origem da Cloudflare, gravado em infra/certs (fora do git).
tls:
  stores:
    default:
      defaultCertificate:
        certFile: /certs/origem.pem
        keyFile: /certs/origem.key
```

Crie `infra/certs/.gitkeep` vazio.

`docker-compose.vps.yml`:

```yaml
# VPS sempre ligada.
# Uso: docker compose --env-file .env.vps -f docker-compose.vps.yml up -d --build
# Requer infra/certs/origem.pem e origem.key (certificado de origem da Cloudflare).
name: fotos-vps

services:
  traefik:
    image: traefik:v3.6
    command:
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --providers.file.filename=/etc/traefik/dinamico.yml
      - --entrypoints.web.address=:80
      - --entrypoints.web.http.redirections.entrypoint.to=websecure
      - --entrypoints.web.http.redirections.entrypoint.scheme=https
      - --entrypoints.websecure.address=:443
    ports:
      - "${PORTA_HTTP:-80}:80"
      - "${PORTA_HTTPS:-443}:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - ./infra/traefik/vps-dinamico.yml:/etc/traefik/dinamico.yml:ro
      - ./infra/certs:/certs:ro
    restart: unless-stopped

  postgres:
    image: pgvector/pgvector:0.8.1-pg16
    env_file: .env.vps
    volumes:
      - pg-vps:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"]
      interval: 5s
      retries: 10
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - redis-vps:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      retries: 10
    restart: unless-stopped

  migrate:
    build: { context: ., dockerfile: db/Dockerfile }
    env_file: .env.vps
    depends_on:
      postgres: { condition: service_healthy }

  api:
    build: { context: ., dockerfile: apps/api/Dockerfile }
    env_file: .env.vps
    depends_on:
      migrate: { condition: service_completed_successfully }
      redis: { condition: service_healthy }
    labels:
      - traefik.enable=true
      - traefik.http.routers.api.rule=(Host(`${DOMINIO_PARTICIPANTE}`) || Host(`${DOMINIO_ADMIN}`)) && (PathPrefix(`/api`) || Path(`/test`))
      - traefik.http.routers.api.entrypoints=websecure
      - traefik.http.routers.api.tls=true
      - traefik.http.services.api.loadbalancer.server.port=3000
    restart: unless-stopped

volumes:
  pg-vps:
  redis-vps:
```

Teste local com certificado autoassinado (no servidor real entra o certificado de origem da Cloudflare):

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj "/CN=localhost" \
    -keyout infra/certs/origem.key -out infra/certs/origem.pem
cp .env.vps.example .env.vps
sed -i "s/^ESTACAO_CHAVE=.*/ESTACAO_CHAVE=$(openssl rand -hex 32)/; \
        s/^ARQUIVO_SEGREDO=.*/ARQUIVO_SEGREDO=$(openssl rand -hex 32)/; \
        s/^DOMINIO_PARTICIPANTE=.*/DOMINIO_PARTICIPANTE=participante.localhost/; \
        s/^DOMINIO_ADMIN=.*/DOMINIO_ADMIN=admin.localhost/; \
        s/^PORTA_HTTP=.*/PORTA_HTTP=8081/; s/^PORTA_HTTPS=.*/PORTA_HTTPS=8443/" .env.vps
docker compose --env-file .env.vps -f docker-compose.vps.yml up -d --build
curl -sk --resolve participante.localhost:8443:127.0.0.1 https://participante.localhost:8443/test; echo
curl -sk --resolve admin.localhost:8443:127.0.0.1 https://admin.localhost:8443/test; echo
curl -sk --resolve outro.localhost:8443:127.0.0.1 -o /dev/null -w '%{http_code}\n' https://outro.localhost:8443/test
curl -s -o /dev/null -w '%{http_code}\n' --resolve admin.localhost:8081:127.0.0.1 http://admin.localhost:8081/test
docker compose --env-file .env.vps -f docker-compose.vps.yml down -v
rm infra/certs/origem.key infra/certs/origem.pem .env.vps .env.estacao
```

Expected: os dois primeiros `curl` devolvem `{"ok":true,"papel":"vps",...}`; host desconhecido devolve `404` (do Traefik); HTTP devolve `301` ou `308` (redirecionamento para HTTPS).

- [ ] **Step 5: Documentação**

`README.md`:

```markdown
# Plataforma de entrega de fotos por reconhecimento facial

O participante envia uma selfie e recebe as fotos do evento em que aparece.

- Design: [docs/superpowers/specs/2026-09-18-plataforma-fotos-design.md](docs/superpowers/specs/2026-09-18-plataforma-fotos-design.md)
- Como rodar e testar: [docs/desenvolvimento.md](docs/desenvolvimento.md)
```

`docs/desenvolvimento.md`:

````markdown
# Desenvolvimento

## Pré-requisitos

- Node 22 (`nvm use`, lê o `.nvmrc`)
- Docker com Compose

## Primeiro uso

```bash
npm install
docker compose -f docker-compose.dev.yml up -d postgres redis
cp apps/api/.env.example apps/api/.env
npm run migrate:dev
npm run dev -w apps/api          # papel vps na porta 3002
```

O Postgres de dev tem dois bancos, `fotos_estacao` e `fotos_vps`, em `127.0.0.1:5433`. O Redis fica em `127.0.0.1:6380`. Para rodar a API como estação, troque `PAPEL`, `POSTGRES_DB` e `PORTA` no `apps/api/.env`.

## Testes

```bash
npm test                 # funções puras, sem banco
npm run test:integracao  # precisa do Postgres e do Redis de dev de pé
npm run typecheck
```

## Migrations

```bash
npm run migrate -- create adiciona_coluna_x --target=vps   # estacao | vps | ambos
PAPEL=vps POSTGRES_DB=fotos_vps npm run migrate -- up
PAPEL=vps POSTGRES_DB=fotos_vps npm run migrate -- status
PAPEL=vps POSTGRES_DB=fotos_vps npm run migrate -- down   # desfaz só a última
```

Cada banco guarda o seu papel em `schema_papel` e recusa migrations do outro papel. Nunca edite uma migration já aplicada: crie outra.

## Módulo novo na API

Copie `apps/api/src/_template/` para `apps/api/src/_<AREA>/<modulo>/`, renomeie os arquivos e registre em `apps/api/src/routes/<area>Route.ts`:

```ts
router.post("/<modulo>", routeModulo);
```

A chamada fica `POST /api/<area>/<modulo>` com `{ "call": "<metodo>", ... }`.

## Composes

| Arquivo | Uso |
|---|---|
| `docker-compose.dev.yml` | Tudo numa máquina: Postgres com os dois bancos, Redis, migrations e as duas APIs (3001 estação, 3002 VPS). |
| `docker-compose.estacao.yml` | Estação no evento. `docker compose --env-file .env.estacao -f docker-compose.estacao.yml up -d --build` |
| `docker-compose.vps.yml` | VPS. `docker compose --env-file .env.vps -f docker-compose.vps.yml up -d --build`. Precisa de `infra/certs/origem.pem` e `origem.key`. |

O `--env-file` é obrigatório nos composes da estação e da VPS: é dele que saem `PORTA_LAN`, os domínios e as portas usados nas regras do Traefik.

A API encerra na inicialização se faltar alguma variável obrigatória do papel e mostra a lista do que falta.
````

- [ ] **Step 6: Verificação final**

Run:

```bash
npm run typecheck
npm test
npm run test:integracao
git status --short
```

Expected: typecheck sem erros; todos os testes PASS; `git status` não mostra `.env`, `.env.estacao`, `.env.vps` nem certificados.

- [ ] **Step 7: Commit**

```bash
git add .dockerignore apps/api/Dockerfile db/Dockerfile docker-compose.dev.yml docker-compose.estacao.yml \
    docker-compose.vps.yml .env.estacao.example .env.vps.example infra/traefik infra/certs/.gitkeep \
    README.md docs/desenvolvimento.md
git commit -m "feat(infra): imagens e composes de dev, estação e VPS" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Cobertura do spec (fase 1, seção 13)

| Item do spec | Task |
|---|---|
| Monorepo npm workspaces | 1, 5 |
| API nos dois papéis: `per`, `ConexaoPostgres`, `config`, `ErroTratado`, `/test` | 1, 2, 3, 4, 8 |
| Falha na inicialização sem variável obrigatória | 1, 4, 9 |
| Áreas por papel (`_FOTOGRAFO`, `_PAINEL` / `_PARTICIPANTE`, `_ANFITRIAO`, `_ADMIN`, `_ESTACAO`) | 4 |
| Multipart com `call` no formulário | 3 |
| Runner de migrations com `target`, `schema_migrations`, `up`/`down` | 5, 6 |
| Migrations das seções 5.1 e 5.2, índices do spec, pgvector ≥ 0.8 | 7 |
| Composes dev (um Postgres com dois bancos, Redis com prefixos), estação e VPS | 6, 9 |
| `.env.*.example` | 6, 9 |
| Traefik próprio em cada compose; certificado de origem na VPS | 9 |
