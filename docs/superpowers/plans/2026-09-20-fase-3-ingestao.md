# Fase 3 — Ingestão ponta a ponta sem frontend: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pipeline completo, sem nenhum frontend: CLI `ingerir` → worker `processar-foto` (hash → original → rostos via vision → derivados com marca d'água) → worker `publicar-foto` (envia para a VPS) → `_ESTACAO` na VPS (sincronização, publicação, sinal) → `_ADMIN` de login, evento e fotógrafo (só API, testado por `.http`) → CLI `criar-operador` → métricas → `scripts/benchmark-pipeline.ts`.

**Architecture:** Dois papéis Express já existem (`estacao`, `vps`), com `per()` despachando por `{ call }` e módulos `route/ctrl/sql` por pasta (fase 1). Esta fase preenche as áreas `_ADMIN` e `_ESTACAO` (VPS) e acrescenta um processo `worker` novo (BullMQ + Redis, já provisionados na fase 1) que roda três filas na estação: `processar-foto`, `publicar-foto` e `sincronizar`. A autenticação do operador é um token assinado (HMAC, sem dependência nova); a autenticação estação→VPS reusa o `ESTACAO_CHAVE` da fase 1. Nenhuma migration nova: o schema da fase 1 já cobre as fases 3 e 4.

**Tech Stack:** Node 22, TypeScript strict, Express 5 (já em uso), BullMQ + ioredis (novo), sharp (novo, derivados e marca d'água), exifr (novo, EXIF puro em JS), `node:crypto` (scrypt e HMAC, sem dependência nova), `fetch`/`FormData`/`Blob` nativos do Node 22 (chamadas HTTP entre estação e VPS, e para o vision).

**Spec:** [docs/superpowers/specs/2026-09-18-plataforma-fotos-design.md](../specs/2026-09-18-plataforma-fotos-design.md) — seções 3, 4, 5, 7 inteiras (o pipeline), 12 (testes) e 13 item 3 (o escopo exato desta fase). Leia o spec junto com este plano.

## Global Constraints

- Node 22, TypeScript `strict`, CommonJS, Express 5, imports relativos (sem alias). Um módulo por pasta: `route.<m>.ts` (Router fino, só dispatch), `ctrl.<m>.ts` (regra de negócio), `sql.<m>.ts` (só SQL), `i.<m>.ts` (interfaces, só quando a `ctrl` manipula o dado antes de devolver), `<m>.http` (exemplos REST Client).
- Áreas por cliente (seção 4): estação não ganha rotas HTTP nesta fase (sem `_FOTOGRAFO`/`_PAINEL` ainda — fase 5); VPS usa `_ADMIN` e `_ESTACAO`, já montadas em `adminRoute.ts`/`estacaoRoute.ts` (hoje vazias).
- RPC: `POST /api/<area>/<modulo>` com `{ call, ... }` despachado por `per()` (já existe, `apps/api/src/services/per.ts`). Multipart usa `express-fileupload`, com `call` como campo do formulário — continua RPC, sem rota nova.
- Banco: `ConexaoPostgres` (`open`, `openTransaction`, `queryParam`, `queryOneParam`, `executeParamCount`, `commit`, `rollback`, `close`, `marcarErro`) — já existe, sem tenant, um banco por papel. Placeholders `?`.
- Erros: regra de negócio devolvida como `{ msg, error: true }` pela Router (sem `throw`, só para presença de campo obrigatório); `ErroTratado` para erro exibível (`per()` responde 422); qualquer outro erro vira 500. Mensagens em português.
- Log: `console.log`/`console.error` com prefixo `[Componente]`, em português. Nunca logar `senha`, `senha_hash`, token, embedding ou o `detail` de erro do pg.
- Testes: `node:test` + `node:assert` via `tsx --test`, ao lado do código (`<nome>.test.ts`), sem Postgres nem Redis reais. Testes com banco e/ou fila reais ficam em `apps/api/integracao/` (precisam de `docker compose -f docker-compose.dev.yml up -d postgres redis` rodando).
- Comentários só para o porquê não óbvio.
- Todo commit termina com a linha `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Schema: nenhuma migration nova nesta fase — as tabelas de `db/migrations/*.sql` já cobrem tudo (fase 1). Não altere migrations existentes.
- Nomes de coluna/tabela exatamente como em `db/migrations/20260918120100_cadastros.sql`, `20260918120400_vps_admin.sql`, `20260918120500_estacao.sql` — leia-os antes de escrever SQL.

### Defaults que o spec não fixa (decididos aqui)

- **Token do operador:** HMAC-SHA256 sem dependência nova (`node:crypto`), formato `<payload_base64url>.<assinatura_hex>`, validade 12h (`43200` s), renovado a cada login. Segredo em `OPERADOR_SEGREDO` (novo, obrigatório só no papel `vps`, mínimo 32 caracteres — mesma regra do `ESTACAO_CHAVE`).
- **`publicar-foto`, tentativas "ilimitadas":** `attempts: 1000` com backoff exponencial com teto de 5 min (`backoffComTeto`, estratégia customizada do BullMQ — `1000 * 2^tentativas`, limitado a `300_000` ms). Se a versão instalada do BullMQ não aceitar `backoff: { type: 'custom' }` do jeito descrito na Task 9, ajuste e registre no relatório (mesma regra da fase 2 para desvios de biblioteca).
- **`sincronizar`:** fila BullMQ própria, `attempts: 3`, backoff exponencial padrão (`delay: 2000`) — uma falha de sincronização não é crítica, a próxima rodada (60s depois) corrige.
- **`sinal`:** não é fila — `setInterval` de 30s no processo `worker`, tolerante a falha (só loga, nunca derruba o processo).
- **Fuso horário do evento:** fixo em `America/Sao_Paulo` (constante, não configurável nesta fase — a tabela de chaves de `evento.config` da seção 5 não lista fuso).
- **Chaves aleatórias** (`chave_acesso`, `chave_anfitriao`, `token_upload`): 20 bytes de `crypto.randomBytes`, hex (40 caracteres, cabe exatamente nas colunas `varchar(40)`).
- **Timeout do `vision /detect`:** 30s por chamada `fetch` (o micro-lote do vision já limita o tempo por foto; 30s cobre o pior caso sem travar o job indefinidamente se o vision cair).

## Fora desta fase

Upload resumível pelo navegador e painel da estação (`_FOTOGRAFO`, `_PAINEL`) são fase 5. Busca, verificação por WhatsApp, calibração do limiar, patrocinadores e moderação de foto (`_PARTICIPANTE`, `_ANFITRIAO`, resto do `_ADMIN`) são fase 4. Qualquer frontend web é fase 5 em diante. Worker da VPS (`whatsapp`, `zip`, `expurgo`, `manutencao`) é fase 4. `_PAINEL/evento.encerrarEvento` (seção 7) fica para a fase 5, junto do painel da estação.

## Mapa de arquivos

```
apps/api/src/
├── services/
│   ├── senha.ts              # scrypt: gerarHashSenha, conferirSenha
│   ├── token.ts               # HMAC: gerarToken, conferirToken
│   ├── auth.ts                 # autorizarOperador(contexto) -> id_operador
│   ├── authEstacao.ts           # autorizarEstacao(contexto) -> void
│   ├── aleatorio.ts              # gerarChave(bytes?) -> hex
│   ├── fila.ts                    # BullMQ: criarFila, criarWorker, backoffComTeto, fecharFila
│   ├── caminhos.ts                 # caminhoOriginal, caminhoPublicar, caminhoMarcaDagua
│   ├── hashArquivo.ts               # calcularHashArquivo (SHA-256 em stream)
│   ├── exifFoto.ts                   # lerExif, combinarDataExif (puras, exifr por trás)
│   ├── metricas.ts                    # percentil (pura) + gatherers com banco/fila
│   ├── vpsHttp.ts                      # chamarVps, chamarVpsMultipart (estação -> VPS, com ESTACAO_CHAVE)
│   ├── config.ts                        # MODIFICAR: OPERADOR_SEGREDO, VISION_URL, RAIZ_*
│   └── vision.ts                         # detectarRostos(caminhos) -> chama o vision /detect
├── _ADMIN/
│   ├── login/           route.login.ts ctrl.login.ts sql.login.ts login.http
│   ├── evento/           route.evento.ts ctrl.evento.ts sql.evento.ts i.evento.ts evento.http
│   └── fotografo/         route.fotografo.ts ctrl.fotografo.ts sql.fotografo.ts fotografo.http
├── _ESTACAO/
│   ├── sincronizacao/   route.sincronizacao.ts ctrl.sincronizacao.ts sql.sincronizacao.ts i.sincronizacao.ts sincronizacao.http
│   ├── sinal/            route.sinal.ts ctrl.sinal.ts sql.sinal.ts sinal.http
│   └── foto/              route.foto.ts ctrl.foto.ts sql.foto.ts i.foto.ts foto.http
├── jobs/
│   ├── sincronizar.ts    # job + agendamento
│   ├── processarFoto.ts   # job (o pipeline)
│   └── publicarFoto.ts     # job
├── scripts/
│   ├── criarOperador.ts
│   └── ingerir.ts
├── routes/adminRoute.ts     # MODIFICAR: monta os 3 módulos
├── routes/estacaoRoute.ts   # MODIFICAR: monta os 3 módulos
└── worker.ts                # entrada do processo worker
scripts/benchmark-pipeline.ts
docker-compose.dev.yml / .estacao.yml / .vps.yml   # MODIFICAR: serviço worker, volumes
.env.estacao.example / .env.vps.example              # MODIFICAR
```

---

### Task 1: Autenticação do operador (senha, token) e chave da estação

**Files:**
- Create: `apps/api/src/services/senha.ts`, `apps/api/src/services/token.ts`, `apps/api/src/services/auth.ts`, `apps/api/src/services/authEstacao.ts`, `apps/api/src/services/aleatorio.ts`
- Test: `apps/api/src/services/senha.test.ts`, `apps/api/src/services/token.test.ts`, `apps/api/src/services/auth.test.ts`, `apps/api/src/services/authEstacao.test.ts`, `apps/api/src/services/aleatorio.test.ts`
- Modify: `apps/api/src/services/config.ts` (acrescenta `OPERADOR_SEGREDO`), `.env.vps.example`

**Interfaces:**
- Consumes: `iContexto` (`apps/api/src/services/per.ts`), `config` (`apps/api/src/services/config.ts`), `ErroTratado` (`apps/api/src/services/erro.ts`)
- Produces:
  - `gerarHashSenha(senha: string): Promise<string>`, `conferirSenha(senha: string, hash: string): Promise<boolean>`
  - `gerarToken(idOperador: number, segredo: string, validadeS?: number): string`, `conferirToken(token: string, segredo: string): number | null`
  - `autorizarOperador(contexto: iContexto): Promise<number>` — lê `contexto.authorization`, lança `ErroTratado` se ausente/inválido/expirado
  - `autorizarEstacao(contexto: iContexto): void` — lança `ErroTratado` se `contexto.authorization` não bater com `config.estacaoChave`
  - `gerarChave(bytes?: number): string` — hex, default 20 bytes (40 caracteres)
  - `config.operadorSegredo: string` (novo campo de `iConfig`)

- [ ] **Step 1: Escrever os testes**

`apps/api/src/services/senha.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert";
import { conferirSenha, gerarHashSenha } from "./senha";

test("gera hashes diferentes para a mesma senha (salt aleatório)", async () => {
    const a = await gerarHashSenha("segredo123");
    const b = await gerarHashSenha("segredo123");
    assert.notStrictEqual(a, b);
});

test("confere a senha certa e recusa a errada", async () => {
    const hash = await gerarHashSenha("segredo123");
    assert.strictEqual(await conferirSenha("segredo123", hash), true);
    assert.strictEqual(await conferirSenha("outra-senha", hash), false);
});

test("recusa hash em formato inválido sem lançar", async () => {
    assert.strictEqual(await conferirSenha("segredo123", "formato-invalido"), false);
});
```

`apps/api/src/services/token.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert";
import { conferirToken, gerarToken } from "./token";

const SEGREDO = "segredo-de-teste-com-pelo-menos-32-caracteres";

test("gera e confere um token válido", () => {
    const token = gerarToken(42, SEGREDO);
    assert.strictEqual(conferirToken(token, SEGREDO), 42);
});

test("recusa token assinado com outro segredo", () => {
    const token = gerarToken(42, SEGREDO);
    assert.strictEqual(conferirToken(token, "outro-segredo-com-32-caracteres-tambem"), null);
});

test("recusa token expirado", () => {
    const token = gerarToken(42, SEGREDO, -1);
    assert.strictEqual(conferirToken(token, SEGREDO), null);
});

test("recusa token malformado", () => {
    assert.strictEqual(conferirToken("qualquer-coisa", SEGREDO), null);
    assert.strictEqual(conferirToken("", SEGREDO), null);
});

test("recusa payload adulterado mesmo com assinatura de outro token válido", () => {
    const token1 = gerarToken(1, SEGREDO);
    const token2 = gerarToken(2, SEGREDO);
    const [, assinatura2] = token2.split(".");
    const [payload1] = token1.split(".");
    assert.strictEqual(conferirToken(`${payload1}.${assinatura2}`, SEGREDO), null);
});
```

`apps/api/src/services/auth.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert";
import { autorizarOperador } from "./auth";
import { gerarToken } from "./token";
import { config } from "./config";
import { ErroTratado } from "./erro";

test("autoriza com um token válido", async () => {
    config.operadorSegredo = "segredo-de-teste-com-pelo-menos-32-caracteres";
    const token = gerarToken(7, config.operadorSegredo);
    assert.strictEqual(await autorizarOperador({ authorization: token }), 7);
});

test("recusa sem header", async () => {
    config.operadorSegredo = "segredo-de-teste-com-pelo-menos-32-caracteres";
    await assert.rejects(() => autorizarOperador({}), ErroTratado);
});

test("recusa token inválido", async () => {
    config.operadorSegredo = "segredo-de-teste-com-pelo-menos-32-caracteres";
    await assert.rejects(() => autorizarOperador({ authorization: "invalido" }), ErroTratado);
});
```

`apps/api/src/services/authEstacao.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert";
import { autorizarEstacao } from "./authEstacao";
import { config } from "./config";
import { ErroTratado } from "./erro";

test("autoriza quando a chave bate", () => {
    config.estacaoChave = "chave-compartilhada-com-32-caracteres-ou-mais";
    assert.doesNotThrow(() => autorizarEstacao({ authorization: config.estacaoChave }));
});

test("recusa chave errada ou ausente", () => {
    config.estacaoChave = "chave-compartilhada-com-32-caracteres-ou-mais";
    assert.throws(() => autorizarEstacao({ authorization: "chave-errada" }), ErroTratado);
    assert.throws(() => autorizarEstacao({}), ErroTratado);
});
```

`apps/api/src/services/aleatorio.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert";
import { gerarChave } from "./aleatorio";

test("gera hex do tamanho esperado e não repete", () => {
    const a = gerarChave();
    const b = gerarChave();
    assert.match(a, /^[0-9a-f]{40}$/);
    assert.notStrictEqual(a, b);
});

test("aceita outro tamanho de bytes", () => {
    assert.match(gerarChave(8), /^[0-9a-f]{16}$/);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -w apps/api`
Expected: FAIL — `Cannot find module './senha'` (e os demais módulos ainda não existem).

- [ ] **Step 3: Implementar**

`apps/api/src/services/senha.ts`:

```ts
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const TAMANHO_HASH = 64;

export async function gerarHashSenha(senha: string): Promise<string> {
    const salt = randomBytes(16);
    const hash = (await scryptAsync(senha, salt, TAMANHO_HASH)) as Buffer;
    return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function conferirSenha(senha: string, hashArmazenado: string): Promise<boolean> {
    const partes = hashArmazenado.split("$");
    if (partes.length !== 3 || partes[0] !== "scrypt") return false;

    const salt = Buffer.from(partes[1], "hex");
    const esperado = Buffer.from(partes[2], "hex");
    if (esperado.length !== TAMANHO_HASH) return false;

    const calculado = (await scryptAsync(senha, salt, TAMANHO_HASH)) as Buffer;
    return timingSafeEqual(calculado, esperado);
}
```

`apps/api/src/services/token.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

const VALIDADE_PADRAO_S = 43_200; // 12h

function assinar(payload: string, segredo: string): string {
    return createHmac("sha256", segredo).update(payload).digest("hex");
}

export function gerarToken(idOperador: number, segredo: string, validadeS: number = VALIDADE_PADRAO_S): string {
    const payload = Buffer.from(JSON.stringify({ id_operador: idOperador, exp: Date.now() + validadeS * 1000 })).toString(
        "base64url"
    );
    return `${payload}.${assinar(payload, segredo)}`;
}

export function conferirToken(token: string, segredo: string): number | null {
    const [payload, assinatura] = token.split(".");
    if (!payload || !assinatura) return null;

    const esperada = Buffer.from(assinar(payload, segredo));
    const recebida = Buffer.from(assinatura);
    if (esperada.length !== recebida.length || !timingSafeEqual(esperada, recebida)) return null;

    try {
        const dados = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
            id_operador?: number;
            exp?: number;
        };
        if (typeof dados.id_operador !== "number" || typeof dados.exp !== "number") return null;
        if (dados.exp < Date.now()) return null;
        return dados.id_operador;
    } catch {
        return null;
    }
}
```

`apps/api/src/services/auth.ts`:

```ts
import { iContexto } from "./per";
import { conferirToken } from "./token";
import { config } from "./config";
import { ErroTratado } from "./erro";

export async function autorizarOperador(contexto: iContexto): Promise<number> {
    const idOperador = contexto.authorization ? conferirToken(contexto.authorization, config.operadorSegredo) : null;
    if (idOperador === null) throw new ErroTratado("Sessão expirada, faça login novamente.");
    return idOperador;
}
```

`apps/api/src/services/authEstacao.ts`:

```ts
import { timingSafeEqual } from "node:crypto";
import { iContexto } from "./per";
import { config } from "./config";
import { ErroTratado } from "./erro";

export function autorizarEstacao(contexto: iContexto): void {
    const recebida = Buffer.from(contexto.authorization ?? "");
    const esperada = Buffer.from(config.estacaoChave);
    if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada))
        throw new ErroTratado("Chave da estação inválida.");
}
```

`apps/api/src/services/aleatorio.ts`:

```ts
import { randomBytes } from "node:crypto";

export function gerarChave(bytes = 20): string {
    return randomBytes(bytes).toString("hex");
}
```

Em `apps/api/src/services/config.ts`, acrescente ao `iConfig`:

```ts
    operadorSegredo: string;
```

Em `OBRIGATORIAS`, acrescente `"OPERADOR_SEGREDO"` ao array de `vps`:

```ts
    vps: ["ARQUIVO_SEGREDO", "OPERADOR_SEGREDO"],
```

E no retorno de `carregarConfig`, acrescente (com a mesma validação de tamanho mínimo do `ESTACAO_CHAVE`, logo após a checagem existente):

```ts
    const operadorSegredo = env.OPERADOR_SEGREDO ?? "";
    if (papel === "vps" && operadorSegredo.length < 32)
        throw new Error("[Config] OPERADOR_SEGREDO deve ter pelo menos 32 caracteres");
```

E adicione `operadorSegredo,` ao objeto `Config` retornado (junto de `estacaoChave`).

Em `.env.vps.example`, acrescente após `ARQUIVO_SEGREDO`:

```
# Assinatura dos tokens de sessão do operador. Gere com: openssl rand -hex 32
OPERADOR_SEGREDO=
```

`OPERADOR_SEGREDO` entra em `OBRIGATORIAS.vps`, então `apps/api/src/services/config.test.ts` (já existe, da fase 1) precisa de ajustes — sem eles, 5 testes existentes quebram. Aplique exatamente estas mudanças nesse arquivo:

1. No teste `"VPS exige ARQUIVO_SEGREDO"`, troque o regex esperado para incluir a variável nova (a ordem segue `OBRIGATORIAS.vps`):

```ts
    test("VPS exige ARQUIVO_SEGREDO e OPERADOR_SEGREDO", () => {
        assert.throws(
            () => carregarConfig({ ...BASE, PAPEL: "vps" }),
            /faltando para o papel vps: ARQUIVO_SEGREDO, OPERADOR_SEGREDO/
        );
    });
```

2. Nos testes `"recusa ESTACAO_CHAVE curta"`, `"recusa porta que não é inteiro positivo"`, `"aplica os padrões"` e em `iniciarConfig > "preenche o objeto compartilhado"`, acrescente `OPERADOR_SEGREDO: "a".repeat(32)` junto de `ARQUIVO_SEGREDO: "x"` em cada chamada (senão essas quatro passam a falhar por variável obrigatória faltando, antes mesmo de chegar na checagem que cada teste quer exercitar). Exemplo do primeiro:

```ts
    test("recusa ESTACAO_CHAVE curta", () => {
        assert.throws(
            () => carregarConfig({ ...BASE, PAPEL: "vps", ARQUIVO_SEGREDO: "x", OPERADOR_SEGREDO: "a".repeat(32), ESTACAO_CHAVE: "curta" }),
            /ESTACAO_CHAVE deve ter pelo menos 32 caracteres/
        );
    });
```

Aplique o mesmo `OPERADOR_SEGREDO: "a".repeat(32)` nas outras três chamadas. Em `"aplica os padrões"`, acrescente também a asserção `assert.strictEqual(c.operadorSegredo, "a".repeat(32));`.

O teste `"lista todas as variáveis faltando de uma vez"` não muda (o regex não é ancorado no fim, `ARQUIVO_SEGREDO, OPERADOR_SEGREDO` continua batendo). O teste `"lê os valores informados"` (papel `estacao`) também não muda — `OPERADOR_SEGREDO` só é obrigatório no papel `vps`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -w apps/api`
Expected: todos os testes novos e os já existentes PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/senha.ts apps/api/src/services/senha.test.ts \
        apps/api/src/services/token.ts apps/api/src/services/token.test.ts \
        apps/api/src/services/auth.ts apps/api/src/services/auth.test.ts \
        apps/api/src/services/authEstacao.ts apps/api/src/services/authEstacao.test.ts \
        apps/api/src/services/aleatorio.ts apps/api/src/services/aleatorio.test.ts \
        apps/api/src/services/config.ts apps/api/src/services/config.test.ts .env.vps.example
git commit -m "feat(api): autenticação do operador e chave da estação" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: CLI `criar-operador`

**Files:**
- Create: `apps/api/src/scripts/criarOperador.ts`
- Test: `apps/api/integracao/criarOperador.test.ts`
- Modify: `apps/api/package.json` (script `criar-operador`)

**Interfaces:**
- Consumes: `gerarHashSenha` (Task 1), `ConexaoPostgres` (fase 1), `config`/`iniciarConfig` (fase 1)
- Produces: `criarOperador(conexao: ConexaoPostgres, nome: string, login: string, senha: string): Promise<{ id_operador: number; criado: boolean }>` — `criado: false` quando já existe um operador com o mesmo `login` (atualiza nome e senha em vez de duplicar); comando `npm run criar-operador -w apps/api -- --nome "..." --login "..."` (pede a senha interativamente, sem eco no terminal)

Este é o primeiro teste de integração da fase — precisa do Postgres real. Antes de rodar, suba a infraestrutura: `docker compose -f docker-compose.dev.yml up -d postgres redis && npm run migrate:dev`.

- [ ] **Step 1: Escrever o teste**

`apps/api/integracao/criarOperador.test.ts`:

```ts
import { test, before, after } from "node:test";
import assert from "node:assert";
import ConexaoPostgres from "../src/db/conexaoPostgres";
import { iniciarConfig } from "../src/services/config";
import { conferirSenha } from "../src/services/senha";
import { criarOperador } from "../src/scripts/criarOperador";

before(() => {
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
    });
});

let conexao: ConexaoPostgres;

test("cria e depois atualiza o mesmo operador", async () => {
    conexao = new ConexaoPostgres();
    await conexao.open();

    const login = `teste-${Date.now()}`;
    const primeira = await criarOperador(conexao, "Ana", login, "senha-inicial");
    assert.strictEqual(primeira.criado, true);

    const [linha] = await conexao.queryParam<{ senha_hash: string }>("SELECT senha_hash FROM operador WHERE id_operador = ?", [
        primeira.id_operador,
    ]);
    assert.strictEqual(await conferirSenha("senha-inicial", linha.senha_hash), true);

    const segunda = await criarOperador(conexao, "Ana Paula", login, "senha-nova");
    assert.strictEqual(segunda.criado, false);
    assert.strictEqual(segunda.id_operador, primeira.id_operador);

    const [atualizado] = await conexao.queryParam<{ nome: string; senha_hash: string }>(
        "SELECT nome, senha_hash FROM operador WHERE id_operador = ?",
        [primeira.id_operador]
    );
    assert.strictEqual(atualizado.nome, "Ana Paula");
    assert.strictEqual(await conferirSenha("senha-nova", atualizado.senha_hash), true);
});

after(async () => {
    await conexao?.close();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:integracao -w apps/api`
Expected: FAIL — `Cannot find module '../src/scripts/criarOperador'`.

- [ ] **Step 3: Implementar**

`apps/api/src/scripts/criarOperador.ts`:

```ts
import { createInterface } from "node:readline/promises";
import "../loadEnv";
import { iniciarConfig } from "../services/config";
import ConexaoPostgres from "../db/conexaoPostgres";
import { gerarHashSenha } from "../services/senha";

export async function criarOperador(
    conexao: ConexaoPostgres,
    nome: string,
    login: string,
    senha: string
): Promise<{ id_operador: number; criado: boolean }> {
    const senhaHash = await gerarHashSenha(senha);
    const existente = await conexao.queryOneParam<{ id_operador: number }>("SELECT id_operador FROM operador WHERE login = ?", [
        login,
    ]);

    if (existente) {
        await conexao.executeParamCount("UPDATE operador SET nome = ?, senha_hash = ?, deletado = 'N' WHERE id_operador = ?", [
            nome,
            senhaHash,
            existente.id_operador,
        ]);
        return { id_operador: existente.id_operador, criado: false };
    }

    const [linha] = await conexao.queryParam<{ id_operador: number }>(
        "INSERT INTO operador (nome, login, senha_hash) VALUES (?, ?, ?) RETURNING id_operador",
        [nome, login, senhaHash]
    );
    return { id_operador: linha.id_operador, criado: true };
}

function argumento(nome: string): string | undefined {
    const idx = process.argv.indexOf(`--${nome}`);
    return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main(): Promise<void> {
    const nome = argumento("nome");
    const login = argumento("login");
    if (!nome || !login) {
        console.error("[CriarOperador] Uso: npm run criar-operador -w apps/api -- --nome \"Ana\" --login ana");
        process.exit(1);
    }

    iniciarConfig(process.env);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const senha = await rl.question("Senha: ");
    rl.close();
    if (senha.length < 8) {
        console.error("[CriarOperador] A senha deve ter pelo menos 8 caracteres.");
        process.exit(1);
    }

    const conexao = new ConexaoPostgres();
    await conexao.open();
    try {
        const resultado = await criarOperador(conexao, nome, login, senha);
        console.log(`[CriarOperador] Operador ${resultado.criado ? "criado" : "atualizado"}: id_operador=${resultado.id_operador}`);
    } finally {
        await conexao.close();
    }
}

if (require.main === module) {
    main().catch((erro) => {
        console.error("[CriarOperador] Falhou:", erro instanceof Error ? erro.message : erro);
        process.exit(1);
    });
}
```

Em `apps/api/package.json`, acrescente em `scripts`:

```json
        "criar-operador": "tsx src/scripts/criarOperador.ts"
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:integracao -w apps/api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/scripts/criarOperador.ts apps/api/integracao/criarOperador.test.ts apps/api/package.json
git commit -m "feat(api): CLI criar-operador" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `_ADMIN/login`

**Files:**
- Create: `apps/api/src/_ADMIN/login/route.login.ts`, `ctrl.login.ts`, `sql.login.ts`, `login.http`
- Test: `apps/api/integracao/adminLogin.test.ts`
- Modify: `apps/api/src/routes/adminRoute.ts`

**Interfaces:**
- Consumes: `iRota`, `iContexto`, `tClasseRota`, `per` default export (`apps/api/src/services/per.ts`), `ErroTratado` (fase 1), `ConexaoPostgres` (fase 1), `conferirSenha` (Task 1), `gerarToken` (Task 1), `config` (Task 1, `operadorSegredo`)
- Produces: classe `Login implements iRota` com o método `login(req): Promise<{ token: string; id_operador: number; nome: string }>` — despachada em `POST /api/admin/login` com `{ call: "login", login, senha }`

O `route.<m>.ts` de cada módulo desta fase segue o mesmo formato: a classe é o próprio `Router` que `per()` instancia — sem `res`, métodos recebem só `req` e devolvem o valor (nunca chamam `res.*`). `route.<m>.ts` cuida só da validação de presença e delega para `ctrl.<m>.ts`; `sql.<m>.ts` só tem SQL.

- [ ] **Step 1: Escrever o teste**

`apps/api/integracao/adminLogin.test.ts`:

```ts
import { test, before, after } from "node:test";
import assert from "node:assert";
import ConexaoPostgres from "../src/db/conexaoPostgres";
import { iniciarConfig, config } from "../src/services/config";
import { criarOperador } from "../src/scripts/criarOperador";
import { conferirToken } from "../src/services/token";
import per from "../src/services/per";
import Login from "../src/_ADMIN/login/route.login";

before(() => {
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
    });
});

function resFalso() {
    const chamadas: { status?: number; body?: unknown } = {};
    return {
        chamadas,
        status(codigo: number) {
            chamadas.status = codigo;
            return this;
        },
        send(corpo: unknown) {
            chamadas.body = corpo;
        },
    };
}

let conexao: ConexaoPostgres;
let login: string;

before(async () => {
    conexao = new ConexaoPostgres();
    await conexao.open();
    login = `login-teste-${Date.now()}`;
    await criarOperador(conexao, "Operadora", login, "senha-correta");
});

test("login com senha certa devolve token válido", async () => {
    const res = resFalso();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await per({ body: { call: "login", login, senha: "senha-correta" } } as any, res as any, () => {}, Login);

    const corpo = res.chamadas.body as { token: string; nome: string; id_operador: number };
    assert.strictEqual(corpo.nome, "Operadora");
    assert.strictEqual(conferirToken(corpo.token, config.operadorSegredo), corpo.id_operador);
});

test("login com senha errada devolve 422", async () => {
    const res = resFalso();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await per({ body: { call: "login", login, senha: "senha-errada" } } as any, res as any, () => {}, Login);

    assert.strictEqual(res.chamadas.status, 422);
});

test("login com usuário inexistente devolve 422 com a mesma mensagem (não vaza quem existe)", async () => {
    const res = resFalso();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await per({ body: { call: "login", login: "ninguem-aqui", senha: "qualquer" } } as any, res as any, () => {}, Login);

    assert.strictEqual(res.chamadas.status, 422);
    assert.strictEqual((res.chamadas.body as { msg: string }).msg, "Login ou senha inválidos.");
});

after(async () => {
    await conexao?.close();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:integracao -w apps/api`
Expected: FAIL — `Cannot find module '../src/_ADMIN/login/route.login'`.

- [ ] **Step 3: Implementar**

`apps/api/src/_ADMIN/login/sql.login.ts`:

```ts
import ConexaoPostgres from "../../db/conexaoPostgres";

export interface LinhaOperador {
    id_operador: number;
    nome: string;
    senha_hash: string;
}

export async function buscarOperadorPorLogin(conexao: ConexaoPostgres, login: string): Promise<LinhaOperador | undefined> {
    return conexao.queryOneParam<LinhaOperador>(
        "SELECT id_operador, nome, senha_hash FROM operador WHERE login = ? AND deletado = 'N'",
        [login]
    );
}
```

`apps/api/src/_ADMIN/login/ctrl.login.ts`:

```ts
import ConexaoPostgres from "../../db/conexaoPostgres";
import { conferirSenha } from "../../services/senha";
import { gerarToken } from "../../services/token";
import { config } from "../../services/config";
import { ErroTratado } from "../../services/erro";
import { buscarOperadorPorLogin } from "./sql.login";

export default class LoginCtrl {
    constructor(private conexao: ConexaoPostgres) {}

    async login(login: string, senha: string): Promise<{ token: string; id_operador: number; nome: string }> {
        const operador = await buscarOperadorPorLogin(this.conexao, login);
        // Mesma mensagem para login inexistente e senha errada: não revela quais logins existem.
        if (!operador || !(await conferirSenha(senha, operador.senha_hash)))
            throw new ErroTratado("Login ou senha inválidos.");

        return { token: gerarToken(operador.id_operador, config.operadorSegredo), id_operador: operador.id_operador, nome: operador.nome };
    }
}
```

`apps/api/src/_ADMIN/login/route.login.ts`:

```ts
import { Request } from "express";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { iContexto, iRota } from "../../services/per";
import LoginCtrl from "./ctrl.login";

export default class Login implements iRota {
    conexao = new ConexaoPostgres();
    private ctrl!: LoginCtrl;

    constructor(private contexto: iContexto) {}

    async init(): Promise<void> {
        await this.conexao.open();
        this.ctrl = new LoginCtrl(this.conexao);
    }

    async login(req: Request) {
        const { login, senha } = req.body;
        if (!login || !senha) return { msg: "Campos login e senha são obrigatórios", error: true };
        return this.ctrl.login(login, senha);
    }
}
```

`apps/api/src/_ADMIN/login/login.http`:

```http
@vps = http://localhost:3002

### Login
POST {{vps}}/api/admin/login
Content-Type: application/json

{
    "call": "login",
    "login": "ana",
    "senha": "troque-esta-senha"
}
```

Em `apps/api/src/routes/adminRoute.ts`, substitua o conteúdo por:

```ts
import { Router } from "express";
import per from "../services/per";
import Login from "../_ADMIN/login/route.login";

const router = Router();

router.post("/login", (req, res, next) => per(req, res, next, Login));

export default router;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:integracao -w apps/api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/_ADMIN/login apps/api/integracao/adminLogin.test.ts apps/api/src/routes/adminRoute.ts
git commit -m "feat(api): login do operador (_ADMIN)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `_ADMIN/evento` (criar, listar, editar, config, marca d'água)

**Files:**
- Create: `apps/api/src/_ADMIN/evento/route.evento.ts`, `ctrl.evento.ts`, `sql.evento.ts`, `i.evento.ts`, `evento.http`
- Test: `apps/api/src/_ADMIN/evento/ctrl.evento.test.ts` (config, pura), `apps/api/integracao/adminEvento.test.ts`
- Modify: `apps/api/src/routes/adminRoute.ts`, `apps/api/src/services/config.ts` (`RAIZ_MARCAS`), `.env.vps.example`

**Interfaces:**
- Consumes: `iRota`, `iContexto`, `per` (fase 1), `ErroTratado` (fase 1), `ConexaoPostgres` (fase 1), `autorizarOperador` (Task 1), `gerarChave` (Task 1)
- Produces:
  - `i.evento.ts`: `interface ConfigEvento { limiar: number; exigir_whatsapp: boolean; marca_dagua: boolean; organizador: string; dias_expurgo: number; validade_resultado_dias: number | null; max_selfies: number }`
  - `ctrl.evento.ts`: `configPadrao(tipo: "esportivo" | "social", nomeEvento: string): ConfigEvento`, `mesclarConfig(atual: ConfigEvento, novo: Partial<ConfigEvento>): ConfigEvento` (exportadas, puras)
  - classe `Evento implements iRota` com `criarEvento`, `listarEventos`, `obterEvento`, `editarEvento`, `subirMarcaDagua` — em `POST /api/admin/evento`
  - `config.raizMarcas: string` (novo campo de `iConfig`, default `/data/marcas`, sem obrigatoriedade)

- [ ] **Step 1: Escrever o teste puro (config)**

`apps/api/src/_ADMIN/evento/ctrl.evento.test.ts`:

```ts
import { test, describe } from "node:test";
import assert from "node:assert";
import { configPadrao, mesclarConfig } from "./ctrl.evento";

describe("configPadrao", () => {
    test("esportivo: exigir_whatsapp true, o resto dos padrões", () => {
        assert.deepStrictEqual(configPadrao("esportivo", "Corrida X"), {
            limiar: 0.42,
            exigir_whatsapp: true,
            marca_dagua: false,
            organizador: "Corrida X",
            dias_expurgo: 90,
            validade_resultado_dias: null,
            max_selfies: 3,
        });
    });

    test("social: exigir_whatsapp false", () => {
        assert.strictEqual(configPadrao("social", "Festa Y").exigir_whatsapp, false);
    });
});

describe("mesclarConfig", () => {
    const atual = configPadrao("esportivo", "Corrida X");

    test("troca só os campos informados", () => {
        const resultado = mesclarConfig(atual, { limiar: 0.5, organizador: "Novo nome" });
        assert.strictEqual(resultado.limiar, 0.5);
        assert.strictEqual(resultado.organizador, "Novo nome");
        assert.strictEqual(resultado.max_selfies, 3);
    });

    test("aceita validade_resultado_dias explicitamente null", () => {
        const comValidade = mesclarConfig(atual, { validade_resultado_dias: 30 });
        assert.strictEqual(mesclarConfig(comValidade, { validade_resultado_dias: null }).validade_resultado_dias, null);
    });

    test("sem alterações devolve os mesmos valores", () => {
        assert.deepStrictEqual(mesclarConfig(atual, {}), atual);
    });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -w apps/api`
Expected: FAIL — `Cannot find module './ctrl.evento'`.

- [ ] **Step 3: Implementar**

Em `apps/api/package.json`, acrescente `"sharp": "^0.33.5"` em `dependencies` e rode `npm install` na raiz do repositório (atualiza o `package-lock.json`).

`apps/api/src/_ADMIN/evento/i.evento.ts`:

```ts
export interface ConfigEvento {
    limiar: number;
    exigir_whatsapp: boolean;
    marca_dagua: boolean;
    organizador: string;
    dias_expurgo: number;
    validade_resultado_dias: number | null;
    max_selfies: number;
}

export interface LinhaEvento {
    id_evento: number;
    nome: string;
    slug: string;
    tipo: "esportivo" | "social";
    privado: "S" | "N";
    chave_acesso: string | null;
    chave_anfitriao: string;
    data_inicio: string | null;
    data_fim: string;
    ativo: "S" | "N";
    config: ConfigEvento;
    criado_em: string;
}
```

`apps/api/src/_ADMIN/evento/sql.evento.ts`:

```ts
import ConexaoPostgres from "../../db/conexaoPostgres";
import { ConfigEvento, LinhaEvento } from "./i.evento";

export async function inserirEvento(
    conexao: ConexaoPostgres,
    dados: {
        nome: string;
        slug: string;
        tipo: string;
        privado: string;
        chave_acesso: string | null;
        chave_anfitriao: string;
        data_inicio: string | null;
        data_fim: string;
        config: ConfigEvento;
    }
): Promise<LinhaEvento> {
    const [linha] = await conexao.queryParam<LinhaEvento>(
        `INSERT INTO evento (nome, slug, tipo, privado, chave_acesso, chave_anfitriao, data_inicio, data_fim, config)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
        [dados.nome, dados.slug, dados.tipo, dados.privado, dados.chave_acesso, dados.chave_anfitriao, dados.data_inicio, dados.data_fim, JSON.stringify(dados.config)]
    );
    return linha;
}

export async function listarEventosSql(conexao: ConexaoPostgres): Promise<LinhaEvento[]> {
    return conexao.queryParam<LinhaEvento>(
        "SELECT id_evento, nome, slug, tipo, privado, chave_anfitriao, data_inicio, data_fim, ativo, criado_em FROM evento WHERE deletado = 'N' ORDER BY criado_em DESC"
    );
}

export async function obterEventoSql(conexao: ConexaoPostgres, idEvento: number): Promise<LinhaEvento | undefined> {
    return conexao.queryOneParam<LinhaEvento>("SELECT * FROM evento WHERE id_evento = ? AND deletado = 'N'", [idEvento]);
}

export async function atualizarEventoSql(
    conexao: ConexaoPostgres,
    idEvento: number,
    dados: { nome: string; data_inicio: string | null; data_fim: string; ativo: string; privado: string; chave_acesso: string | null; config: ConfigEvento }
): Promise<void> {
    await conexao.executeParamCount(
        `UPDATE evento SET nome = ?, data_inicio = ?, data_fim = ?, ativo = ?, privado = ?, chave_acesso = ?, config = ?, updated_at = now()
         WHERE id_evento = ?`,
        [dados.nome, dados.data_inicio, dados.data_fim, dados.ativo, dados.privado, dados.chave_acesso, JSON.stringify(dados.config), idEvento]
    );
}
```

`apps/api/src/_ADMIN/evento/ctrl.evento.ts`:

```ts
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
```

`apps/api/src/_ADMIN/evento/route.evento.ts`:

```ts
import { Request } from "express";
import { UploadedFile } from "express-fileupload";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { iContexto, iRota } from "../../services/per";
import { autorizarOperador } from "../../services/auth";
import EventoCtrl from "./ctrl.evento";

export default class Evento implements iRota {
    conexao = new ConexaoPostgres();
    private ctrl!: EventoCtrl;

    constructor(private contexto: iContexto) {}

    async init(): Promise<void> {
        await autorizarOperador(this.contexto);
        await this.conexao.open();
        this.ctrl = new EventoCtrl(this.conexao);
    }

    async criarEvento(req: Request) {
        const { nome, slug, tipo, data_fim } = req.body;
        if (!nome || !slug || !tipo || !data_fim) return { msg: "Campos nome, slug, tipo e data_fim são obrigatórios", error: true };
        return this.ctrl.criarEvento(req.body);
    }

    async listarEventos() {
        return this.ctrl.listarEventos();
    }

    async obterEvento(req: Request) {
        if (!req.body.id_evento) return { msg: "Campo id_evento é obrigatório", error: true };
        return this.ctrl.obterEvento(Number(req.body.id_evento));
    }

    async editarEvento(req: Request) {
        if (!req.body.id_evento) return { msg: "Campo id_evento é obrigatório", error: true };
        return this.ctrl.editarEvento({ ...req.body, id_evento: Number(req.body.id_evento) });
    }

    async subirMarcaDagua(req: Request) {
        const arquivo = req.files?.logo as UploadedFile | undefined;
        if (!req.body.id_evento || !arquivo) return { msg: "Campos id_evento e logo são obrigatórios", error: true };
        return this.ctrl.subirMarcaDagua(Number(req.body.id_evento), { data: arquivo.data, mimetype: arquivo.mimetype, size: arquivo.size });
    }
}
```

`apps/api/src/_ADMIN/evento/evento.http`:

```http
@vps = http://localhost:3002
@token = COLE_O_TOKEN_DO_LOGIN_AQUI

### Criar evento
POST {{vps}}/api/admin/evento
Content-Type: application/json
Authorization: {{token}}

{
    "call": "criarEvento",
    "nome": "Corrida da Serra 2026",
    "slug": "corrida-da-serra-2026",
    "tipo": "esportivo",
    "data_fim": "2026-11-01"
}

### Listar eventos
POST {{vps}}/api/admin/evento
Content-Type: application/json
Authorization: {{token}}

{ "call": "listarEventos" }

### Editar config
POST {{vps}}/api/admin/evento
Content-Type: application/json
Authorization: {{token}}

{
    "call": "editarEvento",
    "id_evento": 1,
    "config": { "limiar": 0.45, "marca_dagua": true }
}

### Subir a marca d'água (REST Client: selecione o arquivo local)
POST {{vps}}/api/admin/evento
Authorization: {{token}}
Content-Type: multipart/form-data; boundary=----limite

------limite
Content-Disposition: form-data; name="call"

subirMarcaDagua
------limite
Content-Disposition: form-data; name="id_evento"

1
------limite
Content-Disposition: form-data; name="logo"; filename="marca.png"
Content-Type: image/png

< ./marca.png
------limite--
```

Em `apps/api/src/services/config.ts`, acrescente ao `iConfig`:

```ts
    raizMarcas: string;
```

E no retorno de `carregarConfig`:

```ts
        raizMarcas: env.RAIZ_MARCAS || "/data/marcas",
```

Em `.env.vps.example`, acrescente no fim:

```
# Pasta onde ficam os PNGs de marca d'água enviados pelo admin.
RAIZ_MARCAS=/data/marcas
```

Em `apps/api/src/routes/adminRoute.ts`, acrescente:

```ts
import Evento from "../_ADMIN/evento/route.evento";
// ...
router.post("/evento", (req, res, next) => per(req, res, next, Evento));
```

- [ ] **Step 4: Escrever o teste de integração**

`apps/api/integracao/adminEvento.test.ts`:

```ts
import { test, before, after } from "node:test";
import assert from "node:assert";
import ConexaoPostgres from "../src/db/conexaoPostgres";
import { iniciarConfig } from "../src/services/config";
import EventoCtrl from "../src/_ADMIN/evento/ctrl.evento";
import { ErroTratado } from "../src/services/erro";

before(() => {
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
    });
});

let conexao: ConexaoPostgres;
let ctrl: EventoCtrl;

before(async () => {
    conexao = new ConexaoPostgres();
    await conexao.open();
    ctrl = new EventoCtrl(conexao);
});

test("cria evento social como privado por padrão, com chave de acesso", async () => {
    const evento = await ctrl.criarEvento({ nome: "Festa Y", slug: `festa-${Date.now()}`, tipo: "social", data_fim: "2026-12-31" });
    assert.strictEqual(evento.privado, "S");
    assert.ok(evento.chave_acesso);
    assert.ok(evento.chave_anfitriao);
    assert.strictEqual(evento.config.exigir_whatsapp, false);
});

test("edita a config sem apagar os campos não informados", async () => {
    const evento = await ctrl.criarEvento({ nome: "Corrida X", slug: `corrida-${Date.now()}`, tipo: "esportivo", data_fim: "2026-12-31" });
    const editado = await ctrl.editarEvento({ id_evento: evento.id_evento, config: { limiar: 0.5 } });
    assert.strictEqual(editado.config.limiar, 0.5);
    assert.strictEqual(editado.config.max_selfies, 3);
});

test("evento privado que vira público perde a chave de acesso", async () => {
    const evento = await ctrl.criarEvento({ nome: "Festa Z", slug: `festa-z-${Date.now()}`, tipo: "social", data_fim: "2026-12-31" });
    const editado = await ctrl.editarEvento({ id_evento: evento.id_evento, privado: false });
    assert.strictEqual(editado.privado, "N");
    assert.strictEqual(editado.chave_acesso, null);
});

test("obterEvento com id inexistente lança ErroTratado", async () => {
    await assert.rejects(() => ctrl.obterEvento(999_999), ErroTratado);
});

test("recusa slug inválido", async () => {
    await assert.rejects(
        () => ctrl.criarEvento({ nome: "X", slug: "Slug Com Espaço", tipo: "esportivo", data_fim: "2026-12-31" }),
        ErroTratado
    );
});

after(async () => {
    await conexao?.close();
});
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm run test -w apps/api && npm run test:integracao -w apps/api`
Expected: todos PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/_ADMIN/evento apps/api/integracao/adminEvento.test.ts apps/api/src/routes/adminRoute.ts \
        apps/api/src/services/config.ts .env.vps.example
git commit -m "feat(api): _ADMIN/evento — criar, listar, editar, config e marca d'água" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: `_ADMIN/fotografo`

**Files:**
- Create: `apps/api/src/_ADMIN/fotografo/route.fotografo.ts`, `ctrl.fotografo.ts`, `sql.fotografo.ts`, `fotografo.http`
- Test: `apps/api/integracao/adminFotografo.test.ts`
- Modify: `apps/api/src/routes/adminRoute.ts`

**Interfaces:**
- Consumes: `iRota`, `iContexto`, `per`, `ErroTratado`, `ConexaoPostgres` (fase 1), `autorizarOperador` (Task 1), `gerarChave` (Task 1)
- Produces: classe `Fotografo implements iRota` com `criarFotografo`, `listarFotografos`, `vincularFotografo` — em `POST /api/admin/fotografo`. `vincularFotografo(idEvento, idFotografo)` é idempotente: chamar de novo devolve o mesmo `token_upload` em vez de duplicar.

- [ ] **Step 1: Escrever o teste**

`apps/api/integracao/adminFotografo.test.ts`:

```ts
import { test, before, after } from "node:test";
import assert from "node:assert";
import ConexaoPostgres from "../src/db/conexaoPostgres";
import { iniciarConfig } from "../src/services/config";
import FotografoCtrl from "../src/_ADMIN/fotografo/ctrl.fotografo";
import EventoCtrl from "../src/_ADMIN/evento/ctrl.evento";
import { ErroTratado } from "../src/services/erro";

before(() => {
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
    });
});

let conexao: ConexaoPostgres;
let ctrl: FotografoCtrl;
let idEvento: number;

before(async () => {
    conexao = new ConexaoPostgres();
    await conexao.open();
    ctrl = new FotografoCtrl(conexao);
    const evento = await new EventoCtrl(conexao).criarEvento({
        nome: "Evento p/ fotógrafo",
        slug: `evento-fotografo-${Date.now()}`,
        tipo: "esportivo",
        data_fim: "2026-12-31",
    });
    idEvento = evento.id_evento;
});

test("cria e lista fotógrafos", async () => {
    const fotografo = await ctrl.criarFotografo({ nome: "João", telefone: "+5511999998888" });
    const lista = await ctrl.listarFotografos();
    assert.ok(lista.some((f) => f.id_fotografo === fotografo.id_fotografo && f.nome === "João"));
});

test("vincula um fotógrafo a um evento e gera token_upload", async () => {
    const fotografo = await ctrl.criarFotografo({ nome: "Maria", telefone: null });
    const vinculo = await ctrl.vincularFotografo(idEvento, fotografo.id_fotografo);
    assert.match(vinculo.token_upload, /^[0-9a-f]{40}$/);
    assert.strictEqual(vinculo.id_evento, idEvento);
});

test("vincular de novo é idempotente: mesmo token_upload", async () => {
    const fotografo = await ctrl.criarFotografo({ nome: "Pedro", telefone: null });
    const primeiro = await ctrl.vincularFotografo(idEvento, fotografo.id_fotografo);
    const segundo = await ctrl.vincularFotografo(idEvento, fotografo.id_fotografo);
    assert.strictEqual(primeiro.token_upload, segundo.token_upload);
    assert.strictEqual(primeiro.id_evento_fotografo, segundo.id_evento_fotografo);
});

test("vincular a um evento inexistente lança ErroTratado", async () => {
    const fotografo = await ctrl.criarFotografo({ nome: "Carla", telefone: null });
    await assert.rejects(() => ctrl.vincularFotografo(999_999, fotografo.id_fotografo), ErroTratado);
});

after(async () => {
    await conexao?.close();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:integracao -w apps/api`
Expected: FAIL — `Cannot find module '../src/_ADMIN/fotografo/ctrl.fotografo'`.

- [ ] **Step 3: Implementar**

`apps/api/src/_ADMIN/fotografo/sql.fotografo.ts`:

```ts
import ConexaoPostgres from "../../db/conexaoPostgres";

export interface LinhaFotografo {
    id_fotografo: number;
    nome: string;
    telefone: string | null;
}

export interface LinhaVinculo {
    id_evento_fotografo: number;
    id_evento: number;
    id_fotografo: number;
    token_upload: string;
}

export async function inserirFotografo(conexao: ConexaoPostgres, nome: string, telefone: string | null): Promise<LinhaFotografo> {
    const [linha] = await conexao.queryParam<LinhaFotografo>(
        "INSERT INTO fotografo (nome, telefone) VALUES (?, ?) RETURNING id_fotografo, nome, telefone",
        [nome, telefone]
    );
    return linha;
}

export async function listarFotografosSql(conexao: ConexaoPostgres): Promise<LinhaFotografo[]> {
    return conexao.queryParam<LinhaFotografo>(
        "SELECT id_fotografo, nome, telefone FROM fotografo WHERE deletado = 'N' ORDER BY nome"
    );
}

export async function eventoExiste(conexao: ConexaoPostgres, idEvento: number): Promise<boolean> {
    const linha = await conexao.queryOneParam("SELECT 1 FROM evento WHERE id_evento = ? AND deletado = 'N'", [idEvento]);
    return !!linha;
}

export async function buscarVinculo(conexao: ConexaoPostgres, idEvento: number, idFotografo: number): Promise<LinhaVinculo | undefined> {
    return conexao.queryOneParam<LinhaVinculo>(
        "SELECT id_evento_fotografo, id_evento, id_fotografo, token_upload FROM evento_fotografo WHERE id_evento = ? AND id_fotografo = ?",
        [idEvento, idFotografo]
    );
}

export async function inserirVinculo(conexao: ConexaoPostgres, idEvento: number, idFotografo: number, tokenUpload: string): Promise<LinhaVinculo> {
    const [linha] = await conexao.queryParam<LinhaVinculo>(
        "INSERT INTO evento_fotografo (id_evento, id_fotografo, token_upload) VALUES (?, ?, ?) RETURNING id_evento_fotografo, id_evento, id_fotografo, token_upload",
        [idEvento, idFotografo, tokenUpload]
    );
    return linha;
}
```

`apps/api/src/_ADMIN/fotografo/ctrl.fotografo.ts`:

```ts
import ConexaoPostgres from "../../db/conexaoPostgres";
import { ErroTratado } from "../../services/erro";
import { gerarChave } from "../../services/aleatorio";
import { buscarVinculo, eventoExiste, inserirFotografo, inserirVinculo, LinhaFotografo, LinhaVinculo, listarFotografosSql } from "./sql.fotografo";

export default class FotografoCtrl {
    constructor(private conexao: ConexaoPostgres) {}

    async criarFotografo(dados: { nome: string; telefone: string | null }): Promise<LinhaFotografo> {
        return inserirFotografo(this.conexao, dados.nome, dados.telefone ?? null);
    }

    async listarFotografos(): Promise<LinhaFotografo[]> {
        return listarFotografosSql(this.conexao);
    }

    async vincularFotografo(idEvento: number, idFotografo: number): Promise<LinhaVinculo> {
        if (!(await eventoExiste(this.conexao, idEvento))) throw new ErroTratado("Evento não encontrado.");

        const existente = await buscarVinculo(this.conexao, idEvento, idFotografo);
        if (existente) return existente;
        return inserirVinculo(this.conexao, idEvento, idFotografo, gerarChave());
    }
}
```

`apps/api/src/_ADMIN/fotografo/route.fotografo.ts`:

```ts
import { Request } from "express";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { iContexto, iRota } from "../../services/per";
import { autorizarOperador } from "../../services/auth";
import FotografoCtrl from "./ctrl.fotografo";

export default class Fotografo implements iRota {
    conexao = new ConexaoPostgres();
    private ctrl!: FotografoCtrl;

    constructor(private contexto: iContexto) {}

    async init(): Promise<void> {
        await autorizarOperador(this.contexto);
        await this.conexao.open();
        this.ctrl = new FotografoCtrl(this.conexao);
    }

    async criarFotografo(req: Request) {
        if (!req.body.nome) return { msg: "Campo nome é obrigatório", error: true };
        return this.ctrl.criarFotografo({ nome: req.body.nome, telefone: req.body.telefone ?? null });
    }

    async listarFotografos() {
        return this.ctrl.listarFotografos();
    }

    async vincularFotografo(req: Request) {
        const { id_evento, id_fotografo } = req.body;
        if (!id_evento || !id_fotografo) return { msg: "Campos id_evento e id_fotografo são obrigatórios", error: true };
        return this.ctrl.vincularFotografo(Number(id_evento), Number(id_fotografo));
    }
}
```

`apps/api/src/_ADMIN/fotografo/fotografo.http`:

```http
@vps = http://localhost:3002
@token = COLE_O_TOKEN_DO_LOGIN_AQUI

### Criar fotógrafo
POST {{vps}}/api/admin/fotografo
Content-Type: application/json
Authorization: {{token}}

{ "call": "criarFotografo", "nome": "João", "telefone": "+5511999998888" }

### Listar
POST {{vps}}/api/admin/fotografo
Content-Type: application/json
Authorization: {{token}}

{ "call": "listarFotografos" }

### Vincular a um evento (gera o link/QR de upload)
POST {{vps}}/api/admin/fotografo
Content-Type: application/json
Authorization: {{token}}

{ "call": "vincularFotografo", "id_evento": 1, "id_fotografo": 1 }
```

Em `apps/api/src/routes/adminRoute.ts`, acrescente:

```ts
import Fotografo from "../_ADMIN/fotografo/route.fotografo";
// ...
router.post("/fotografo", (req, res, next) => per(req, res, next, Fotografo));
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:integracao -w apps/api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/_ADMIN/fotografo apps/api/integracao/adminFotografo.test.ts apps/api/src/routes/adminRoute.ts
git commit -m "feat(api): _ADMIN/fotografo — criar, listar e vincular a evento" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: `_ESTACAO/sincronizacao` (VPS) e download da marca d'água

**Files:**
- Create: `apps/api/src/_ESTACAO/sincronizacao/route.sincronizacao.ts`, `ctrl.sincronizacao.ts`, `sql.sincronizacao.ts`, `i.sincronizacao.ts`, `sincronizacao.http`
- Test: `apps/api/integracao/estacaoSincronizacao.test.ts`
- Modify: `apps/api/src/routes/estacaoRoute.ts`

**Interfaces:**
- Consumes: `iRota`, `iContexto`, `per`, `ConexaoPostgres` (fase 1), `autorizarEstacao` (Task 1), `config.raizMarcas` (Task 4)
- Produces:
  - `i.sincronizacao.ts`: `interface PayloadSincronizacao { operadores: LinhaOperadorSync[]; eventos: LinhaEventoSync[]; fotografos: LinhaFotografoSync[]; vinculos: LinhaVinculoSync[] }`
  - classe `Sincronizacao implements iRota` com `getSincronizacao(): Promise<PayloadSincronizacao>` — em `POST /api/estacao/sincronizacao`
  - `GET /api/estacao/marca-dagua/:id_evento` — exceção ao RPC (como o `PUT` de upload da fase 5 e o webhook da fase 4), autenticada pela mesma `ESTACAO_CHAVE`, serve o PNG cru ou 404

Esta é a primeira rota `_ESTACAO`: a autenticação é `autorizarEstacao` (a `ESTACAO_CHAVE` compartilhada), não `autorizarOperador`.

- [ ] **Step 1: Escrever o teste**

`apps/api/integracao/estacaoSincronizacao.test.ts`:

```ts
import { test, before, after } from "node:test";
import assert from "node:assert";
import http from "node:http";
import ConexaoPostgres from "../src/db/conexaoPostgres";
import { iniciarConfig, config } from "../src/services/config";
import EventoCtrl from "../src/_ADMIN/evento/ctrl.evento";
import FotografoCtrl from "../src/_ADMIN/fotografo/ctrl.fotografo";
import { criarOperador } from "../src/scripts/criarOperador";
import per from "../src/services/per";
import Sincronizacao from "../src/_ESTACAO/sincronizacao/route.sincronizacao";

before(() => {
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
    });
});

function resFalso() {
    const chamadas: { status?: number; body?: unknown } = {};
    return {
        chamadas,
        status(codigo: number) {
            chamadas.status = codigo;
            return this;
        },
        send(corpo: unknown) {
            chamadas.body = corpo;
        },
    };
}

let conexao: ConexaoPostgres;

before(async () => {
    conexao = new ConexaoPostgres();
    await conexao.open();
});

test("devolve operadores, eventos ativos, fotógrafos e vínculos", async () => {
    await criarOperador(conexao, "Ana", `sync-op-${Date.now()}`, "senha-123456");
    const evento = await new EventoCtrl(conexao).criarEvento({
        nome: "Evento Sync",
        slug: `evento-sync-${Date.now()}`,
        tipo: "esportivo",
        data_fim: "2026-12-31",
    });
    const fotografoCtrl = new FotografoCtrl(conexao);
    const fotografo = await fotografoCtrl.criarFotografo({ nome: "Fotógrafo Sync", telefone: null });
    await fotografoCtrl.vincularFotografo(evento.id_evento, fotografo.id_fotografo);

    const res = resFalso();
    await per(
        { body: { call: "getSincronizacao" }, headers: { authorization: config.estacaoChave } } as unknown as http.IncomingMessage,
        res as never,
        () => {},
        Sincronizacao
    );

    const corpo = res.chamadas.body as {
        operadores: unknown[];
        eventos: { id_evento: number }[];
        fotografos: { id_fotografo: number }[];
        vinculos: { id_evento: number; id_fotografo: number }[];
    };
    assert.ok(corpo.operadores.length > 0);
    assert.ok(corpo.eventos.some((e) => e.id_evento === evento.id_evento));
    assert.ok(corpo.fotografos.some((f) => f.id_fotografo === fotografo.id_fotografo));
    assert.ok(corpo.vinculos.some((v) => v.id_evento === evento.id_evento && v.id_fotografo === fotografo.id_fotografo));
});

test("recusa sem a chave da estação", async () => {
    const res = resFalso();
    await per({ body: { call: "getSincronizacao" }, headers: {} } as unknown as http.IncomingMessage, res as never, () => {}, Sincronizacao);
    assert.strictEqual(res.chamadas.status, 422);
});

after(async () => {
    await conexao?.close();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:integracao -w apps/api`
Expected: FAIL — `Cannot find module '../src/_ESTACAO/sincronizacao/route.sincronizacao'`.

- [ ] **Step 3: Implementar**

`apps/api/src/_ESTACAO/sincronizacao/i.sincronizacao.ts`:

```ts
export interface LinhaOperadorSync {
    id_operador: number;
    nome: string;
    login: string;
    senha_hash: string;
    deletado: "S" | "N";
}

export interface LinhaEventoSync {
    id_evento: number;
    nome: string;
    slug: string;
    tipo: string;
    privado: "S" | "N";
    chave_acesso: string | null;
    chave_anfitriao: string;
    data_inicio: string | null;
    data_fim: string;
    ativo: "S" | "N";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: any;
    marca_dagua_caminho: string | null;
}

export interface LinhaFotografoSync {
    id_fotografo: number;
    nome: string;
    telefone: string | null;
    deletado: "S" | "N";
}

export interface LinhaVinculoSync {
    id_evento_fotografo: number;
    id_evento: number;
    id_fotografo: number;
    token_upload: string;
    ativo: "S" | "N";
}

export interface PayloadSincronizacao {
    operadores: LinhaOperadorSync[];
    eventos: LinhaEventoSync[];
    fotografos: LinhaFotografoSync[];
    vinculos: LinhaVinculoSync[];
}
```

`apps/api/src/_ESTACAO/sincronizacao/sql.sincronizacao.ts`:

```ts
import ConexaoPostgres from "../../db/conexaoPostgres";
import { LinhaEventoSync, LinhaFotografoSync, LinhaOperadorSync, LinhaVinculoSync } from "./i.sincronizacao";

export async function listarOperadoresSync(conexao: ConexaoPostgres): Promise<LinhaOperadorSync[]> {
    return conexao.queryParam<LinhaOperadorSync>("SELECT id_operador, nome, login, senha_hash, deletado FROM operador");
}

export async function listarEventosAtivosSync(conexao: ConexaoPostgres): Promise<Omit<LinhaEventoSync, "marca_dagua_caminho">[]> {
    return conexao.queryParam(
        `SELECT id_evento, nome, slug, tipo, privado, chave_acesso, chave_anfitriao, data_inicio, data_fim, ativo, config
           FROM evento WHERE ativo = 'S' AND deletado = 'N'`
    );
}

export async function listarFotografosSync(conexao: ConexaoPostgres): Promise<LinhaFotografoSync[]> {
    return conexao.queryParam<LinhaFotografoSync>("SELECT id_fotografo, nome, telefone, deletado FROM fotografo");
}

export async function listarVinculosSync(conexao: ConexaoPostgres, idsEvento: number[]): Promise<LinhaVinculoSync[]> {
    if (idsEvento.length === 0) return [];
    return conexao.queryParam<LinhaVinculoSync>(
        "SELECT id_evento_fotografo, id_evento, id_fotografo, token_upload, ativo FROM evento_fotografo WHERE id_evento = ANY(?::int[])",
        [idsEvento]
    );
}
```

`apps/api/src/_ESTACAO/sincronizacao/ctrl.sincronizacao.ts`:

```ts
import ConexaoPostgres from "../../db/conexaoPostgres";
import { PayloadSincronizacao } from "./i.sincronizacao";
import { listarEventosAtivosSync, listarFotografosSync, listarOperadoresSync, listarVinculosSync } from "./sql.sincronizacao";

export default class SincronizacaoCtrl {
    constructor(private conexao: ConexaoPostgres) {}

    async getSincronizacao(): Promise<PayloadSincronizacao> {
        const [operadores, eventosBrutos, fotografos] = await Promise.all([
            listarOperadoresSync(this.conexao),
            listarEventosAtivosSync(this.conexao),
            listarFotografosSync(this.conexao),
        ]);

        const eventos = eventosBrutos.map((evento) => ({
            ...evento,
            marca_dagua_caminho: evento.config?.marca_dagua ? `/api/estacao/marca-dagua/${evento.id_evento}` : null,
        }));
        const vinculos = await listarVinculosSync(this.conexao, eventos.map((e) => e.id_evento));

        return { operadores, eventos, fotografos, vinculos };
    }
}
```

`apps/api/src/_ESTACAO/sincronizacao/route.sincronizacao.ts`:

```ts
import ConexaoPostgres from "../../db/conexaoPostgres";
import { iContexto, iRota } from "../../services/per";
import { autorizarEstacao } from "../../services/authEstacao";
import SincronizacaoCtrl from "./ctrl.sincronizacao";

export default class Sincronizacao implements iRota {
    conexao = new ConexaoPostgres();
    private ctrl!: SincronizacaoCtrl;

    constructor(private contexto: iContexto) {}

    async init(): Promise<void> {
        autorizarEstacao(this.contexto);
        await this.conexao.open();
        this.ctrl = new SincronizacaoCtrl(this.conexao);
    }

    async getSincronizacao() {
        return this.ctrl.getSincronizacao();
    }
}
```

`apps/api/src/_ESTACAO/sincronizacao/sincronizacao.http`:

```http
@vps = http://localhost:3002
@chave = dev-somente-local-dev-somente-local

### Sincronização
POST {{vps}}/api/estacao/sincronizacao
Content-Type: application/json
Authorization: {{chave}}

{ "call": "getSincronizacao" }
```

Acrescente o download da marca d'água em `apps/api/src/routes/estacaoRoute.ts` (exceção ao RPC — rota crua, não passa por `per()`):

```ts
import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import per from "../services/per";
import { autorizarEstacao } from "../services/authEstacao";
import { config } from "../services/config";
import Sincronizacao from "../_ESTACAO/sincronizacao/route.sincronizacao";

const router = Router();

router.post("/sincronizacao", (req, res, next) => per(req, res, next, Sincronizacao));

router.get("/marca-dagua/:idEvento", (req, res) => {
    try {
        autorizarEstacao({ authorization: req.headers.authorization });
    } catch {
        res.status(422).send({ msg: "Chave da estação inválida." });
        return;
    }

    const caminho = path.join(config.raizMarcas, `${Number(req.params.idEvento)}.png`);
    fs.access(caminho, fs.constants.R_OK, (erro) => {
        if (erro) {
            res.status(404).send({ msg: "Marca d'água não encontrada." });
            return;
        }
        res.sendFile(caminho);
    });
});

export default router;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:integracao -w apps/api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/_ESTACAO/sincronizacao apps/api/integracao/estacaoSincronizacao.test.ts apps/api/src/routes/estacaoRoute.ts
git commit -m "feat(api): _ESTACAO/sincronizacao e download da marca d'água" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: `_ESTACAO/sinal` (VPS)

**Files:**
- Create: `apps/api/src/_ESTACAO/sinal/route.sinal.ts`, `ctrl.sinal.ts`, `sql.sinal.ts`, `sinal.http`
- Test: `apps/api/integracao/estacaoSinal.test.ts`
- Modify: `apps/api/src/routes/estacaoRoute.ts`

**Interfaces:**
- Consumes: `iRota`, `iContexto`, `per`, `ConexaoPostgres` (fase 1), `autorizarEstacao` (Task 1)
- Produces: classe `Sinal implements iRota` com `registrarSinal(dados: object): Promise<{ ok: true }>` — em `POST /api/estacao/sinal`, grava em `estacao_sinal (dados jsonb)`

- [ ] **Step 1: Escrever o teste**

`apps/api/integracao/estacaoSinal.test.ts`:

```ts
import { test, before, after } from "node:test";
import assert from "node:assert";
import ConexaoPostgres from "../src/db/conexaoPostgres";
import { iniciarConfig, config } from "../src/services/config";
import per from "../src/services/per";
import Sinal from "../src/_ESTACAO/sinal/route.sinal";

before(() => {
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
    });
});

function resFalso() {
    const chamadas: { status?: number; body?: unknown } = {};
    return {
        chamadas,
        status(codigo: number) {
            chamadas.status = codigo;
            return this;
        },
        send(corpo: unknown) {
            chamadas.body = corpo;
        },
    };
}

let conexao: ConexaoPostgres;

before(async () => {
    conexao = new ConexaoPostgres();
    await conexao.open();
});

test("grava o sinal recebido", async () => {
    const dados = { fila: { processarFoto: 3 }, fotos_min: 12 };
    const res = resFalso();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await per({ body: { call: "registrarSinal", ...dados }, headers: { authorization: config.estacaoChave } } as any, res as any, () => {}, Sinal);

    assert.deepStrictEqual(res.chamadas.body, { ok: true });
    const [ultimo] = await conexao.queryParam<{ dados: typeof dados }>(
        "SELECT dados FROM estacao_sinal ORDER BY id_estacao_sinal DESC LIMIT 1"
    );
    assert.deepStrictEqual(ultimo.dados, dados);
});

after(async () => {
    await conexao?.close();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:integracao -w apps/api`
Expected: FAIL — `Cannot find module '../src/_ESTACAO/sinal/route.sinal'`.

- [ ] **Step 3: Implementar**

`apps/api/src/_ESTACAO/sinal/sql.sinal.ts`:

```ts
import ConexaoPostgres from "../../db/conexaoPostgres";

export async function inserirSinal(conexao: ConexaoPostgres, dados: unknown): Promise<void> {
    await conexao.executeParamCount("INSERT INTO estacao_sinal (dados) VALUES (?)", [JSON.stringify(dados)]);
}
```

`apps/api/src/_ESTACAO/sinal/ctrl.sinal.ts`:

```ts
import ConexaoPostgres from "../../db/conexaoPostgres";
import { inserirSinal } from "./sql.sinal";

export default class SinalCtrl {
    constructor(private conexao: ConexaoPostgres) {}

    async registrarSinal(dados: unknown): Promise<{ ok: true }> {
        await inserirSinal(this.conexao, dados);
        return { ok: true };
    }
}
```

`apps/api/src/_ESTACAO/sinal/route.sinal.ts`:

```ts
import { Request } from "express";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { iContexto, iRota } from "../../services/per";
import { autorizarEstacao } from "../../services/authEstacao";
import SinalCtrl from "./ctrl.sinal";

export default class Sinal implements iRota {
    conexao = new ConexaoPostgres();
    private ctrl!: SinalCtrl;

    constructor(private contexto: iContexto) {}

    async init(): Promise<void> {
        autorizarEstacao(this.contexto);
        await this.conexao.open();
        this.ctrl = new SinalCtrl(this.conexao);
    }

    async registrarSinal(req: Request) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { call, ...dados } = req.body;
        return this.ctrl.registrarSinal(dados);
    }
}
```

`apps/api/src/_ESTACAO/sinal/sinal.http`:

```http
@vps = http://localhost:3002
@chave = dev-somente-local-dev-somente-local

### Sinal
POST {{vps}}/api/estacao/sinal
Content-Type: application/json
Authorization: {{chave}}

{ "call": "registrarSinal", "fila": { "processarFoto": 0 }, "fotos_min": 0 }
```

Em `apps/api/src/routes/estacaoRoute.ts`, acrescente:

```ts
import Sinal from "../_ESTACAO/sinal/route.sinal";
// ...
router.post("/sinal", (req, res, next) => per(req, res, next, Sinal));
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:integracao -w apps/api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/_ESTACAO/sinal apps/api/integracao/estacaoSinal.test.ts apps/api/src/routes/estacaoRoute.ts
git commit -m "feat(api): _ESTACAO/sinal" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: `_ESTACAO/foto` — `publicarFoto` (VPS)

**Files:**
- Create: `apps/api/src/_ESTACAO/foto/route.foto.ts`, `ctrl.foto.ts`, `sql.foto.ts`, `i.foto.ts`, `foto.http`
- Test: `apps/api/integracao/estacaoFoto.test.ts`
- Modify: `apps/api/src/routes/estacaoRoute.ts`, `apps/api/src/services/config.ts` (`RAIZ_FOTOS`), `.env.vps.example`

**Interfaces:**
- Consumes: `iRota`, `iContexto`, `per`, `ConexaoPostgres` (fase 1), `autorizarEstacao` (Task 1)
- Produces:
  - `i.foto.ts`: `interface RostoPublicar { embedding: number[]; bbox: number[]; det_score: number; area_px: number }`, `interface DadosPublicarFoto { id_evento: number; id_evento_fotografo: number | null; hash_arquivo: string; largura: number; altura: number; bytes_web: number; capturada_em: string | null; camera: string | null; rostos: RostoPublicar[] }`
  - classe `Foto implements iRota` com `publicarFoto(req): Promise<{ ok: true }>` — multipart, campos `dados` (JSON) + arquivos `web`, `thumb`, `previa` — em `POST /api/estacao/foto`
  - `config.raizFotos: string` (novo campo de `iConfig`, default `/data/fotos`)
  - Caminho gravado: `<raizFotos>/<id_evento>/<hash>_{web,thumb,previa}.jpg`

`embedding` chega como `number[]` (512 posições) e é gravado com `?::vector`, formatado como string `"[0.1,0.2,...]"` — o driver `pg` não serializa arrays JS para o tipo `vector` sozinho.

- [ ] **Step 1: Escrever o teste**

`apps/api/integracao/estacaoFoto.test.ts`:

```ts
import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import express from "express";
import fileUpload from "express-fileupload";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import ConexaoPostgres from "../src/db/conexaoPostgres";
import { iniciarConfig, config } from "../src/services/config";
import EventoCtrl from "../src/_ADMIN/evento/ctrl.evento";
import per from "../src/services/per";
import Foto from "../src/_ESTACAO/foto/route.foto";

before(() => {
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
        RAIZ_FOTOS: "/tmp/fotos-teste-estacao-foto",
    });
});

let conexao: ConexaoPostgres;
let servidor: Server;
let base: string;
let idEvento: number;

before(async () => {
    conexao = new ConexaoPostgres();
    await conexao.open();
    const evento = await new EventoCtrl(conexao).criarEvento({
        nome: "Evento Publicação",
        slug: `evento-publicacao-${Date.now()}`,
        tipo: "esportivo",
        data_fim: "2026-12-31",
    });
    idEvento = evento.id_evento;

    const app = express();
    app.use(fileUpload({ limits: { fileSize: 25 * 1024 * 1024, files: 5 } }));
    app.post("/foto", (req, res, next) => per(req, res, next, Foto));
    servidor = app.listen(0);
    await new Promise((resolve) => servidor.once("listening", resolve));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

function corpoPadrao(hash: string) {
    return {
        id_evento: idEvento,
        id_evento_fotografo: null,
        hash_arquivo: hash,
        largura: 4000,
        altura: 3000,
        bytes_web: 12345,
        capturada_em: "2026-11-01T10:00:00-03:00",
        camera: "Canon EOS R6",
        rostos: [{ embedding: new Array(512).fill(0.01), bbox: [10, 20, 110, 220], det_score: 0.93, area_px: 20000 }],
    };
}

async function publicar(hash: string, dados = corpoPadrao(hash)) {
    const forma = new FormData();
    forma.append("call", "publicarFoto");
    forma.append("dados", JSON.stringify(dados));
    forma.append("web", new Blob([Buffer.from("fake-web")]), "web.jpg");
    forma.append("thumb", new Blob([Buffer.from("fake-thumb")]), "thumb.jpg");
    forma.append("previa", new Blob([Buffer.from("fake-previa")]), "previa.jpg");
    const resposta = await fetch(`${base}/foto`, { method: "POST", headers: { Authorization: config.estacaoChave }, body: forma });
    return { status: resposta.status, corpo: await resposta.json() };
}

describe("publicarFoto", () => {
    test("grava a foto, os rostos e os 3 arquivos", async () => {
        const hash = `hash-${Date.now()}`;
        const r = await publicar(hash);

        assert.deepStrictEqual(r.corpo, { ok: true });
        const [foto] = await conexao.queryParam<{ id_foto: number; qtd_rostos: number; situacao: string }>(
            "SELECT id_foto, qtd_rostos, situacao FROM foto WHERE id_evento = ? AND hash_arquivo = ?",
            [idEvento, hash]
        );
        assert.strictEqual(foto.qtd_rostos, 1);
        assert.strictEqual(foto.situacao, "visivel");

        const rostos = await conexao.queryParam("SELECT * FROM rosto WHERE id_foto = ?", [foto.id_foto]);
        assert.strictEqual(rostos.length, 1);

        const fs = await import("node:fs/promises");
        const conteudo = await fs.readFile(`${config.raizFotos}/${idEvento}/${hash}_web.jpg`, "utf8");
        assert.strictEqual(conteudo, "fake-web");
    });

    test("republicar a mesma foto é idempotente: mesmo id_foto, rostos substituídos", async () => {
        const hash = `hash-${Date.now()}-repub`;
        const primeira = await publicar(hash);
        const [antes] = await conexao.queryParam<{ id_foto: number }>("SELECT id_foto FROM foto WHERE id_evento = ? AND hash_arquivo = ?", [
            idEvento,
            hash,
        ]);

        const dados2 = corpoPadrao(hash);
        dados2.rostos = [dados2.rostos[0], dados2.rostos[0]];
        await publicar(hash, dados2);
        const [depois] = await conexao.queryParam<{ id_foto: number; qtd_rostos: number }>(
            "SELECT id_foto, qtd_rostos FROM foto WHERE id_evento = ? AND hash_arquivo = ?",
            [idEvento, hash]
        );

        assert.strictEqual(primeira.corpo.ok, true);
        assert.strictEqual(depois.id_foto, antes.id_foto);
        assert.strictEqual(depois.qtd_rostos, 2);
    });

    test("foto excluída ignora o envio e responde ok, sem recriar", async () => {
        const hash = `hash-${Date.now()}-excluida`;
        await publicar(hash);
        const [linha] = await conexao.queryParam<{ id_foto: number }>("SELECT id_foto FROM foto WHERE id_evento = ? AND hash_arquivo = ?", [
            idEvento,
            hash,
        ]);
        await conexao.executeParamCount("UPDATE foto SET situacao = 'excluida' WHERE id_foto = ?", [linha.id_foto]);

        const r = await publicar(hash);
        assert.deepStrictEqual(r.corpo, { ok: true });
        const [depois] = await conexao.queryParam<{ situacao: string }>("SELECT situacao FROM foto WHERE id_foto = ?", [linha.id_foto]);
        assert.strictEqual(depois.situacao, "excluida");
    });

    test("republicar não reverte uma foto oculta para visível", async () => {
        const hash = `hash-${Date.now()}-oculta`;
        await publicar(hash);
        await conexao.executeParamCount("UPDATE foto SET situacao = 'oculta' WHERE id_evento = ? AND hash_arquivo = ?", [idEvento, hash]);

        await publicar(hash);
        const [linha] = await conexao.queryParam<{ situacao: string }>("SELECT situacao FROM foto WHERE id_evento = ? AND hash_arquivo = ?", [
            idEvento,
            hash,
        ]);
        assert.strictEqual(linha.situacao, "oculta");
    });
});

after(async () => {
    servidor?.close();
    await conexao?.close();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:integracao -w apps/api`
Expected: FAIL — `Cannot find module '../src/_ESTACAO/foto/route.foto'`.

- [ ] **Step 3: Implementar**

`apps/api/src/_ESTACAO/foto/i.foto.ts`:

```ts
export interface RostoPublicar {
    embedding: number[];
    bbox: number[];
    det_score: number;
    area_px: number;
}

export interface DadosPublicarFoto {
    id_evento: number;
    id_evento_fotografo: number | null;
    hash_arquivo: string;
    largura: number;
    altura: number;
    bytes_web: number;
    capturada_em: string | null;
    camera: string | null;
    rostos: RostoPublicar[];
}
```

`apps/api/src/_ESTACAO/foto/sql.foto.ts`:

```ts
import ConexaoPostgres from "../../db/conexaoPostgres";
import { DadosPublicarFoto } from "./i.foto";

export async function situacaoAtual(conexao: ConexaoPostgres, idEvento: number, hash: string): Promise<string | undefined> {
    const linha = await conexao.queryOneParam<{ situacao: string }>("SELECT situacao FROM foto WHERE id_evento = ? AND hash_arquivo = ?", [
        idEvento,
        hash,
    ]);
    return linha?.situacao;
}

export async function upsertFoto(conexao: ConexaoPostgres, dados: DadosPublicarFoto): Promise<number> {
    const [linha] = await conexao.queryParam<{ id_foto: number }>(
        `INSERT INTO foto (id_evento, id_evento_fotografo, hash_arquivo, largura, altura, bytes_web, capturada_em, camera, qtd_rostos, publicada_em, situacao)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, now(), 'visivel')
         ON CONFLICT (id_evento, hash_arquivo) DO UPDATE SET
             id_evento_fotografo = EXCLUDED.id_evento_fotografo, largura = EXCLUDED.largura, altura = EXCLUDED.altura,
             bytes_web = EXCLUDED.bytes_web, capturada_em = EXCLUDED.capturada_em, camera = EXCLUDED.camera,
             qtd_rostos = EXCLUDED.qtd_rostos, publicada_em = now()
         RETURNING id_foto`,
        [dados.id_evento, dados.id_evento_fotografo, dados.hash_arquivo, dados.largura, dados.altura, dados.bytes_web, dados.capturada_em, dados.camera, dados.rostos.length]
    );
    return linha.id_foto;
}

export async function substituirRostos(conexao: ConexaoPostgres, idFoto: number, idEvento: number, rostos: DadosPublicarFoto["rostos"]): Promise<void> {
    await conexao.executeParamCount("DELETE FROM rosto WHERE id_foto = ?", [idFoto]);
    for (const rosto of rostos) {
        await conexao.executeParamCount("INSERT INTO rosto (id_foto, id_evento, embedding, bbox, det_score, area_px) VALUES (?, ?, ?::vector, ?, ?, ?)", [
            idFoto,
            idEvento,
            `[${rosto.embedding.join(",")}]`,
            JSON.stringify(rosto.bbox),
            rosto.det_score,
            rosto.area_px,
        ]);
    }
}
```

`apps/api/src/_ESTACAO/foto/ctrl.foto.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { config } from "../../services/config";
import { DadosPublicarFoto } from "./i.foto";
import { situacaoAtual, substituirRostos, upsertFoto } from "./sql.foto";

export interface ArquivosPublicarFoto {
    web: Buffer;
    thumb: Buffer;
    previa: Buffer;
}

export default class FotoCtrl {
    constructor(private conexao: ConexaoPostgres) {}

    async publicarFoto(dados: DadosPublicarFoto, arquivos: ArquivosPublicarFoto): Promise<{ ok: true }> {
        // Foto excluída não ressuscita: a estação não sabe que foi apagada até sincronizar de novo.
        if ((await situacaoAtual(this.conexao, dados.id_evento, dados.hash_arquivo)) === "excluida") return { ok: true };

        // `init()` já abriu a transação (openTransaction). Se qualquer passo falhar — banco ou
        // disco — marcarErro() garante que o close() do route.foto.ts faça ROLLBACK em vez de
        // COMMIT, para nunca publicar a linha sem os arquivos (ou vice-versa).
        try {
            const idFoto = await upsertFoto(this.conexao, dados);
            await substituirRostos(this.conexao, idFoto, dados.id_evento, dados.rostos);

            const pasta = path.join(config.raizFotos, String(dados.id_evento));
            await fs.mkdir(pasta, { recursive: true });
            await Promise.all([
                fs.writeFile(path.join(pasta, `${dados.hash_arquivo}_web.jpg`), arquivos.web),
                fs.writeFile(path.join(pasta, `${dados.hash_arquivo}_thumb.jpg`), arquivos.thumb),
                fs.writeFile(path.join(pasta, `${dados.hash_arquivo}_previa.jpg`), arquivos.previa),
            ]);
        } catch (erro) {
            this.conexao.marcarErro();
            throw erro;
        }
        return { ok: true };
    }
}
```

`apps/api/src/_ESTACAO/foto/route.foto.ts`:

```ts
import { Request } from "express";
import { UploadedFile } from "express-fileupload";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { iContexto, iRota } from "../../services/per";
import { autorizarEstacao } from "../../services/authEstacao";
import FotoCtrl from "./ctrl.foto";
import { DadosPublicarFoto } from "./i.foto";

export default class Foto implements iRota {
    conexao = new ConexaoPostgres();
    private ctrl!: FotoCtrl;

    constructor(private contexto: iContexto) {}

    async init(): Promise<void> {
        autorizarEstacao(this.contexto);
        // Transação: upsert de `foto` e a troca dos `rosto` precisam ser atômicos.
        await this.conexao.openTransaction();
        this.ctrl = new FotoCtrl(this.conexao);
    }

    async publicarFoto(req: Request) {
        const web = req.files?.web as UploadedFile | undefined;
        const thumb = req.files?.thumb as UploadedFile | undefined;
        const previa = req.files?.previa as UploadedFile | undefined;
        if (!req.body.dados || !web || !thumb || !previa)
            return { msg: "Campos dados, web, thumb e previa são obrigatórios", error: true };

        const dados = JSON.parse(req.body.dados) as DadosPublicarFoto;
        return this.ctrl.publicarFoto(dados, { web: web.data, thumb: thumb.data, previa: previa.data });
    }
}
```

`apps/api/src/_ESTACAO/foto/foto.http`:

```http
@vps = http://localhost:3002
@chave = dev-somente-local-dev-somente-local

### Publicar (REST Client: selecione arquivos locais de teste)
POST {{vps}}/api/estacao/foto
Authorization: {{chave}}
Content-Type: multipart/form-data; boundary=----limite

------limite
Content-Disposition: form-data; name="call"

publicarFoto
------limite
Content-Disposition: form-data; name="dados"

{"id_evento":1,"id_evento_fotografo":null,"hash_arquivo":"abc123","largura":4000,"altura":3000,"bytes_web":12345,"capturada_em":null,"camera":null,"rostos":[]}
------limite
Content-Disposition: form-data; name="web"; filename="web.jpg"
Content-Type: image/jpeg

< ./web.jpg
------limite
Content-Disposition: form-data; name="thumb"; filename="thumb.jpg"
Content-Type: image/jpeg

< ./thumb.jpg
------limite
Content-Disposition: form-data; name="previa"; filename="previa.jpg"
Content-Type: image/jpeg

< ./previa.jpg
------limite--
```

Em `apps/api/src/services/config.ts`, acrescente ao `iConfig`:

```ts
    raizFotos: string;
```

E no retorno de `carregarConfig`:

```ts
        raizFotos: env.RAIZ_FOTOS || "/data/fotos",
```

Em `.env.vps.example`, acrescente:

```
# Pasta onde ficam as fotos publicadas (web, thumb, prévia).
RAIZ_FOTOS=/data/fotos
```

Em `apps/api/src/routes/estacaoRoute.ts`, acrescente:

```ts
import Foto from "../_ESTACAO/foto/route.foto";
// ...
router.post("/foto", (req, res, next) => per(req, res, next, Foto));
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:integracao -w apps/api`
Expected: PASS. Limpe `/tmp/fotos-teste-estacao-foto` depois se quiser (o teste não apaga sozinho).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/_ESTACAO/foto apps/api/integracao/estacaoFoto.test.ts apps/api/src/routes/estacaoRoute.ts \
        apps/api/src/services/config.ts .env.vps.example
git commit -m "feat(api): _ESTACAO/foto — publicarFoto idempotente" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 9: Fila (BullMQ) e o job `sincronizar` (estação)

**Files:**
- Create: `apps/api/src/services/fila.ts`, `apps/api/src/services/vpsHttp.ts`, `apps/api/src/jobs/sincronizar.ts`
- Test: `apps/api/src/services/fila.test.ts` (pura), `apps/api/integracao/jobSincronizar.test.ts`
- Modify: `apps/api/package.json` (`bullmq`, `ioredis`)

**Interfaces:**
- Consumes: `config` (fase 1), `ConexaoPostgres` (fase 1), `PayloadSincronizacao` (Task 6, reaproveitado — mesmo pacote, os dois papéis compartilham o código)
- Produces:
  - `criarFila<T>(nome: string): Queue<T>`, `criarWorker<T>(nome: string, processador: Processor<T>, concorrencia: number): Worker<T>`, `backoffComTeto(tetoMs: number): (tentativas: number) => number`, `fecharFila(): Promise<void>`
  - `chamarVps(caminho: string, corpo: unknown, timeoutMs?: number): Promise<unknown>` — `POST` com `Authorization: <ESTACAO_CHAVE>`, lança erro se a resposta não for 2xx
  - `processarSincronizar(conexao: ConexaoPostgres): Promise<void>` — busca e grava localmente por upsert
  - `agendarSincronizacao(): Promise<Queue>` — registra o job imediato + repetição a cada 60s; usada pelo `worker.ts` (Task 15)

- [ ] **Step 1: Escrever o teste puro**

`apps/api/src/services/fila.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert";
import { backoffComTeto } from "./fila";

test("cresce exponencialmente até o teto e trava nele", () => {
    const estrategia = backoffComTeto(10_000);
    assert.strictEqual(estrategia(0), 1000);
    assert.strictEqual(estrategia(1), 2000);
    assert.strictEqual(estrategia(2), 4000);
    assert.strictEqual(estrategia(10), 10_000);
    assert.strictEqual(estrategia(30), 10_000);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -w apps/api`
Expected: FAIL — `Cannot find module './fila'`.

- [ ] **Step 3: Implementar**

Em `apps/api/package.json`, acrescente `"bullmq": "^5.34.0"` e `"ioredis": "^5.4.1"` em `dependencies`; rode `npm install` na raiz.

`apps/api/src/services/fila.ts`:

```ts
import { Processor, Queue, Worker } from "bullmq";
import Redis from "ioredis";
import { config } from "./config";

let conexao: Redis | undefined;

function obterConexao(): Redis {
    if (!conexao) {
        conexao = new Redis(config.redis.url, { maxRetriesPerRequest: null });
        conexao.on("error", (erro) => console.error("[Fila] Erro na conexão Redis:", erro.message));
    }
    return conexao;
}

export async function fecharFila(): Promise<void> {
    const atual = conexao;
    conexao = undefined;
    await atual?.quit();
}

export function criarFila<T = unknown>(nome: string): Queue<T> {
    return new Queue<T>(nome, { connection: obterConexao(), prefix: config.redis.prefixo });
}

// 1s, 2s, 4s, ... até o teto — para filas que não podem esperar horas por uma dependência externa.
export function backoffComTeto(tetoMs: number): (tentativasFeitas: number) => number {
    return (tentativasFeitas: number) => Math.min(1000 * 2 ** tentativasFeitas, tetoMs);
}

export function criarWorker<T = unknown>(nome: string, processador: Processor<T>, concorrencia: number): Worker<T> {
    const worker = new Worker<T>(nome, processador, {
        connection: obterConexao(),
        prefix: config.redis.prefixo,
        concurrency: concorrencia,
        settings: { backoffStrategy: backoffComTeto(300_000) },
    });
    worker.on("failed", (job, erro) => console.error(`[Fila:${nome}] job ${job?.id} falhou:`, erro.message));
    return worker;
}
```

`apps/api/src/services/vpsHttp.ts`:

```ts
import { config } from "./config";

export async function chamarVps(caminho: string, corpo: unknown, timeoutMs = 30_000): Promise<unknown> {
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), timeoutMs);
    try {
        const resposta = await fetch(`${config.vpsUrl}${caminho}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: config.estacaoChave },
            body: JSON.stringify(corpo),
            signal: controlador.signal,
        });
        const dados = await resposta.json();
        if (!resposta.ok) throw new Error(`VPS respondeu ${resposta.status} em ${caminho}: ${JSON.stringify(dados)}`);
        return dados;
    } finally {
        clearTimeout(temporizador);
    }
}
```

`apps/api/src/jobs/sincronizar.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import { Queue } from "bullmq";
import ConexaoPostgres from "../db/conexaoPostgres";
import { config } from "../services/config";
import { chamarVps } from "../services/vpsHttp";
import { criarFila, criarWorker } from "../services/fila";
import { PayloadSincronizacao } from "../_ESTACAO/sincronizacao/i.sincronizacao";

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
        try {
            await fs.access(destino);
            continue; // já temos a versão atual em disco
        } catch {
            // segue e baixa
        }
        try {
            const resposta = await fetch(`${config.vpsUrl}${ev.marca_dagua_caminho}`, { headers: { Authorization: config.estacaoChave } });
            if (!resposta.ok) continue;
            await fs.mkdir(config.raizMarcas, { recursive: true });
            await fs.writeFile(destino, Buffer.from(await resposta.arrayBuffer()));
        } catch (erro) {
            console.error(`[Sincronizar] Falha ao baixar a marca d'água do evento ${ev.id_evento}:`, (erro as Error).message);
        }
    }
}

export function iniciarWorkerSincronizar(): void {
    criarWorker(NOME_FILA, async () => processarSincronizar(new ConexaoPostgres()), 1);
}

export async function agendarSincronizacao(): Promise<Queue> {
    const fila = criarFila(NOME_FILA);
    await fila.add(NOME_FILA, {}, { attempts: 3 });
    await fila.add(NOME_FILA, {}, { repeat: { every: 60_000 }, jobId: "sincronizar-periodico", attempts: 3 });
    return fila;
}
```

- [ ] **Step 4: Escrever o teste de integração**

`apps/api/integracao/jobSincronizar.test.ts`:

```ts
import { test, before, after } from "node:test";
import assert from "node:assert";
import express from "express";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import ConexaoPostgres from "../src/db/conexaoPostgres";
import { iniciarConfig, config } from "../src/services/config";
import { processarSincronizar } from "../src/jobs/sincronizar";

let servidorVps: Server;
let conexao: ConexaoPostgres;

before(async () => {
    const app = express();
    app.use(express.json());
    app.post("/api/estacao/sincronizacao", (_req, res) => {
        res.json({
            operadores: [{ id_operador: 1, nome: "Ana", login: "ana", senha_hash: "hash", deletado: "N" }],
            eventos: [
                {
                    id_evento: 1,
                    nome: "Evento Sync",
                    slug: "evento-sync",
                    tipo: "esportivo",
                    privado: "N",
                    chave_acesso: null,
                    chave_anfitriao: "chave-anfitriao",
                    data_inicio: null,
                    data_fim: "2026-12-31",
                    ativo: "S",
                    config: { limiar: 0.42 },
                    marca_dagua_caminho: null,
                },
            ],
            fotografos: [{ id_fotografo: 1, nome: "Fotógrafo Sync", telefone: null, deletado: "N" }],
            vinculos: [{ id_evento_fotografo: 1, id_evento: 1, id_fotografo: 1, token_upload: "token", ativo: "S" }],
        });
    });
    servidorVps = app.listen(0);
    await new Promise((resolve) => servidorVps.once("listening", resolve));

    iniciarConfig({
        PAPEL: "estacao",
        POSTGRES_HOST: "127.0.0.1",
        POSTGRES_PORT: "5433",
        POSTGRES_USER: "fotos",
        POSTGRES_PASSWORD: "fotos",
        POSTGRES_DB: "fotos_estacao",
        REDIS_URL: "redis://127.0.0.1:6380",
        ESTACAO_CHAVE: "a".repeat(32),
        VPS_URL: `http://127.0.0.1:${(servidorVps.address() as AddressInfo).port}`,
        RAIZ_MARCAS: "/tmp/marcas-teste-sincronizar",
    });
});

test("grava operadores, eventos, fotógrafos e vínculos com os mesmos IDs da VPS", async () => {
    conexao = new ConexaoPostgres();
    await processarSincronizar(conexao);

    const verificacao = new ConexaoPostgres();
    await verificacao.open();
    const [operador] = await verificacao.queryParam("SELECT * FROM operador WHERE id_operador = 1");
    const [evento] = await verificacao.queryParam("SELECT * FROM evento WHERE id_evento = 1");
    const [vinculo] = await verificacao.queryParam("SELECT * FROM evento_fotografo WHERE id_evento_fotografo = 1");
    assert.strictEqual(operador.login, "ana");
    assert.strictEqual(evento.slug, "evento-sync");
    assert.strictEqual(vinculo.token_upload, "token");
    await verificacao.close();
});

after(async () => {
    servidorVps?.close();
});
```

Suba o schema da estação antes de rodar, se ainda não subiu: `npm run migrate:dev`.

- [ ] **Step 5: Rodar e ver passar**

Run: `npm run test -w apps/api && npm run test:integracao -w apps/api`
Expected: todos PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/fila.ts apps/api/src/services/fila.test.ts apps/api/src/services/vpsHttp.ts \
        apps/api/src/jobs/sincronizar.ts apps/api/integracao/jobSincronizar.test.ts apps/api/package.json
git commit -m "feat(api): fila BullMQ e job sincronizar (estação)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 10: Caminhos, hash e EXIF (utilitários puros da estação)

**Files:**
- Create: `apps/api/src/services/caminhos.ts`, `apps/api/src/services/hashArquivo.ts`, `apps/api/src/services/exifFoto.ts`
- Test: `apps/api/src/services/caminhos.test.ts`, `apps/api/src/services/hashArquivo.test.ts`, `apps/api/src/services/exifFoto.test.ts`
- Modify: `apps/api/src/services/config.ts` (`RAIZ_ORIGINAIS`, `RAIZ_PUBLICAR`), `apps/api/package.json` (`exifr`), `.env.estacao.example`

**Interfaces:**
- Consumes: nada das tasks anteriores (utilitários puros, sem banco)
- Produces:
  - `caminhoOriginal(raiz, slug, dataFoto, hash): string`, `caminhoPublicar(raiz, idEvento, hash, tipo: "web"|"thumb"|"previa"): string`, `caminhoMarcaDagua(raiz, idEvento): string`
  - `calcularHashArquivo(caminho: string): Promise<string>` — SHA-256 em stream, hex
  - `lerExif(caminho: string): Promise<{ dataOriginal?: Date; offsetOriginal?: string; make?: string; model?: string }>`
  - `combinarDataExif(dataOriginal: Date | undefined, offsetOriginal: string | undefined, fuso: string): Date | null`
  - `config.raizOriginais: string` (default `/data/originais`), `config.raizPublicar: string` (default `/data/publicar`) — novos campos de `iConfig`

- [ ] **Step 1: Escrever os testes**

`apps/api/src/services/caminhos.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert";
import { caminhoMarcaDagua, caminhoOriginal, caminhoPublicar } from "./caminhos";

test("caminhoOriginal usa slug e data, não o id do evento", () => {
    assert.strictEqual(caminhoOriginal("/data/originais", "corrida-x", "2026-11-01", "abc123"), "/data/originais/corrida-x/2026-11-01/abc123.jpg");
});

test("caminhoPublicar usa o id do evento e o sufixo do tipo", () => {
    assert.strictEqual(caminhoPublicar("/data/publicar", 7, "abc123", "web"), "/data/publicar/7/abc123_web.jpg");
    assert.strictEqual(caminhoPublicar("/data/publicar", 7, "abc123", "thumb"), "/data/publicar/7/abc123_thumb.jpg");
});

test("caminhoMarcaDagua", () => {
    assert.strictEqual(caminhoMarcaDagua("/data/marcas", 7), "/data/marcas/7.png");
});
```

`apps/api/src/services/hashArquivo.test.ts`:

```ts
import { test, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { calcularHashArquivo } from "./hashArquivo";

let pasta: string;

before(async () => {
    pasta = await fs.mkdtemp(path.join(os.tmpdir(), "hash-teste-"));
});

test("calcula o SHA-256 igual ao node:crypto direto", async () => {
    const caminho = path.join(pasta, "arquivo.bin");
    const conteudo = Buffer.from("conteudo de teste para o hash");
    await fs.writeFile(caminho, conteudo);

    const esperado = createHash("sha256").update(conteudo).digest("hex");
    assert.strictEqual(await calcularHashArquivo(caminho), esperado);
});

test("rejeita para arquivo inexistente", async () => {
    await assert.rejects(() => calcularHashArquivo(path.join(pasta, "nao-existe.bin")));
});

after(async () => {
    await fs.rm(pasta, { recursive: true, force: true });
});
```

`apps/api/src/services/exifFoto.test.ts`:

```ts
import { test, describe } from "node:test";
import assert from "node:assert";
import { combinarDataExif } from "./exifFoto";

describe("combinarDataExif", () => {
    test("sem data original devolve null", () => {
        assert.strictEqual(combinarDataExif(undefined, undefined, "America/Sao_Paulo"), null);
    });

    test("usa o offset do EXIF quando presente", () => {
        // 10:00 local com offset -03:00 -> 13:00 UTC.
        const dataOriginal = new Date(2026, 10, 1, 10, 0, 0);
        const resultado = combinarDataExif(dataOriginal, "-03:00", "America/Sao_Paulo");
        assert.strictEqual(resultado?.toISOString(), "2026-11-01T13:00:00.000Z");
    });

    test("usa o fuso do evento quando falta o offset", () => {
        const dataOriginal = new Date(2026, 10, 1, 10, 0, 0);
        const resultado = combinarDataExif(dataOriginal, undefined, "America/Sao_Paulo");
        assert.strictEqual(resultado?.toISOString(), "2026-11-01T13:00:00.000Z");
    });

    test("offset positivo", () => {
        const dataOriginal = new Date(2026, 5, 15, 8, 30, 0);
        const resultado = combinarDataExif(dataOriginal, "+02:00", "America/Sao_Paulo");
        assert.strictEqual(resultado?.toISOString(), "2026-06-15T06:30:00.000Z");
    });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -w apps/api`
Expected: FAIL — `Cannot find module './caminhos'` (e os demais).

- [ ] **Step 3: Implementar**

Em `apps/api/package.json`, acrescente `"exifr": "^7.1.3"` em `dependencies`; rode `npm install` na raiz.

`apps/api/src/services/caminhos.ts`:

```ts
import path from "node:path";

export function caminhoOriginal(raiz: string, slug: string, dataFoto: string, hash: string): string {
    return path.join(raiz, slug, dataFoto, `${hash}.jpg`);
}

export function caminhoPublicar(raiz: string, idEvento: number, hash: string, tipo: "web" | "thumb" | "previa"): string {
    return path.join(raiz, String(idEvento), `${hash}_${tipo}.jpg`);
}

export function caminhoMarcaDagua(raiz: string, idEvento: number): string {
    return path.join(raiz, `${idEvento}.png`);
}
```

`apps/api/src/services/hashArquivo.ts`:

```ts
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export function calcularHashArquivo(caminho: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = createHash("sha256");
        const leitura = createReadStream(caminho);
        leitura.on("data", (pedaco) => hash.update(pedaco));
        leitura.on("error", reject);
        leitura.on("end", () => resolve(hash.digest("hex")));
    });
}
```

`apps/api/src/services/exifFoto.ts`:

```ts
import exifr from "exifr";

export interface DadosExif {
    dataOriginal?: Date;
    offsetOriginal?: string;
    make?: string;
    model?: string;
}

export async function lerExif(caminho: string): Promise<DadosExif> {
    try {
        const dados = await exifr.parse(caminho, { pick: ["DateTimeOriginal", "OffsetTimeOriginal", "Make", "Model"] });
        return {
            dataOriginal: dados?.DateTimeOriginal instanceof Date ? dados.DateTimeOriginal : undefined,
            offsetOriginal: typeof dados?.OffsetTimeOriginal === "string" ? dados.OffsetTimeOriginal : undefined,
            make: dados?.Make,
            model: dados?.Model,
        };
    } catch {
        // JPEG sem EXIF legível: segue sem essas informações, não é motivo para falhar a etapa.
        return {};
    }
}

function converterOffset(offset: string): number {
    const m = offset.match(/^([+-])(\d{2}):(\d{2})$/);
    if (!m) return 0;
    const sinal = m[1] === "-" ? -1 : 1;
    return sinal * (Number(m[2]) * 60 + Number(m[3]));
}

function offsetDoFuso(fuso: string, aproximado: Date): number {
    const partes = new Intl.DateTimeFormat("en-US", { timeZone: fuso, timeZoneName: "shortOffset" }).formatToParts(aproximado);
    const nome = partes.find((p) => p.type === "timeZoneName")?.value ?? "GMT+0";
    const m = nome.match(/GMT([+-]\d+)(?::(\d+))?/);
    if (!m) return 0;
    const horas = Number(m[1]);
    const minutos = Number(m[2] ?? 0);
    return horas * 60 + (horas < 0 ? -minutos : minutos);
}

// `dataOriginal` vem do exifr como "hora de parede" (os getters locais refletem exatamente os
// números do EXIF, não importa o fuso do processo — é assim que o exifr constrói o Date). Por
// isso lemos com os getters locais, não com os UTC.
export function combinarDataExif(dataOriginal: Date | undefined, offsetOriginal: string | undefined, fuso: string): Date | null {
    if (!dataOriginal) return null;

    const partes = {
        ano: dataOriginal.getFullYear(),
        mes: dataOriginal.getMonth(),
        dia: dataOriginal.getDate(),
        hora: dataOriginal.getHours(),
        min: dataOriginal.getMinutes(),
        seg: dataOriginal.getSeconds(),
    };
    const instanteAproximado = new Date(Date.UTC(partes.ano, partes.mes, partes.dia, partes.hora, partes.min, partes.seg));
    const offsetMin = offsetOriginal ? converterOffset(offsetOriginal) : offsetDoFuso(fuso, instanteAproximado);

    return new Date(instanteAproximado.getTime() - offsetMin * 60_000);
}
```

Em `apps/api/src/services/config.ts`, acrescente ao `iConfig`:

```ts
    raizOriginais: string;
    raizPublicar: string;
```

E no retorno de `carregarConfig`:

```ts
        raizOriginais: env.RAIZ_ORIGINAIS || "/data/originais",
        raizPublicar: env.RAIZ_PUBLICAR || "/data/publicar",
```

Em `.env.estacao.example`, acrescente no fim:

```
# Pastas locais do pipeline de ingestão.
RAIZ_ORIGINAIS=/data/originais
RAIZ_PUBLICAR=/data/publicar
RAIZ_MARCAS=/data/marcas
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -w apps/api`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/caminhos.ts apps/api/src/services/caminhos.test.ts \
        apps/api/src/services/hashArquivo.ts apps/api/src/services/hashArquivo.test.ts \
        apps/api/src/services/exifFoto.ts apps/api/src/services/exifFoto.test.ts \
        apps/api/src/services/config.ts apps/api/package.json .env.estacao.example
git commit -m "feat(api): caminhos, hash e EXIF — utilitários puros da ingestão" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 11: Job `processar-foto` (o pipeline)

**Files:**
- Create: `apps/api/src/services/vision.ts`, `apps/api/src/jobs/processarFoto.ts`
- Test: `apps/api/integracao/jobProcessarFoto.test.ts`
- Modify: `apps/api/src/services/config.ts` (`VISION_URL`, `WORKER_CONCORRENCIA`), `.env.estacao.example`

**Interfaces:**
- Consumes: `ConexaoPostgres` (fase 1), `config` (fase 1/Task 10), `caminhoOriginal`/`caminhoPublicar`/`caminhoMarcaDagua` (Task 10), `lerExif`/`combinarDataExif` (Task 10), `criarFila`/`criarWorker` (Task 9)
- Produces:
  - `services/vision.ts`: `interface RostoDetectado { embedding: number[]; bbox: number[]; det_score: number; kps: number[][]; area_px: number }`, `interface ResultadoDetect { caminho: string; largura?: number; altura?: number; rostos: RostoDetectado[]; erro?: string }`, `detectarRostos(caminhos: string[]): Promise<ResultadoDetect[]>`
  - `jobs/processarFoto.ts`: `interface DadosProcessarFoto { id_evento: number; id_evento_fotografo: number | null; hash_arquivo: string; nome_arquivo: string; origem: string; copiar: boolean }`, `processarFoto(dados: DadosProcessarFoto): Promise<void>`, `iniciarWorkerProcessarFoto(concorrencia: number): void`, `NOME_FILA = "processar-foto"`
  - `config.visionUrl: string` (obrigatório no papel `estacao`), `config.workerConcorrencia: number` (default 16)

O job segue a máquina de etapas da seção 7: cada chamada de `processarFoto` confere `foto.etapa` e só executa o que falta. `UnrecoverableError` (do `bullmq`) marca falha definitiva (arquivo de origem ilegível, ou o vision devolveu `erro` para a própria imagem); qualquer outro erro é passageiro (rede, vision fora do ar) e usa o retry padrão da fila.

- [ ] **Step 1: Escrever o teste**

`apps/api/integracao/jobProcessarFoto.test.ts`:

```ts
import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import express from "express";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { UnrecoverableError } from "bullmq";
import ConexaoPostgres from "../src/db/conexaoPostgres";
import { iniciarConfig, config } from "../src/services/config";
import { processarFoto } from "../src/jobs/processarFoto";

let servidorVision: Server;
let conexao: ConexaoPostgres;
let pastaOrigem: string;
let idEvento: number;

async function criarJpegDeTeste(caminho: string, corSemente: number): Promise<void> {
    await sharp({ create: { width: 200, height: 150, channels: 3, background: { r: corSemente, g: 10, b: 10 } } })
        .jpeg()
        .toFile(caminho);
}

before(async () => {
    const app = express();
    app.use(express.json());
    app.post("/detect", (req, res) => {
        const { caminhos } = req.body as { caminhos: string[] };
        res.json({
            resultados: caminhos.map((caminho) =>
                caminho.includes("ruim")
                    ? { caminho, erro: "arquivo não é um JPEG válido", rostos: [] }
                    : {
                          caminho,
                          largura: 200,
                          altura: 150,
                          rostos: [{ embedding: new Array(512).fill(0.02), bbox: [10, 10, 60, 70], det_score: 0.91, kps: [], area_px: 3000 }],
                      }
            ),
        });
    });
    servidorVision = app.listen(0);
    await new Promise((resolve) => servidorVision.once("listening", resolve));

    pastaOrigem = await fs.mkdtemp(path.join(os.tmpdir(), "processar-foto-teste-"));

    iniciarConfig({
        PAPEL: "estacao",
        POSTGRES_HOST: "127.0.0.1",
        POSTGRES_PORT: "5433",
        POSTGRES_USER: "fotos",
        POSTGRES_PASSWORD: "fotos",
        POSTGRES_DB: "fotos_estacao",
        REDIS_URL: "redis://127.0.0.1:6380",
        ESTACAO_CHAVE: "a".repeat(32),
        VPS_URL: "http://127.0.0.1:1",
        VISION_URL: `http://127.0.0.1:${(servidorVision.address() as AddressInfo).port}`,
        RAIZ_ORIGINAIS: await fs.mkdtemp(path.join(os.tmpdir(), "originais-teste-")),
        RAIZ_PUBLICAR: await fs.mkdtemp(path.join(os.tmpdir(), "publicar-teste-")),
    });

    conexao = new ConexaoPostgres();
    await conexao.open();
    const slug = `evento-processar-${Date.now()}`;
    const [linha] = await conexao.queryParam<{ id_evento: number }>(
        "INSERT INTO evento (nome, slug, tipo, privado, chave_anfitriao, data_fim, config) VALUES ('Teste', ?, 'esportivo', 'N', ?, '2026-12-31', ?) RETURNING id_evento",
        [slug, `anfitriao-${Date.now()}`, JSON.stringify({ marca_dagua: false })]
    );
    idEvento = linha.id_evento;
});

describe("processarFoto", () => {
    test("processa do zero até derivados e enfileira a publicação", async () => {
        const origem = path.join(pastaOrigem, "boa1.jpg");
        await criarJpegDeTeste(origem, 200);
        const hash = "hash-boa-1";

        await processarFoto({ id_evento: idEvento, id_evento_fotografo: null, hash_arquivo: hash, nome_arquivo: "boa1.jpg", origem, copiar: true });

        const [foto] = await conexao.queryParam<{ etapa: string; qtd_rostos: number; caminho_original: string }>(
            "SELECT etapa, qtd_rostos, caminho_original FROM foto WHERE id_evento = ? AND hash_arquivo = ?",
            [idEvento, hash]
        );
        assert.strictEqual(foto.etapa, "derivados");
        assert.strictEqual(foto.qtd_rostos, 1);
        await fs.access(foto.caminho_original); // original copiado (copiar: true) — arquivo de origem continua existindo
        await fs.access(origem);

        const pastaPublicar = path.join(config.raizPublicar, String(idEvento));
        for (const tipo of ["web", "thumb", "previa"]) await fs.access(path.join(pastaPublicar, `${hash}_${tipo}.jpg`));
    });

    test("chamar de novo numa foto já em derivados não reprocessa nem duplica rostos", async () => {
        const origem = path.join(pastaOrigem, "boa2.jpg");
        await criarJpegDeTeste(origem, 210);
        const hash = "hash-boa-2";
        const dados = { id_evento: idEvento, id_evento_fotografo: null, hash_arquivo: hash, nome_arquivo: "boa2.jpg", origem, copiar: true };

        await processarFoto(dados);
        await processarFoto(dados);

        const [foto] = await conexao.queryParam<{ etapa: string }>("SELECT etapa FROM foto WHERE id_evento = ? AND hash_arquivo = ?", [idEvento, hash]);
        const rostos = await conexao.queryParam("SELECT * FROM rosto WHERE id_foto = (SELECT id_foto FROM foto WHERE id_evento = ? AND hash_arquivo = ?)", [
            idEvento,
            hash,
        ]);
        assert.strictEqual(foto.etapa, "derivados");
        assert.strictEqual(rostos.length, 1);
    });

    test("move em vez de copiar quando copiar é false", async () => {
        const origem = path.join(pastaOrigem, "mover.jpg");
        await criarJpegDeTeste(origem, 220);
        const hash = "hash-mover";

        await processarFoto({ id_evento: idEvento, id_evento_fotografo: null, hash_arquivo: hash, nome_arquivo: "mover.jpg", origem, copiar: false });

        await assert.rejects(() => fs.access(origem));
    });

    test("erro do vision na própria imagem lança UnrecoverableError", async () => {
        const origem = path.join(pastaOrigem, "ruim.jpg");
        await criarJpegDeTeste(origem, 230);
        const hash = "hash-ruim";

        await assert.rejects(
            () => processarFoto({ id_evento: idEvento, id_evento_fotografo: null, hash_arquivo: hash, nome_arquivo: "ruim.jpg", origem, copiar: true }),
            UnrecoverableError
        );
    });
});

after(async () => {
    servidorVision?.close();
    await conexao?.close();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:integracao -w apps/api`
Expected: FAIL — `Cannot find module '../src/jobs/processarFoto'`.

- [ ] **Step 3: Implementar**

Em `apps/api/src/services/config.ts`, acrescente ao `iConfig`:

```ts
    visionUrl: string;
    workerConcorrencia: number;
```

Em `OBRIGATORIAS`, acrescente `"VISION_URL"` ao array de `estacao`:

```ts
    estacao: ["VPS_URL", "VISION_URL"],
```

E no retorno de `carregarConfig`:

```ts
        visionUrl: env.VISION_URL ?? "",
        workerConcorrencia: helper.numero(env.WORKER_CONCORRENCIA, 16, "WORKER_CONCORRENCIA"),
```

Isso muda a mensagem de "variáveis faltando" do papel `estacao` em `apps/api/src/services/config.test.ts` — no teste `"estação exige VPS_URL e não exige ARQUIVO_SEGREDO"`, troque o regex para `/faltando para o papel estacao: VPS_URL, VISION_URL$/`. No teste `"lê os valores informados"` (que já usa `PAPEL: "estacao"`), acrescente `VISION_URL: "http://vision:8000"` ao objeto passado para `carregarConfig`.

Em `.env.estacao.example`, acrescente:

```
# URL do vision-service (modo gpu) desta estação.
VISION_URL=http://vision:8000
# Fotos processadas ao mesmo tempo (hash → original → rostos → derivados). A maior parte do tempo é espera pelo vision.
WORKER_CONCORRENCIA=16
```

`apps/api/src/services/vision.ts`:

```ts
import { config } from "./config";

export interface RostoDetectado {
    embedding: number[];
    bbox: number[];
    det_score: number;
    kps: number[][];
    area_px: number;
}

export interface ResultadoDetect {
    caminho: string;
    largura?: number;
    altura?: number;
    rostos: RostoDetectado[];
    erro?: string;
}

export async function detectarRostos(caminhos: string[]): Promise<ResultadoDetect[]> {
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), 30_000);
    try {
        const resposta = await fetch(`${config.visionUrl}/detect`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ caminhos }),
            signal: controlador.signal,
        });
        if (!resposta.ok) throw new Error(`[Vision] respondeu ${resposta.status}`);
        const corpo = (await resposta.json()) as { resultados: ResultadoDetect[] };
        return corpo.resultados;
    } finally {
        clearTimeout(temporizador);
    }
}
```

`apps/api/src/jobs/processarFoto.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { Job, UnrecoverableError } from "bullmq";
import ConexaoPostgres from "../db/conexaoPostgres";
import { config } from "../services/config";
import { caminhoMarcaDagua, caminhoOriginal, caminhoPublicar } from "../services/caminhos";
import { combinarDataExif, lerExif } from "../services/exifFoto";
import { detectarRostos } from "../services/vision";
import { criarFila, criarWorker } from "../services/fila";

const FUSO_PADRAO = "America/Sao_Paulo";
export const NOME_FILA = "processar-foto";
const NOME_FILA_PUBLICAR = "publicar-foto";

export interface DadosProcessarFoto {
    id_evento: number;
    id_evento_fotografo: number | null;
    hash_arquivo: string;
    nome_arquivo: string;
    origem: string;
    copiar: boolean;
}

interface LinhaFotoEstacao {
    id_foto: number;
    etapa: string;
    caminho_original: string | null;
}

async function garantirRegistro(conexao: ConexaoPostgres, dados: DadosProcessarFoto): Promise<LinhaFotoEstacao> {
    await conexao.executeParamCount(
        `INSERT INTO foto (id_evento, id_evento_fotografo, hash_arquivo, nome_arquivo, etapa)
         VALUES (?, ?, ?, ?, 'registrada') ON CONFLICT (id_evento, hash_arquivo) DO NOTHING`,
        [dados.id_evento, dados.id_evento_fotografo, dados.hash_arquivo, dados.nome_arquivo]
    );
    const [linha] = await conexao.queryParam<LinhaFotoEstacao>(
        "SELECT id_foto, etapa, caminho_original FROM foto WHERE id_evento = ? AND hash_arquivo = ?",
        [dados.id_evento, dados.hash_arquivo]
    );
    return linha;
}

async function tamanhoImagem(caminho: string): Promise<{ largura: number; altura: number; bytes: number }> {
    const [meta, stat] = await Promise.all([sharp(caminho).metadata(), fs.stat(caminho)]);
    return { largura: meta.width ?? 0, altura: meta.height ?? 0, bytes: stat.size };
}

async function etapaOriginal(conexao: ConexaoPostgres, idFoto: number, dados: DadosProcessarFoto): Promise<string> {
    const [evento] = await conexao.queryParam<{ slug: string }>("SELECT slug FROM evento WHERE id_evento = ?", [dados.id_evento]);
    const exif = await lerExif(dados.origem).catch(() => ({}));
    const capturadaEm = combinarDataExif(exif.dataOriginal, exif.offsetOriginal, FUSO_PADRAO) ?? new Date();
    const dataFoto = capturadaEm.toISOString().slice(0, 10);
    const destino = caminhoOriginal(config.raizOriginais, evento.slug, dataFoto, dados.hash_arquivo);

    await fs.mkdir(path.dirname(destino), { recursive: true });
    try {
        if (dados.copiar) await fs.copyFile(dados.origem, destino);
        else await fs.rename(dados.origem, destino);
    } catch (erro) {
        throw new UnrecoverableError(`[ProcessarFoto] não foi possível ler o arquivo de origem: ${(erro as Error).message}`);
    }

    const { largura, altura, bytes } = await tamanhoImagem(destino);
    const camera = exif.make || exif.model ? [exif.make, exif.model].filter(Boolean).join(" ") : null;
    await conexao.executeParamCount(
        `UPDATE foto SET caminho_original = ?, largura = ?, altura = ?, bytes_original = ?, camera = ?, capturada_em = ?, etapa = 'original'
         WHERE id_foto = ?`,
        [destino, largura, altura, bytes, camera, capturadaEm.toISOString(), idFoto]
    );
    return destino;
}

async function etapaRostos(idFoto: number, idEvento: number, caminhoArquivo: string): Promise<void> {
    const [resultado] = await detectarRostos([caminhoArquivo]);
    if (resultado.erro) throw new UnrecoverableError(`[ProcessarFoto] vision recusou a imagem: ${resultado.erro}`);

    const transacao = new ConexaoPostgres();
    await transacao.openTransaction();
    try {
        await transacao.executeParamCount("DELETE FROM rosto WHERE id_foto = ?", [idFoto]);
        for (const rosto of resultado.rostos)
            await transacao.executeParamCount(
                "INSERT INTO rosto (id_foto, id_evento, embedding, bbox, det_score, area_px) VALUES (?, ?, ?::vector, ?, ?, ?)",
                [idFoto, idEvento, `[${rosto.embedding.join(",")}]`, JSON.stringify(rosto.bbox), rosto.det_score, rosto.area_px]
            );
        await transacao.executeParamCount("UPDATE foto SET qtd_rostos = ?, etapa = 'rostos' WHERE id_foto = ?", [resultado.rostos.length, idFoto]);
    } catch (erro) {
        transacao.marcarErro();
        throw erro;
    } finally {
        await transacao.close();
    }
}

async function etapaDerivados(conexao: ConexaoPostgres, idFoto: number, idEvento: number, hash: string, caminhoArquivo: string): Promise<void> {
    const [evento] = await conexao.queryParam<{ config: { marca_dagua?: boolean } }>("SELECT config FROM evento WHERE id_evento = ?", [idEvento]);
    const caminhoMarca = evento?.config?.marca_dagua ? caminhoMarcaDagua(config.raizMarcas, idEvento) : null;
    const temMarca = caminhoMarca
        ? await fs
              .access(caminhoMarca)
              .then(() => true)
              .catch(() => false)
        : false;

    const pasta = path.dirname(caminhoPublicar(config.raizPublicar, idEvento, hash, "web"));
    await fs.mkdir(pasta, { recursive: true });

    async function gerar(largura: number, qualidade: number, tipo: "web" | "thumb" | "previa", blur?: number): Promise<number> {
        let pipeline = sharp(caminhoArquivo).rotate().resize({ width: largura, fit: "inside", withoutEnlargement: true });
        if (blur) pipeline = pipeline.blur(blur);
        if (temMarca && caminhoMarca && tipo !== "previa") pipeline = pipeline.composite([{ input: caminhoMarca, gravity: "southeast" }]);
        const buffer = await pipeline.jpeg({ quality: qualidade, progressive: true, mozjpeg: true }).toBuffer();
        await fs.writeFile(caminhoPublicar(config.raizPublicar, idEvento, hash, tipo), buffer);
        return buffer.length;
    }

    const bytesWeb = await gerar(2048, 82, "web");
    await gerar(400, 70, "thumb");
    await gerar(32, 50, "previa", 20);

    await conexao.executeParamCount("UPDATE foto SET bytes_web = ?, etapa = 'derivados', processada_em = now() WHERE id_foto = ?", [bytesWeb, idFoto]);
}

async function enfileirarPublicacao(idEvento: number, hash: string): Promise<void> {
    const fila = criarFila(NOME_FILA_PUBLICAR);
    await fila.add(NOME_FILA_PUBLICAR, { id_evento: idEvento, hash_arquivo: hash }, { jobId: `${idEvento}:${hash}`, attempts: 1000, backoff: { type: "custom" } });
}

export async function processarFoto(dados: DadosProcessarFoto): Promise<void> {
    const conexao = new ConexaoPostgres();
    await conexao.open();
    try {
        const registro = await garantirRegistro(conexao, dados);

        let caminhoAtual = registro.caminho_original;
        let etapa = registro.etapa;

        if (etapa === "registrada") {
            caminhoAtual = await etapaOriginal(conexao, registro.id_foto, dados);
            etapa = "original";
        }
        if (!caminhoAtual) throw new Error("[ProcessarFoto] etapa original sem caminho_original gravado");

        if (etapa === "original") {
            await etapaRostos(registro.id_foto, dados.id_evento, caminhoAtual);
            etapa = "rostos";
        }
        if (etapa === "rostos") {
            await etapaDerivados(conexao, registro.id_foto, dados.id_evento, dados.hash_arquivo, caminhoAtual);
        }

        await enfileirarPublicacao(dados.id_evento, dados.hash_arquivo);
    } finally {
        await conexao.close();
    }
}

// Falha definitiva (UnrecoverableError) grava na hora; falha passageira só grava quando a
// última tentativa também falhou — as anteriores apenas alimentam o backoff da fila.
async function registrarFalha(dados: DadosProcessarFoto, erro: Error): Promise<void> {
    const conexao = new ConexaoPostgres();
    await conexao.open();
    try {
        const [atual] = await conexao.queryParam<{ etapa: string }>("SELECT etapa FROM foto WHERE id_evento = ? AND hash_arquivo = ?", [
            dados.id_evento,
            dados.hash_arquivo,
        ]);
        await conexao.executeParamCount("UPDATE foto SET erro = ?, erro_etapa = ? WHERE id_evento = ? AND hash_arquivo = ?", [
            erro.message,
            atual?.etapa ?? null,
            dados.id_evento,
            dados.hash_arquivo,
        ]);
    } finally {
        await conexao.close();
    }
}

export function iniciarWorkerProcessarFoto(concorrencia: number): void {
    const worker = criarWorker<DadosProcessarFoto>(NOME_FILA, (job: Job<DadosProcessarFoto>) => processarFoto(job.data), concorrencia);
    worker.on("failed", (job, erro) => {
        if (!job) return;
        const esgotouTentativas = job.attemptsMade >= (job.opts.attempts ?? 1);
        if (erro instanceof UnrecoverableError || esgotouTentativas) {
            registrarFalha(job.data, erro).catch((erroAoGravar) =>
                console.error(`[ProcessarFoto] falha ao gravar o erro de ${job.data.id_evento}:${job.data.hash_arquivo}:`, erroAoGravar)
            );
        }
    });
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -w apps/api && npm run test:integracao -w apps/api`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/vision.ts apps/api/src/jobs/processarFoto.ts apps/api/integracao/jobProcessarFoto.test.ts \
        apps/api/src/services/config.ts apps/api/src/services/config.test.ts .env.estacao.example
git commit -m "feat(api): job processar-foto — original, rostos e derivados" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 12: Job `publicar-foto`

**Files:**
- Create: `apps/api/src/jobs/publicarFoto.ts`
- Test: `apps/api/integracao/jobPublicarFoto.test.ts`
- Modify: `apps/api/src/services/vpsHttp.ts` (acrescenta `chamarVpsMultipart`)

**Interfaces:**
- Consumes: `ConexaoPostgres` (fase 1), `config.raizPublicar` (Task 10), `caminhoPublicar` (Task 10), `criarWorker` (Task 9)
- Produces: `chamarVpsMultipart(caminho: string, corpo: FormData, timeoutMs?: number): Promise<unknown>`, `interface DadosPublicarFotoJob { id_evento: number; hash_arquivo: string }`, `publicarFoto(dados: DadosPublicarFotoJob): Promise<void>`, `iniciarWorkerPublicarFoto(concorrencia?: number): void`, `NOME_FILA = "publicar-foto"`, `CONCORRENCIA_PADRAO = 4`

O `rosto.embedding` volta do Postgres como texto (`"[0.1,0.2,...]"`) — o driver `pg` não conhece o tipo `vector`. `publicarFoto` converte de volta para `number[]` antes de mandar para a VPS.

- [ ] **Step 1: Escrever o teste**

`apps/api/integracao/jobPublicarFoto.test.ts`:

```ts
import { test, before, after } from "node:test";
import assert from "node:assert";
import express from "express";
import fileUpload from "express-fileupload";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ConexaoPostgres from "../src/db/conexaoPostgres";
import { iniciarConfig, config } from "../src/services/config";
import { publicarFoto } from "../src/jobs/publicarFoto";
import { caminhoPublicar } from "../src/services/caminhos";

let servidorVps: Server;
let ultimoRecebido: { dados: unknown; arquivos: string[] } | undefined;
let conexao: ConexaoPostgres;
let idEvento: number;

before(async () => {
    const app = express();
    app.use(fileUpload());
    app.post("/api/estacao/foto", (req, res) => {
        ultimoRecebido = { dados: JSON.parse(req.body.dados), arquivos: Object.keys(req.files ?? {}) };
        res.json({ ok: true });
    });
    servidorVps = app.listen(0);
    await new Promise((resolve) => servidorVps.once("listening", resolve));

    const raizPublicar = await fs.mkdtemp(path.join(os.tmpdir(), "publicar-job-teste-"));

    iniciarConfig({
        PAPEL: "estacao",
        POSTGRES_HOST: "127.0.0.1",
        POSTGRES_PORT: "5433",
        POSTGRES_USER: "fotos",
        POSTGRES_PASSWORD: "fotos",
        POSTGRES_DB: "fotos_estacao",
        REDIS_URL: "redis://127.0.0.1:6380",
        ESTACAO_CHAVE: "a".repeat(32),
        VPS_URL: `http://127.0.0.1:${(servidorVps.address() as AddressInfo).port}`,
        VISION_URL: "http://127.0.0.1:1",
        RAIZ_PUBLICAR: raizPublicar,
    });

    conexao = new ConexaoPostgres();
    await conexao.open();
    const slug = `evento-publicar-job-${Date.now()}`;
    const [evento] = await conexao.queryParam<{ id_evento: number }>(
        "INSERT INTO evento (nome, slug, tipo, privado, chave_anfitriao, data_fim, config) VALUES ('Teste', ?, 'esportivo', 'N', ?, '2026-12-31', '{}') RETURNING id_evento",
        [slug, `anfitriao-${Date.now()}`]
    );
    idEvento = evento.id_evento;
});

test("lê os rostos locais, envia o multipart e marca como publicada", async () => {
    const hash = `hash-publicar-${Date.now()}`;
    const [foto] = await conexao.queryParam<{ id_foto: number }>(
        `INSERT INTO foto (id_evento, hash_arquivo, nome_arquivo, largura, altura, bytes_web, capturada_em, camera, qtd_rostos, etapa)
         VALUES (?, ?, 'x.jpg', 4000, 3000, 12345, now(), 'Canon', 1, 'derivados') RETURNING id_foto`,
        [idEvento, hash]
    );
    await conexao.executeParamCount("INSERT INTO rosto (id_foto, id_evento, embedding, bbox, det_score, area_px) VALUES (?, ?, ?::vector, ?, ?, ?)", [
        foto.id_foto,
        idEvento,
        `[${new Array(512).fill(0.03).join(",")}]`,
        JSON.stringify([1, 2, 3, 4]),
        0.88,
        4000,
    ]);

    const pasta = path.dirname(caminhoPublicar(config.raizPublicar, idEvento, hash, "web"));
    await fs.mkdir(pasta, { recursive: true });
    for (const tipo of ["web", "thumb", "previa"] as const) await fs.writeFile(caminhoPublicar(config.raizPublicar, idEvento, hash, tipo), `conteudo-${tipo}`);

    await publicarFoto({ id_evento: idEvento, hash_arquivo: hash });

    assert.deepStrictEqual(ultimoRecebido?.arquivos.sort(), ["previa", "thumb", "web"]);
    const dadosRecebidos = ultimoRecebido?.dados as { rostos: { embedding: number[] }[]; camera: string };
    assert.strictEqual(dadosRecebidos.rostos.length, 1);
    assert.strictEqual(dadosRecebidos.rostos[0].embedding.length, 512);
    assert.strictEqual(dadosRecebidos.camera, "Canon");

    const [depois] = await conexao.queryParam<{ etapa: string; publicada_em: string }>("SELECT etapa, publicada_em FROM foto WHERE id_foto = ?", [foto.id_foto]);
    assert.strictEqual(depois.etapa, "publicada");
    assert.ok(depois.publicada_em);

    for (const tipo of ["web", "thumb", "previa"] as const)
        await assert.rejects(() => fs.access(caminhoPublicar(config.raizPublicar, idEvento, hash, tipo)));
});

after(async () => {
    servidorVps?.close();
    await conexao?.close();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:integracao -w apps/api`
Expected: FAIL — `Cannot find module '../src/jobs/publicarFoto'`.

- [ ] **Step 3: Implementar**

Em `apps/api/src/services/vpsHttp.ts`, acrescente:

```ts
export async function chamarVpsMultipart(caminho: string, corpo: FormData, timeoutMs = 30_000): Promise<unknown> {
    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), timeoutMs);
    try {
        const resposta = await fetch(`${config.vpsUrl}${caminho}`, {
            method: "POST",
            headers: { Authorization: config.estacaoChave },
            body: corpo,
            signal: controlador.signal,
        });
        const dados = await resposta.json();
        if (!resposta.ok) throw new Error(`VPS respondeu ${resposta.status} em ${caminho}: ${JSON.stringify(dados)}`);
        return dados;
    } finally {
        clearTimeout(temporizador);
    }
}
```

`apps/api/src/jobs/publicarFoto.ts`:

```ts
import fs from "node:fs/promises";
import { Job } from "bullmq";
import ConexaoPostgres from "../db/conexaoPostgres";
import { config } from "../services/config";
import { caminhoPublicar } from "../services/caminhos";
import { chamarVpsMultipart } from "../services/vpsHttp";
import { criarWorker } from "../services/fila";

export const NOME_FILA = "publicar-foto";
export const CONCORRENCIA_PADRAO = 4;

export interface DadosPublicarFotoJob {
    id_evento: number;
    hash_arquivo: string;
}

interface LinhaFotoLocal {
    id_foto: number;
    id_evento_fotografo: number | null;
    largura: number;
    altura: number;
    bytes_web: number;
    capturada_em: string | null;
    camera: string | null;
}

interface LinhaRostoLocal {
    embedding: string;
    bbox: unknown;
    det_score: number;
    area_px: number;
}

function parseVetor(bruto: string): number[] {
    return bruto.slice(1, -1).split(",").map(Number);
}

export async function publicarFoto(dados: DadosPublicarFotoJob): Promise<void> {
    const conexao = new ConexaoPostgres();
    await conexao.open();
    try {
        const [foto] = await conexao.queryParam<LinhaFotoLocal>(
            "SELECT id_foto, id_evento_fotografo, largura, altura, bytes_web, capturada_em, camera FROM foto WHERE id_evento = ? AND hash_arquivo = ?",
            [dados.id_evento, dados.hash_arquivo]
        );
        if (!foto) throw new Error(`[PublicarFoto] foto não encontrada localmente: ${dados.id_evento}:${dados.hash_arquivo}`);

        const rostos = await conexao.queryParam<LinhaRostoLocal>("SELECT embedding, bbox, det_score, area_px FROM rosto WHERE id_foto = ?", [foto.id_foto]);

        const corpo = new FormData();
        corpo.append("call", "publicarFoto");
        corpo.append(
            "dados",
            JSON.stringify({
                id_evento: dados.id_evento,
                id_evento_fotografo: foto.id_evento_fotografo,
                hash_arquivo: dados.hash_arquivo,
                largura: foto.largura,
                altura: foto.altura,
                bytes_web: foto.bytes_web,
                capturada_em: foto.capturada_em,
                camera: foto.camera,
                rostos: rostos.map((r) => ({ embedding: parseVetor(r.embedding), bbox: r.bbox, det_score: r.det_score, area_px: r.area_px })),
            })
        );

        for (const tipo of ["web", "thumb", "previa"] as const) {
            const caminho = caminhoPublicar(config.raizPublicar, dados.id_evento, dados.hash_arquivo, tipo);
            corpo.append(tipo, new Blob([await fs.readFile(caminho)]), `${tipo}.jpg`);
        }

        await chamarVpsMultipart("/api/estacao/foto", corpo);

        await conexao.executeParamCount("UPDATE foto SET etapa = 'publicada', publicada_em = now() WHERE id_foto = ?", [foto.id_foto]);
        await Promise.all(
            (["web", "thumb", "previa"] as const).map((tipo) =>
                fs.unlink(caminhoPublicar(config.raizPublicar, dados.id_evento, dados.hash_arquivo, tipo)).catch(() => {})
            )
        );
    } finally {
        await conexao.close();
    }
}

export function iniciarWorkerPublicarFoto(concorrencia = CONCORRENCIA_PADRAO): void {
    criarWorker<DadosPublicarFotoJob>(NOME_FILA, (job: Job<DadosPublicarFotoJob>) => publicarFoto(job.data), concorrencia);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:integracao -w apps/api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/jobs/publicarFoto.ts apps/api/integracao/jobPublicarFoto.test.ts apps/api/src/services/vpsHttp.ts
git commit -m "feat(api): job publicar-foto" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 13: CLI `ingerir`

**Files:**
- Create: `apps/api/src/scripts/ingerir.ts`
- Test: `apps/api/integracao/ingerir.test.ts`
- Modify: `apps/api/package.json` (script `ingerir`)

**Interfaces:**
- Consumes: `ConexaoPostgres`, `iniciarConfig` (fase 1), `calcularHashArquivo` (Task 10), `criarFila` (Task 9), `DadosProcessarFoto`/`NOME_FILA` (Task 11)
- Produces: `ingerir(conexao: ConexaoPostgres, opcoes: { slug: string; pasta: string; idEventoFotografo: number | null }): Promise<{ enfileiradas: number; ignoradas: number }>`; comando `npm run ingerir -w apps/api -- --evento <slug> --pasta <dir> [--fotografo <id_evento_fotografo>]`

Varre só o nível raiz de `--pasta` (sem subpastas), arquivos `.jpg`/`.jpeg`/`.JPG`/`.JPEG`. `ignoradas` conta arquivos cujo hash já existe na fila (evita reenfileirar em duas execuções seguidas na mesma pasta) — a checagem definitiva de duplicata é o `ON CONFLICT` do `processarFoto` (Task 11); aqui é só para não imprimir números enganosos.

- [ ] **Step 1: Escrever o teste**

`apps/api/integracao/ingerir.test.ts`:

```ts
import { test, before, after } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ConexaoPostgres from "../src/db/conexaoPostgres";
import { iniciarConfig } from "../src/services/config";
import { criarFila } from "../src/services/fila";
import { NOME_FILA } from "../src/jobs/processarFoto";
import { ingerir } from "../src/scripts/ingerir";

let conexao: ConexaoPostgres;
let pasta: string;
let slug: string;

before(async () => {
    iniciarConfig({
        PAPEL: "estacao",
        POSTGRES_HOST: "127.0.0.1",
        POSTGRES_PORT: "5433",
        POSTGRES_USER: "fotos",
        POSTGRES_PASSWORD: "fotos",
        POSTGRES_DB: "fotos_estacao",
        REDIS_URL: "redis://127.0.0.1:6380",
        ESTACAO_CHAVE: "a".repeat(32),
        VPS_URL: "http://127.0.0.1:1",
        VISION_URL: "http://127.0.0.1:1",
    });

    conexao = new ConexaoPostgres();
    await conexao.open();
    slug = `evento-ingerir-${Date.now()}`;
    await conexao.executeParamCount(
        "INSERT INTO evento (nome, slug, tipo, privado, chave_anfitriao, data_fim, config) VALUES ('Teste', ?, 'esportivo', 'N', ?, '2026-12-31', '{}')",
        [slug, `anfitriao-${Date.now()}`]
    );

    pasta = await fs.mkdtemp(path.join(os.tmpdir(), "ingerir-teste-"));
    await fs.writeFile(path.join(pasta, "a.jpg"), "conteudo-a");
    await fs.writeFile(path.join(pasta, "b.JPG"), "conteudo-b");
    await fs.writeFile(path.join(pasta, "nao-e-foto.txt"), "ignorar");
    await fs.mkdir(path.join(pasta, "subpasta"));
    await fs.writeFile(path.join(pasta, "subpasta", "c.jpg"), "nao deve entrar");
});

test("enfileira só os JPEGs do nível raiz", async () => {
    const [evento] = await conexao.queryParam<{ id_evento: number }>("SELECT id_evento FROM evento WHERE slug = ?", [slug]);
    const resultado = await ingerir(conexao, { slug, pasta, idEventoFotografo: null });

    assert.strictEqual(resultado.enfileiradas, 2);

    const fila = criarFila(NOME_FILA);
    const aguardando = await fila.getWaiting();
    const jobsDoEvento = aguardando.filter((job) => job.data.id_evento === evento.id_evento);
    assert.strictEqual(jobsDoEvento.length, 2);
    assert.ok(jobsDoEvento.every((job) => job.data.copiar === true));
});

test("recusa evento inexistente", async () => {
    await assert.rejects(() => ingerir(conexao, { slug: "nao-existe-mesmo", pasta, idEventoFotografo: null }));
});

after(async () => {
    await conexao?.close();
    await fs.rm(pasta, { recursive: true, force: true });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:integracao -w apps/api`
Expected: FAIL — `Cannot find module '../src/scripts/ingerir'`.

- [ ] **Step 3: Implementar**

`apps/api/src/scripts/ingerir.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import "../loadEnv";
import { iniciarConfig } from "../services/config";
import ConexaoPostgres from "../db/conexaoPostgres";
import { calcularHashArquivo } from "../services/hashArquivo";
import { criarFila } from "../services/fila";
import { DadosProcessarFoto, NOME_FILA } from "../jobs/processarFoto";

const EXTENSOES = new Set([".jpg", ".jpeg"]);

export async function ingerir(
    conexao: ConexaoPostgres,
    opcoes: { slug: string; pasta: string; idEventoFotografo: number | null }
): Promise<{ enfileiradas: number; ignoradas: number }> {
    const evento = await conexao.queryOneParam<{ id_evento: number }>("SELECT id_evento FROM evento WHERE slug = ?", [opcoes.slug]);
    if (!evento) throw new Error(`[Ingerir] evento não encontrado localmente: ${opcoes.slug} (rode a sincronização primeiro)`);

    const entradas = await fs.readdir(opcoes.pasta, { withFileTypes: true });
    const arquivos = entradas.filter((e) => e.isFile() && EXTENSOES.has(path.extname(e.name).toLowerCase()));

    const fila = criarFila<DadosProcessarFoto>(NOME_FILA);
    let enfileiradas = 0;
    let ignoradas = 0;

    for (const arquivo of arquivos) {
        const origem = path.join(opcoes.pasta, arquivo.name);
        const hash = await calcularHashArquivo(origem);
        const jobId = `${evento.id_evento}:${hash}`;

        // `fila.add` com um jobId existente devolve o job já existente em vez de lançar erro —
        // checar antes é a única forma de saber se era mesmo novo, para o resumo ficar correto.
        if (await fila.getJob(jobId)) {
            ignoradas++;
            continue;
        }

        const dados: DadosProcessarFoto = {
            id_evento: evento.id_evento,
            id_evento_fotografo: opcoes.idEventoFotografo,
            hash_arquivo: hash,
            nome_arquivo: arquivo.name,
            origem,
            copiar: true,
        };
        await fila.add(NOME_FILA, dados, { jobId, attempts: 5, backoff: { type: "exponential", delay: 1000 } });
        enfileiradas++;
    }

    return { enfileiradas, ignoradas };
}

function argumento(nome: string): string | undefined {
    const idx = process.argv.indexOf(`--${nome}`);
    return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main(): Promise<void> {
    const slug = argumento("evento");
    const pasta = argumento("pasta");
    if (!slug || !pasta) {
        console.error("[Ingerir] Uso: npm run ingerir -w apps/api -- --evento <slug> --pasta <dir> [--fotografo <id_evento_fotografo>]");
        process.exit(1);
    }

    iniciarConfig(process.env);
    const conexao = new ConexaoPostgres();
    await conexao.open();
    try {
        const fotografoArg = argumento("fotografo");
        const resultado = await ingerir(conexao, { slug, pasta, idEventoFotografo: fotografoArg ? Number(fotografoArg) : null });
        console.log(`[Ingerir] ${resultado.enfileiradas} fotos enfileiradas para "${slug}" (${resultado.ignoradas} já estavam na fila).`);
    } finally {
        await conexao.close();
    }
}

if (require.main === module) {
    main().catch((erro) => {
        console.error("[Ingerir] Falhou:", erro instanceof Error ? erro.message : erro);
        process.exit(1);
    });
}
```

Em `apps/api/package.json`, acrescente em `scripts`:

```json
        "ingerir": "tsx src/scripts/ingerir.ts"
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test:integracao -w apps/api`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/scripts/ingerir.ts apps/api/integracao/ingerir.test.ts apps/api/package.json
git commit -m "feat(api): CLI ingerir" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 14: Métricas e sinal periódico (estação)

**Files:**
- Create: `apps/api/src/services/metricas.ts`, `apps/api/src/jobs/sinal.ts`
- Test: `apps/api/src/services/metricas.test.ts` (pura), `apps/api/integracao/sinal.test.ts`

**Interfaces:**
- Consumes: `ConexaoPostgres` (fase 1), `config.visionUrl` (Task 11), `chamarVps` (Task 9), `criarFila` (Task 9), `NOME_FILA` de `processarFoto` (Task 11) e `publicarFoto` (Task 12)
- Produces:
  - `percentil(valores: number[], p: number): number` (pura)
  - `interface MetricasFila { por_etapa: Record<string, number>; fotos_min: { 1: number; 5: number; 15: number }; taxa_erro: number; latencia_ms: { p50: number; p95: number } }`, `obterMetricasFila(conexao): Promise<MetricasFila>`
  - `montarSinal(conexao): Promise<Record<string, unknown>>`, `iniciarSinalPeriodico(): NodeJS.Timeout` — a cada 30s, tolerante a falha (só loga)

- [ ] **Step 1: Escrever o teste puro**

`apps/api/src/services/metricas.test.ts`:

```ts
import { test, describe } from "node:test";
import assert from "node:assert";
import { percentil } from "./metricas";

describe("percentil", () => {
    test("lista vazia devolve 0", () => {
        assert.strictEqual(percentil([], 95), 0);
    });

    test("p50 de uma lista ímpar é a mediana", () => {
        assert.strictEqual(percentil([5, 1, 3, 2, 4], 50), 3);
    });

    test("p95 puxa para o maior valor em amostras pequenas", () => {
        assert.strictEqual(percentil([10, 20, 30, 40, 50], 95), 50);
    });

    test("não depende da ordem de entrada", () => {
        assert.strictEqual(percentil([100, 1, 50], 50), percentil([1, 50, 100], 50));
    });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -w apps/api`
Expected: FAIL — `Cannot find module './metricas'`.

- [ ] **Step 3: Implementar**

`apps/api/src/services/metricas.ts`:

```ts
import ConexaoPostgres from "../db/conexaoPostgres";

export function percentil(valores: number[], p: number): number {
    if (valores.length === 0) return 0;
    const ordenados = [...valores].sort((a, b) => a - b);
    const indice = Math.min(ordenados.length, Math.max(1, Math.ceil((p / 100) * ordenados.length))) - 1;
    return ordenados[indice];
}

export interface MetricasFila {
    por_etapa: Record<string, number>;
    fotos_min: { 1: number; 5: number; 15: number };
    taxa_erro: number;
    latencia_ms: { p50: number; p95: number };
}

export async function obterMetricasFila(conexao: ConexaoPostgres): Promise<MetricasFila> {
    const porEtapaLinhas = await conexao.queryParam<{ etapa: string; quantidade: number }>(
        "SELECT etapa, count(*)::int AS quantidade FROM foto WHERE etapa <> 'publicada' GROUP BY etapa"
    );
    const por_etapa = Object.fromEntries(porEtapaLinhas.map((l) => [l.etapa, l.quantidade]));

    const fotos_min = { 1: 0, 5: 0, 15: 0 } as { 1: number; 5: number; 15: number };
    for (const janela of [1, 5, 15] as const) {
        const [linha] = await conexao.queryParam<{ quantidade: number }>(
            "SELECT count(*)::int AS quantidade FROM foto WHERE publicada_em > now() - (? || ' minutes')::interval",
            [String(janela)]
        );
        fotos_min[janela] = Math.round(linha.quantidade / janela);
    }

    const [erroLinha] = await conexao.queryParam<{ com_erro: number; total: number }>(
        "SELECT count(*) FILTER (WHERE erro IS NOT NULL)::int AS com_erro, count(*)::int AS total FROM foto WHERE criado_em > now() - interval '30 minutes'"
    );
    const taxa_erro = erroLinha.total > 0 ? erroLinha.com_erro / erroLinha.total : 0;

    const latenciaLinhas = await conexao.queryParam<{ latencia_ms: string }>(
        `SELECT EXTRACT(EPOCH FROM (publicada_em - criado_em)) * 1000 AS latencia_ms FROM foto
          WHERE publicada_em IS NOT NULL AND publicada_em > now() - interval '30 minutes'`
    );
    const valoresLatencia = latenciaLinhas.map((l) => Number(l.latencia_ms));

    return { por_etapa, fotos_min, taxa_erro, latencia_ms: { p50: percentil(valoresLatencia, 50), p95: percentil(valoresLatencia, 95) } };
}
```

`apps/api/src/jobs/sinal.ts`:

```ts
import ConexaoPostgres from "../db/conexaoPostgres";
import { config } from "../services/config";
import { chamarVps } from "../services/vpsHttp";
import { criarFila } from "../services/fila";
import { obterMetricasFila } from "../services/metricas";
import { NOME_FILA as FILA_PROCESSAR } from "./processarFoto";
import { NOME_FILA as FILA_PUBLICAR } from "./publicarFoto";

async function lerGpu(): Promise<unknown> {
    try {
        const resposta = await fetch(`${config.visionUrl}/health`, { signal: AbortSignal.timeout(5000) });
        if (!resposta.ok) return null;
        const corpo = (await resposta.json()) as { gpu: unknown };
        return corpo.gpu ?? null;
    } catch {
        return null;
    }
}

export async function montarSinal(conexao: ConexaoPostgres): Promise<Record<string, unknown>> {
    const [metricas, contagemProcessar, contagemPublicar, gpu] = await Promise.all([
        obterMetricasFila(conexao),
        criarFila(FILA_PROCESSAR).getJobCounts(),
        criarFila(FILA_PUBLICAR).getJobCounts(),
        lerGpu(),
    ]);

    return { fila_bullmq: { processar_foto: contagemProcessar, publicar_foto: contagemPublicar }, ...metricas, gpu };
}

export function iniciarSinalPeriodico(): NodeJS.Timeout {
    return setInterval(async () => {
        const conexao = new ConexaoPostgres();
        try {
            await conexao.open();
            const sinal = await montarSinal(conexao);
            await chamarVps("/api/estacao/sinal", { call: "registrarSinal", ...sinal });
        } catch (erro) {
            console.error("[Sinal] Falha ao enviar o sinal:", erro instanceof Error ? erro.message : erro);
        } finally {
            await conexao.close().catch(() => {});
        }
    }, 30_000);
}
```

- [ ] **Step 4: Escrever o teste de integração**

`apps/api/integracao/sinal.test.ts`:

```ts
import { test, before, after } from "node:test";
import assert from "node:assert";
import express from "express";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import ConexaoPostgres from "../src/db/conexaoPostgres";
import { iniciarConfig } from "../src/services/config";
import { obterMetricasFila } from "../src/services/metricas";
import { montarSinal } from "../src/jobs/sinal";

let servidorVision: Server;
let conexao: ConexaoPostgres;
let idEvento: number;

before(async () => {
    const app = express();
    app.get("/health", (_req, res) => res.json({ gpu: { vram_usada_mb: 1000, vram_total_mb: 12282, utilizacao: 10 } }));
    servidorVision = app.listen(0);
    await new Promise((resolve) => servidorVision.once("listening", resolve));

    iniciarConfig({
        PAPEL: "estacao",
        POSTGRES_HOST: "127.0.0.1",
        POSTGRES_PORT: "5433",
        POSTGRES_USER: "fotos",
        POSTGRES_PASSWORD: "fotos",
        POSTGRES_DB: "fotos_estacao",
        REDIS_URL: "redis://127.0.0.1:6380",
        ESTACAO_CHAVE: "a".repeat(32),
        VPS_URL: "http://127.0.0.1:1",
        VISION_URL: `http://127.0.0.1:${(servidorVision.address() as AddressInfo).port}`,
    });

    conexao = new ConexaoPostgres();
    await conexao.open();
    const slug = `evento-metricas-${Date.now()}`;
    const [evento] = await conexao.queryParam<{ id_evento: number }>(
        "INSERT INTO evento (nome, slug, tipo, privado, chave_anfitriao, data_fim, config) VALUES ('Teste', ?, 'esportivo', 'N', ?, '2026-12-31', '{}') RETURNING id_evento",
        [slug, `anfitriao-${Date.now()}`]
    );
    idEvento = evento.id_evento;

    await conexao.executeParamCount(
        "INSERT INTO foto (id_evento, hash_arquivo, nome_arquivo, etapa) VALUES (?, 'h1', 'a.jpg', 'rostos'), (?, 'h2', 'b.jpg', 'derivados')",
        [idEvento, idEvento]
    );
    await conexao.executeParamCount(
        "INSERT INTO foto (id_evento, hash_arquivo, nome_arquivo, etapa, publicada_em, criado_em) VALUES (?, 'h3', 'c.jpg', 'publicada', now(), now() - interval '10 seconds')",
        [idEvento]
    );
    await conexao.executeParamCount("INSERT INTO foto (id_evento, hash_arquivo, nome_arquivo, etapa, erro, erro_etapa) VALUES (?, 'h4', 'd.jpg', 'original', 'falhou', 'original')", [
        idEvento,
    ]);
});

test("obterMetricasFila conta por etapa, fotos/min e taxa de erro", async () => {
    const metricas = await obterMetricasFila(conexao);
    assert.strictEqual(metricas.por_etapa.rostos, 1);
    assert.strictEqual(metricas.por_etapa.derivados, 1);
    assert.strictEqual(metricas.por_etapa.publicada, undefined);
    assert.ok(metricas.fotos_min[1] >= 1);
    assert.ok(metricas.taxa_erro > 0);
});

test("montarSinal combina fila BullMQ, métricas e GPU", async () => {
    const sinal = await montarSinal(conexao);
    assert.ok(sinal.fila_bullmq);
    assert.deepStrictEqual(sinal.gpu, { vram_usada_mb: 1000, vram_total_mb: 12282, utilizacao: 10 });
});

after(async () => {
    servidorVision?.close();
    await conexao?.close();
});
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm run test -w apps/api && npm run test:integracao -w apps/api`
Expected: todos PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/metricas.ts apps/api/src/services/metricas.test.ts apps/api/src/jobs/sinal.ts apps/api/integracao/sinal.test.ts
git commit -m "feat(api): métricas e sinal periódico (estação)" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 15: Entrada do processo `worker` e composes

**Files:**
- Create: `apps/api/src/worker.ts`
- Modify: `docker-compose.estacao.yml`, `docker-compose.vps.yml`, `docker-compose.dev.yml`

**Interfaces:**
- Consumes: `iniciarConfig`/`config`/`fecharBanco` (fase 1), `fecharFila` (Task 9), `iniciarWorkerProcessarFoto` (Task 11), `iniciarWorkerPublicarFoto` (Task 12), `iniciarWorkerSincronizar`/`agendarSincronizacao` (Task 9), `iniciarSinalPeriodico` (Task 14)
- Produces: processo `worker` (`node dist/worker.js`), volumes `originais` (agora também montado sem `:ro` no `worker`), `publicar`, `marcas` na estação; `fotos`, `marcas` na VPS

Sem teste automatizado — este arquivo só liga o que as tasks anteriores já testaram. A verificação é rodar o compose de dev e olhar o log.

- [ ] **Step 1: Entrada do processo**

`apps/api/src/worker.ts`:

```ts
import "./loadEnv";
import { config, iniciarConfig } from "./services/config";
import { fecharBanco } from "./db/conexaoPostgres";
import { fecharFila } from "./services/fila";
import { iniciarWorkerProcessarFoto } from "./jobs/processarFoto";
import { iniciarWorkerPublicarFoto } from "./jobs/publicarFoto";
import { agendarSincronizacao, iniciarWorkerSincronizar } from "./jobs/sincronizar";
import { iniciarSinalPeriodico } from "./jobs/sinal";

try {
    iniciarConfig(process.env);
} catch (erro) {
    console.error((erro as Error).message);
    process.exit(1);
}

async function main(): Promise<void> {
    if (config.papel !== "estacao") {
        // Nenhuma fila desta fase roda na VPS (whatsapp/zip/expurgo são fase 4).
        console.log("[Worker] papel vps não tem filas nesta fase — nada a fazer.");
        return;
    }

    iniciarWorkerProcessarFoto(config.workerConcorrencia);
    iniciarWorkerPublicarFoto();
    iniciarWorkerSincronizar();
    await agendarSincronizacao();
    const temporizadorSinal = iniciarSinalPeriodico();

    console.log(`[Worker] papel ${config.papel} | filas processar-foto, publicar-foto, sincronizar | sinal a cada 30s`);

    let encerrando = false;
    const encerrar = (evento: string) => () => {
        if (encerrando) return;
        encerrando = true;
        console.log(`[Worker] ${evento} recebido, encerrando...`);
        clearInterval(temporizadorSinal);
        Promise.allSettled([fecharFila(), fecharBanco()]).finally(() => process.exit(0));
    };
    process.on("SIGINT", encerrar("SIGINT"));
    process.on("SIGTERM", encerrar("SIGTERM"));
}

main().catch((erro) => {
    console.error("[Worker] Falha na inicialização:", erro instanceof Error ? erro.message : erro);
    process.exit(1);
});
```

O `Dockerfile` de `apps/api` não muda: o `tsc` do estágio `build` já compila `src/worker.ts` para `dist/worker.js` junto com o resto (nenhum `CMD` novo na imagem — os composes escolhem o comando).

- [ ] **Step 2: `docker-compose.estacao.yml`**

No serviço `vision`, o comentário e o volume `originais:/data/originais:ro` continuam como estão (o vision só lê). Acrescente em `services:`, depois de `api`:

```yaml
  worker:
    build: { context: ., dockerfile: apps/api/Dockerfile }
    command: ["node", "dist/worker.js"]
    env_file: .env.estacao
    depends_on:
      migrate: { condition: service_completed_successfully }
      redis: { condition: service_healthy }
    volumes:
      - originais:/data/originais
      - publicar:/data/publicar
      - marcas:/data/marcas
    restart: unless-stopped
```

Em `volumes:` (raiz do arquivo), acrescente:

```yaml
  publicar:
  marcas:
```

- [ ] **Step 3: `docker-compose.vps.yml`**

No serviço `api`, troque:

```yaml
    volumes:
      - selfies:/data/selfies
```

por:

```yaml
    volumes:
      - selfies:/data/selfies
      - fotos:/data/fotos
      - marcas:/data/marcas
```

Em `volumes:` (raiz do arquivo), acrescente:

```yaml
  fotos:
  marcas:
```

- [ ] **Step 4: `docker-compose.dev.yml`**

No serviço `api-vps`, troque:

```yaml
    volumes:
      - selfies:/data/selfies
```

por:

```yaml
    volumes:
      - selfies:/data/selfies
      - fotos-vps:/data/fotos
      - marcas-vps:/data/marcas
```

Acrescente em `services:`, depois de `api-vps`:

```yaml
  worker-estacao:
    build: { context: ., dockerfile: apps/api/Dockerfile }
    command: ["node", "dist/worker.js"]
    environment:
      <<: *banco-dev
      REDIS_URL: redis://redis:6379
      REDIS_PREFIXO: "fotos:estacao:"
      ESTACAO_CHAVE: dev-somente-local-dev-somente-local
      VPS_URL: http://api-vps:3000
      # Só resolve com --profile gpu (vision-gpu) no ar; sincronizar e sinal funcionam sem ele.
      VISION_URL: http://vision-gpu:8000
    volumes:
      - ./dados:/data/dados:ro
      - originais:/data/originais
      - publicar:/data/publicar
      - marcas-estacao:/data/marcas
    depends_on:
      migrate-estacao: { condition: service_completed_successfully }
      redis: { condition: service_healthy }
```

Em `volumes:` (raiz do arquivo), acrescente:

```yaml
  originais:
  publicar:
  marcas-estacao:
  fotos-vps:
  marcas-vps:
```

Atualize o comentário do topo do arquivo (acrescente uma linha):

```yaml
# Ingestão de teste:  docker compose -f docker-compose.dev.yml exec worker-estacao npm run ingerir -w apps/api -- --evento <slug> --pasta /data/dados/<pasta>
```

- [ ] **Step 5: Subir e verificar**

Run:

```bash
docker compose -f docker-compose.dev.yml up -d --build
docker compose -f docker-compose.dev.yml logs worker-estacao --tail 20
```

Expected: o log mostra `[Worker] papel estacao | filas processar-foto, publicar-foto, sincronizar | sinal a cada 30s`, sem traceback. Se a VPS ainda não tem nenhum operador/evento, o job `sincronizar` roda e não grava nada (listas vazias) — sem erro.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/worker.ts docker-compose.estacao.yml docker-compose.vps.yml docker-compose.dev.yml
git commit -m "feat(infra): processo worker e volumes de originais, publicação, fotos e marcas" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 16: `scripts/benchmark-pipeline.ts` e verificação final

**Files:**
- Create: `scripts/benchmark-pipeline.ts`
- Modify: `package.json` (script `benchmark-pipeline`, `tsx` em `devDependencies`)

**Interfaces:**
- Consumes: `iniciarConfig`/`config` (fase 1), `ConexaoPostgres` (fase 1), `calcularHashArquivo` (Task 10), `criarFila` (Task 9), `DadosProcessarFoto`/`NOME_FILA` de `processarFoto` (Task 11), `percentil` (Task 14)
- Produces: `npm run benchmark-pipeline -- --pasta <dir> [--evento <slug>] [--limite N]` — enfileira, espera a publicação (precisa do `worker` rodando de verdade) e imprime vazão e latência p50/p95

Ferramenta operacional, sem teste automatizado — mede o pipeline real rodando (como o `benchmark.py` da fase 2). Sobe o mesmo evento nos dois bancos (estação e VPS) direto por SQL, sem depender do `_ADMIN` nem de sincronização.

- [ ] **Step 1: Escrever o script**

`scripts/benchmark-pipeline.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { Client } from "pg";
import "../apps/api/src/loadEnv";
import { iniciarConfig } from "../apps/api/src/services/config";
import ConexaoPostgres from "../apps/api/src/db/conexaoPostgres";
import { calcularHashArquivo } from "../apps/api/src/services/hashArquivo";
import { criarFila } from "../apps/api/src/services/fila";
import { DadosProcessarFoto, NOME_FILA } from "../apps/api/src/jobs/processarFoto";
import { percentil } from "../apps/api/src/services/metricas";

function argumento(nome: string, padrao?: string): string | undefined {
    const idx = process.argv.indexOf(`--${nome}`);
    return idx >= 0 ? process.argv[idx + 1] : padrao;
}

async function garantirEventoDosDoisLados(slug: string): Promise<number> {
    const conexaoEstacao = new ConexaoPostgres();
    await conexaoEstacao.open();
    const chaveAnfitriao = `benchmark-${Date.now()}`;
    const [linha] = await conexaoEstacao.queryParam<{ id_evento: number }>(
        `INSERT INTO evento (nome, slug, tipo, privado, chave_anfitriao, data_fim, config)
         VALUES ('Benchmark do pipeline', ?, 'esportivo', 'N', ?, '2099-12-31', '{}')
         ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug RETURNING id_evento`,
        [slug, chaveAnfitriao]
    );
    await conexaoEstacao.close();

    const clienteVps = new Client({
        host: process.env.VPS_POSTGRES_HOST ?? "127.0.0.1",
        port: Number(process.env.VPS_POSTGRES_PORT ?? 5433),
        user: process.env.VPS_POSTGRES_USER ?? "fotos",
        password: process.env.VPS_POSTGRES_PASSWORD ?? "fotos",
        database: process.env.VPS_POSTGRES_DB ?? "fotos_vps",
    });
    await clienteVps.connect();
    // Mesmo id_evento nos dois bancos, como a sincronização de verdade faria.
    await clienteVps.query(
        `INSERT INTO evento (id_evento, nome, slug, tipo, privado, chave_anfitriao, data_fim, config)
         VALUES ($1, 'Benchmark do pipeline', $2, 'esportivo', 'N', $3, '2099-12-31', '{}')
         ON CONFLICT (id_evento) DO NOTHING`,
        [linha.id_evento, slug, chaveAnfitriao]
    );
    await clienteVps.end();

    return linha.id_evento;
}

async function main(): Promise<void> {
    const pasta = argumento("pasta");
    if (!pasta) throw new Error("Uso: npm run benchmark-pipeline -- --pasta <dir> [--evento <slug>] [--limite N]");
    const slug = argumento("evento", `benchmark-pipeline-${Date.now()}`) as string;
    const limite = Number(argumento("limite", "50"));

    iniciarConfig(process.env);
    const idEvento = await garantirEventoDosDoisLados(slug);

    const entradas = (await fs.readdir(pasta, { withFileTypes: true }))
        .filter((e) => e.isFile() && [".jpg", ".jpeg"].includes(path.extname(e.name).toLowerCase()))
        .slice(0, limite);
    if (entradas.length === 0) throw new Error(`Nenhum JPEG em ${pasta}`);

    const fila = criarFila<DadosProcessarFoto>(NOME_FILA);
    const hashes: string[] = [];
    for (const entrada of entradas) {
        const origem = path.join(pasta, entrada.name);
        const hash = await calcularHashArquivo(origem);
        hashes.push(hash);
        await fila.add(
            NOME_FILA,
            { id_evento: idEvento, id_evento_fotografo: null, hash_arquivo: hash, nome_arquivo: entrada.name, origem, copiar: true },
            { jobId: `${idEvento}:${hash}`, attempts: 5, backoff: { type: "exponential", delay: 1000 } }
        );
    }
    console.log(`${hashes.length} fotos de ${pasta} enfileiradas no evento "${slug}" (id_evento=${idEvento}).`);
    console.log("Aguardando publicação — precisa do worker rodando de verdade (docker compose ... worker-estacao).\n");

    const conexao = new ConexaoPostgres();
    await conexao.open();

    const inicio = performance.now();
    const prazoMs = 10 * 60 * 1000;
    while (performance.now() - inicio < prazoMs) {
        const [linha] = await conexao.queryParam<{ pendentes: number }>(
            "SELECT count(*)::int AS pendentes FROM foto WHERE id_evento = ? AND hash_arquivo = ANY(?::text[]) AND etapa <> 'publicada'",
            [idEvento, hashes]
        );
        if (linha.pendentes === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    const totalS = (performance.now() - inicio) / 1000;

    const linhas = await conexao.queryParam<{ criado_em: string; publicada_em: string | null; erro: string | null }>(
        "SELECT criado_em, publicada_em, erro FROM foto WHERE id_evento = ? AND hash_arquivo = ANY(?::text[])",
        [idEvento, hashes]
    );
    const publicadas = linhas.filter((l) => l.publicada_em);
    const comErro = linhas.filter((l) => l.erro);
    const latenciasMs = publicadas.map((l) => new Date(l.publicada_em as string).getTime() - new Date(l.criado_em).getTime());

    console.log(`${publicadas.length}/${hashes.length} publicadas em ${totalS.toFixed(1)}s (${comErro.length} com erro)`);
    console.log(`Vazão: ${(publicadas.length / totalS).toFixed(2)} fotos/s`);
    console.log(`Latência hash → publicada na VPS: p50 ${percentil(latenciasMs, 50).toFixed(0)}ms, p95 ${percentil(latenciasMs, 95).toFixed(0)}ms`);

    await conexao.close();
}

main().catch((erro) => {
    console.error("[BenchmarkPipeline] Falhou:", erro instanceof Error ? erro.message : erro);
    process.exit(1);
});
```

Em `package.json` (raiz), acrescente `"tsx": "^4.23.13"` em `devDependencies` (novo bloco) e, em `scripts`:

```json
        "benchmark-pipeline": "tsx scripts/benchmark-pipeline.ts"
```

- [ ] **Step 2: Rodar de verdade**

Com o compose de dev no ar (`docker compose -f docker-compose.dev.yml --profile gpu up -d --build`) e alguns JPEGs em `dados/fotos-benchmark/` (a fase 2 já deixou 200 sintéticos lá):

```bash
npm run benchmark-pipeline -- --pasta dados/fotos-benchmark --limite 20
```

Expected: `20/20 publicadas em <N>s (0 com erro)`, com vazão e latências impressas. Se `VISION_URL` do `worker-estacao` não resolver (perfil `gpu` fora do ar), as fotos ficam paradas em `rostos` e o script encerra no prazo de 10 min com `pendentes > 0` — nesse caso confira `docker compose -f docker-compose.dev.yml --profile gpu ps vision-gpu`.

- [ ] **Step 3: Verificação final da fase**

Run:

```bash
npm run test -w apps/api
npm run test:integracao -w apps/api
npm run typecheck
npm run test:vision
git status --short
```

Expected: tudo PASS; `npm run test:vision` (fase 2) continua verde, sem relação com esta fase; `git status` não mostra `dados/` nem arquivos fora do que foi commitado nas 16 tasks.

- [ ] **Step 4: Commit**

```bash
git add scripts/benchmark-pipeline.ts package.json
git commit -m "feat(api): scripts/benchmark-pipeline.ts e verificação final da fase 3" -m "Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Cobertura do spec (fase 3)

| Item do spec (seção 13, item 3) | Task |
|---|---|
| CLI `ingerir` | 10, 13 |
| Worker `processar-foto` (hash → original → rostos → derivados, etapas idempotentes, `UnrecoverableError` x retry) | 10, 11 |
| Worker `publicar-foto` (fila separada, concorrência 4, retry até 5 min) | 9, 12 |
| VPS `_ESTACAO`: sincronização, publicação (idempotente, ignora foto excluída), sinal | 6, 7, 8 |
| `_ADMIN` de login, evento (com config e marca d'água) e fotógrafo, só API | 1, 3, 4, 5 |
| `npm run criar-operador` | 1, 2 |
| Métricas (fila por etapa, fotos/min, taxa de erro, latência p50/p95, VRAM) alimentando o sinal | 14 |
| `scripts/benchmark-pipeline.ts` | 16 |
| Autenticação estação↔VPS (`ESTACAO_CHAVE`) e operador (token assinado) | 1 |
| Volumes `originais`, `publicar`, `marcas`, `fotos` nos composes | 15 |

