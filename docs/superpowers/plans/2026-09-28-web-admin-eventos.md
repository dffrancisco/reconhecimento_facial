# web-admin — eventos e fotógrafos — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O operador cria e ajusta eventos, vê os links do evento e vincula fotógrafos por telas, sem chamar a API na mão.

**Architecture:**
- **API do VPS**, papel `vps`, módulos `_ADMIN` que já existem (`login`, `evento`, `fotografo`): regras puras novas em `_ADMIN/evento/regras.ts`, validações, links montados na API, duas chamadas novas de fotógrafo e limite no login. A sincronização passa a levar à estação também os eventos desativados há pouco.
- **App Vue novo** `apps/web-admin`, igual ao `web-fotografo`: uma pasta por tela com `state`/`actions`, serviços finos sobre `chamar()`, sessão reativa.
- **Servido pelo nginx do VPS** (`infra/nginx`), num segundo `server` para o domínio do admin.

**Tech Stack:**
- Vue 3.5, Vite 8, TypeScript 5.9 `strict`, vue-router 5 (hash);
- Tailwind 4.3 + daisyUI 5.7 (tema claro fixo), axios 1.20, `qrcode`;
- Vitest 5 + @vue/test-utils 2.5 + jsdom 30;
- API: Express, `node:test`, Postgres, Redis.

**Spec:** [docs/superpowers/specs/2026-09-27-web-admin-eventos-design.md](../specs/2026-09-27-web-admin-eventos-design.md)

## Global Constraints

- **Branch:** `web-admin`, criada a partir de `web-fotografo` antes da Task 1 (`git switch -c web-admin`).
- **Português:** tudo em português (arquivos, variáveis, funções, comentários, textos de tela). Comentário só para o porquê não óbvio.
- **API — padrão** (skill `padrao-backend`, como nos módulos existentes):
  - métodos da rota recebem só `req` e **retornam**;
  - validação de presença na rota com `{ msg, error: true }`;
  - regra de negócio na `ctrl` com `ErroTratado` (vira 422 `{ msg, codigo? }` no `per`);
  - SQL só no `sql.*.ts`, com `?`;
  - campos vindos do corpo passam por lista fixa antes de chegar ao banco (a `config` do evento é `jsonb`).
- **Datas** trafegam como texto `YYYY-MM-DD`: a API lê com `to_char(…, 'YYYY-MM-DD')`, a tela monta `DD/MM/AAAA` do texto, nunca com `Date`.
- **Faixas da `config`** (spec §3.4): limiar 0,20 a 0,80; máximo de selfies 1 a 5; dias até apagar 1 a 3650; validade do resultado `null` ou 1 a 3650. Nome do evento até 150 caracteres; endereço até 80; organizador até 120.
- **Textos fixos da tela** (copiar exatamente):
  - "Esse endereço já é de outro evento."
  - "A verificação por WhatsApp ainda não existe: ligado, o participante não vê as fotos."
  - "Salvo. A estação recebe a mudança em até 1 minuto."
  - "O link e o QR de upload de cada fotógrafo aparecem no painel da estação."
  - "O link de upload dele para de aceitar fotos. As fotos já enviadas continuam."
  - "Evento inativo: o participante não consegue buscar as fotos."
  - "Configure ENDERECO_PARTICIPANTE no VPS para ver os links."
  - "Nenhum evento ainda. Crie o primeiro."
- **Identidade "Claro e limpo"** (spec §2), os mesmos tokens do `web-fotografo` (`apps/web-fotografo/src/estilo.css`); daisyUI com `themes: light --default`.
- **Sessão:** `localStorage["sessao_admin"] = { token, nome }`; token cru no header `Authorization`; resposta com `codigo: "sessao_expirada"` apaga a sessão e volta para `/#/entrar`.
- **Ambiente:**
  - Node 22 em todo comando: `export PATH=/home/alves/.nvm/versions/node/v22.23.2/bin:$PATH` (os testes da tela não sobem no Node 20);
  - testes de integração da API precisam do Postgres e do Redis de dev: `docker compose -f docker-compose.dev.yml up -d postgres redis` e, na primeira vez, `npm run migrate:dev`;
  - o `worker-estacao` precisa estar parado durante `npm run test:integracao` (`docker compose -f docker-compose.dev.yml stop worker-estacao`).
- **Commits** terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Data escorregando um dia pelo fuso:** o Postgres devolve `date` como `Date` no fuso do processo, e a tela mostraria 26/09 para um evento de 27/09. **Esperado:** a API devolve `"2026-10-10"` exatamente como gravou, na criação, na leitura e na lista. Pinado na Task 2.
2. **Duplo clique em "Criar evento":** o segundo pedido chegaria com o mesmo endereço e voltaria "Esse endereço já é de outro evento." depois de o primeiro ter criado. **Esperado:** um pedido só enquanto o primeiro não volta. Pinado na Task 8.
3. **Endereço digitado à mão com maiúsculas, espaço ou acento** ("Corrida X!"): a API recusaria com uma mensagem técnica. **Esperado:** ao sair do campo, o texto vira um endereço válido (`corrida-x`). Pinado na Task 8.
4. **Validade do resultado apagada:** o campo vazio não pode ir como `0` nem `""`, que a API recusa. **Esperado:** vai `null` ("sem validade"). Pinado na Task 9.
5. **Link direto para um evento que não existe** (`/#/eventos/999`, favorito antigo): **Esperado:** "Evento não encontrado." com caminho de volta para a lista, sem tela em branco. Pinado na Task 9.

---

### Task 1: Regras puras do evento

**Files:**
- Create: `apps/api/src/_ADMIN/evento/regras.ts`
- Create: `apps/api/src/_ADMIN/evento/regras.test.ts`
- Modify: `apps/api/src/_ADMIN/evento/i.evento.ts`

**Interfaces:**
- Consumes: `ConfigEvento`, `LinhaEvento` de `i.evento.ts`.
- Produces:
  - `validarNome(nome: unknown): string | null`
  - `validarDatas(inicio: unknown, fim: unknown): string | null` — `inicio` pode ser `null`
  - `validarConfig(bruto: unknown): { valores: Partial<ConfigEvento> } | { erro: string }`
  - `montarLinks(endereco: string | null, evento: Pick<LinhaEvento, "privado" | "slug" | "chave_acesso" | "chave_anfitriao">): LinksEvento | null`
  - `slugRepetido(erro: unknown): boolean`
  - `interface LinksEvento { participante: string; anfitriao: string }` em `i.evento.ts`

- [ ] **Step 1: Criar a branch**

```bash
cd /mnt/nvme/PROJETOS/reconhecimento_facial && git switch -c web-admin
```

- [ ] **Step 2: Escrever os testes**

`apps/api/src/_ADMIN/evento/regras.test.ts`:

```ts
import { describe, test } from "node:test";
import assert from "node:assert";
import { montarLinks, slugRepetido, validarConfig, validarDatas, validarNome } from "./regras";

describe("validarDatas", () => {
    test("início e fim no mesmo dia, ou sem início, valem", () => {
        assert.strictEqual(validarDatas("2026-09-27", "2026-09-27"), null);
        assert.strictEqual(validarDatas(null, "2026-09-27"), null);
    });

    test("fim antes do início é recusado", () => {
        assert.strictEqual(validarDatas("2026-10-11", "2026-10-10"), "O fim do evento não pode ser antes do início.");
    });

    test("data que não existe ou fora do formato é recusada", () => {
        assert.strictEqual(validarDatas(null, "2026-02-30"), "Data de fim inválida.");
        assert.strictEqual(validarDatas(null, "27/09/2026"), "Data de fim inválida.");
        assert.strictEqual(validarDatas(null, undefined), "Data de fim inválida.");
        assert.strictEqual(validarDatas("2026-13-01", "2026-12-31"), "Data de início inválida.");
    });
});

describe("validarNome", () => {
    test("obrigatório e até 150 caracteres", () => {
        assert.strictEqual(validarNome("Corrida da Serra"), null);
        assert.strictEqual(validarNome("   "), "Informe o nome do evento.");
        assert.strictEqual(validarNome(undefined), "Informe o nome do evento.");
        assert.strictEqual(validarNome("x".repeat(151)), "O nome do evento deve ter até 150 caracteres.");
    });
});

describe("validarConfig", () => {
    test("sem config, nada muda", () => {
        assert.deepStrictEqual(validarConfig(undefined), { valores: {} });
        assert.deepStrictEqual(validarConfig(null), { valores: {} });
    });

    test("guarda só os campos conhecidos", () => {
        assert.deepStrictEqual(validarConfig({ exigir_whatsapp: false, qualquer: 1 }), { valores: { exigir_whatsapp: false } });
    });

    test("aceita os extremos de cada faixa", () => {
        assert.deepStrictEqual(validarConfig({ limiar: 0.2, max_selfies: 5, dias_expurgo: 3650, validade_resultado_dias: 1 }), {
            valores: { limiar: 0.2, max_selfies: 5, dias_expurgo: 3650, validade_resultado_dias: 1 },
        });
        assert.deepStrictEqual(validarConfig({ limiar: 0.8, max_selfies: 1, dias_expurgo: 1, validade_resultado_dias: null }), {
            valores: { limiar: 0.8, max_selfies: 1, dias_expurgo: 1, validade_resultado_dias: null },
        });
    });

    test("recusa fora da faixa, com a mensagem do campo", () => {
        assert.deepStrictEqual(validarConfig({ limiar: 0.9 }), { erro: "O limiar de semelhança deve ficar entre 0,20 e 0,80." });
        assert.deepStrictEqual(validarConfig({ limiar: "0.5" }), { erro: "O limiar de semelhança deve ficar entre 0,20 e 0,80." });
        assert.deepStrictEqual(validarConfig({ max_selfies: 0 }), { erro: "O máximo de selfies deve ser de 1 a 5." });
        assert.deepStrictEqual(validarConfig({ max_selfies: 2.5 }), { erro: "O máximo de selfies deve ser de 1 a 5." });
        assert.deepStrictEqual(validarConfig({ dias_expurgo: 3651 }), { erro: "Os dias até apagar o evento devem ser de 1 a 3650." });
        assert.deepStrictEqual(validarConfig({ validade_resultado_dias: 0 }), {
            erro: "A validade do resultado deve ficar vazia ou ser de 1 a 3650 dias.",
        });
    });

    test("sim ou não só com booleano; organizador obrigatório e sem espaço sobrando", () => {
        assert.deepStrictEqual(validarConfig({ exigir_whatsapp: "false" }), { erro: "Exigir WhatsApp deve ser sim ou não." });
        assert.deepStrictEqual(validarConfig({ marca_dagua: 1 }), { erro: "Marca d'água deve ser sim ou não." });
        assert.deepStrictEqual(validarConfig({ organizador: "  " }), { erro: "Informe o nome do organizador (até 120 caracteres)." });
        assert.deepStrictEqual(validarConfig({ organizador: "  Liga X " }), { valores: { organizador: "Liga X" } });
    });

    test("config que não é objeto é recusada", () => {
        assert.deepStrictEqual(validarConfig([1]), { erro: "Configuração do evento inválida." });
        assert.deepStrictEqual(validarConfig("x"), { erro: "Configuração do evento inválida." });
    });
});

describe("montarLinks", () => {
    const base = { slug: "corrida-da-serra", chave_acesso: null, chave_anfitriao: "anf123", privado: "N" as const };

    test("público: participante pelo endereço do evento", () => {
        assert.deepStrictEqual(montarLinks("https://fotos.exemplo.com.br", base), {
            participante: "https://fotos.exemplo.com.br/#/e/corrida-da-serra",
            anfitriao: "https://fotos.exemplo.com.br/#/a/anf123",
        });
    });

    test("privado: participante pela chave de acesso", () => {
        assert.strictEqual(montarLinks("http://localhost:8080", { ...base, privado: "S", chave_acesso: "chv456" })?.participante, "http://localhost:8080/#/p/chv456");
    });

    test("sem endereço configurado, sem links", () => {
        assert.strictEqual(montarLinks(null, base), null);
    });
});

describe("slugRepetido", () => {
    test("só a violação única do endereço", () => {
        assert.strictEqual(slugRepetido({ code: "23505", constraint: "evento_slug_key" }), true);
        assert.strictEqual(slugRepetido({ code: "23505", constraint: "evento_chave_anfitriao_key" }), false);
        assert.strictEqual(slugRepetido(new Error("outro")), false);
    });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd apps/api && npx tsx --test src/_ADMIN/evento/regras.test.ts`
Expected: FAIL — `Cannot find module './regras'`.

- [ ] **Step 4: Tipo dos links**

Em `apps/api/src/_ADMIN/evento/i.evento.ts`, acrescentar no fim:

```ts
export interface LinksEvento {
    participante: string;
    anfitriao: string;
}
```

- [ ] **Step 5: Implementar**

`apps/api/src/_ADMIN/evento/regras.ts`:

```ts
import { ConfigEvento, LinhaEvento, LinksEvento } from "./i.evento";

const NOME_MAXIMO = 150;
const ORGANIZADOR_MAXIMO = 120;
const DATA = /^\d{4}-\d{2}-\d{2}$/;

// Confere também se o dia existe: 2026-02-30 passa no formato e não é data.
function dataValida(valor: unknown): valor is string {
    if (typeof valor !== "string" || !DATA.test(valor)) return false;
    const d = new Date(`${valor}T12:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === valor;
}

export function validarNome(nome: unknown): string | null {
    if (typeof nome !== "string" || !nome.trim()) return "Informe o nome do evento.";
    return nome.trim().length > NOME_MAXIMO ? "O nome do evento deve ter até 150 caracteres." : null;
}

export function validarDatas(inicio: unknown, fim: unknown): string | null {
    if (!dataValida(fim)) return "Data de fim inválida.";
    if (inicio === null) return null;
    if (!dataValida(inicio)) return "Data de início inválida.";
    // YYYY-MM-DD em texto compara na ordem certa.
    return inicio > fim ? "O fim do evento não pode ser antes do início." : null;
}

const inteiroEntre = (valor: unknown, min: number, max: number): valor is number =>
    typeof valor === "number" && Number.isInteger(valor) && valor >= min && valor <= max;

// A config é jsonb: só os campos conhecidos entram, e cada um na sua faixa (spec §3.4).
export function validarConfig(bruto: unknown): { valores: Partial<ConfigEvento> } | { erro: string } {
    if (bruto === undefined || bruto === null) return { valores: {} };
    if (typeof bruto !== "object" || Array.isArray(bruto)) return { erro: "Configuração do evento inválida." };
    const c = bruto as Record<string, unknown>;
    const valores: Partial<ConfigEvento> = {};

    if ("limiar" in c) {
        if (typeof c.limiar !== "number" || !(c.limiar >= 0.2 && c.limiar <= 0.8))
            return { erro: "O limiar de semelhança deve ficar entre 0,20 e 0,80." };
        valores.limiar = c.limiar;
    }
    if ("exigir_whatsapp" in c) {
        if (typeof c.exigir_whatsapp !== "boolean") return { erro: "Exigir WhatsApp deve ser sim ou não." };
        valores.exigir_whatsapp = c.exigir_whatsapp;
    }
    if ("marca_dagua" in c) {
        if (typeof c.marca_dagua !== "boolean") return { erro: "Marca d'água deve ser sim ou não." };
        valores.marca_dagua = c.marca_dagua;
    }
    if ("organizador" in c) {
        const organizador = typeof c.organizador === "string" ? c.organizador.trim() : "";
        if (!organizador || organizador.length > ORGANIZADOR_MAXIMO) return { erro: "Informe o nome do organizador (até 120 caracteres)." };
        valores.organizador = organizador;
    }
    if ("max_selfies" in c) {
        if (!inteiroEntre(c.max_selfies, 1, 5)) return { erro: "O máximo de selfies deve ser de 1 a 5." };
        valores.max_selfies = c.max_selfies;
    }
    if ("dias_expurgo" in c) {
        if (!inteiroEntre(c.dias_expurgo, 1, 3650)) return { erro: "Os dias até apagar o evento devem ser de 1 a 3650." };
        valores.dias_expurgo = c.dias_expurgo;
    }
    if ("validade_resultado_dias" in c) {
        const validade = c.validade_resultado_dias;
        if (validade !== null && !inteiroEntre(validade, 1, 3650))
            return { erro: "A validade do resultado deve ficar vazia ou ser de 1 a 3650 dias." };
        valores.validade_resultado_dias = validade;
    }
    return { valores };
}

export function montarLinks(
    endereco: string | null,
    evento: Pick<LinhaEvento, "privado" | "slug" | "chave_acesso" | "chave_anfitriao">
): LinksEvento | null {
    if (!endereco) return null;
    const participante =
        evento.privado === "S" && evento.chave_acesso ? `${endereco}/#/p/${evento.chave_acesso}` : `${endereco}/#/e/${evento.slug}`;
    return { participante, anfitriao: `${endereco}/#/a/${evento.chave_anfitriao}` };
}

// `evento_slug_key` é o nome que o Postgres dá ao UNIQUE da coluna slug (migration de cadastros).
export function slugRepetido(erro: unknown): boolean {
    const e = erro as { code?: unknown; constraint?: unknown } | null;
    return e?.code === "23505" && e?.constraint === "evento_slug_key";
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `cd apps/api && npx tsx --test src/_ADMIN/evento/regras.test.ts && npx tsc -p tsconfig.json --noEmit`
Expected: `# fail 0` e o `tsc` sem saída.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/_ADMIN/evento/regras.ts apps/api/src/_ADMIN/evento/regras.test.ts apps/api/src/_ADMIN/evento/i.evento.ts
git commit -m "feat(api): regras do evento no admin — datas, config e links

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Criar e editar evento com as regras

**Files:**
- Modify: `apps/api/src/_ADMIN/evento/sql.evento.ts`
- Modify: `apps/api/src/_ADMIN/evento/ctrl.evento.ts`
- Test: `apps/api/integracao/adminEvento.test.ts`

**Interfaces:**
- Consumes (Task 1): `validarNome`, `validarDatas`, `validarConfig`, `slugRepetido`.
- Produces:
  - `EventoCtrl.criarEvento(dados: { nome: string; slug: string; tipo: string; privado?: boolean; data_inicio?: string | null; data_fim: string; config?: unknown }): Promise<LinhaEvento>`
  - `EventoCtrl.editarEvento(dados: { id_evento: number; nome?: string; data_inicio?: string | null; data_fim?: string; ativo?: boolean; privado?: boolean; config?: unknown }): Promise<LinhaEvento>`
  - datas de `LinhaEvento` sempre em texto `YYYY-MM-DD` (criar, obter, listar);
  - erro de endereço repetido: `ErroTratado("Esse endereço já é de outro evento.", "endereco_repetido")`.

- [ ] **Step 1: Conferir o nome da restrição do endereço**

Run: `docker exec fotos-dev-postgres-1 psql -U fotos -d fotos_vps -c '\d evento' | grep slug_key`
Expected: uma linha com `"evento_slug_key" UNIQUE CONSTRAINT, btree (slug)`. Se o nome for outro, troque em `slugRepetido` (Task 1) e no teste dela.

- [ ] **Step 2: Escrever os testes**

Em `apps/api/integracao/adminEvento.test.ts`, acrescentar antes do primeiro `after(`:

```ts
test("cria já com a config informada, mesclada sobre o padrão do tipo", async () => {
    const evento = await ctrl.criarEvento({
        nome: "Corrida W",
        slug: `corrida-w-${Date.now()}`,
        tipo: "esportivo",
        data_inicio: "2026-10-10",
        data_fim: "2026-10-11",
        config: { exigir_whatsapp: false },
    });
    assert.strictEqual(evento.config.exigir_whatsapp, false);
    assert.strictEqual(evento.config.max_selfies, 3);
    assert.strictEqual(evento.config.organizador, "Corrida W");
});

test("devolve as datas como texto, sem escorregar de dia pelo fuso", async () => {
    const evento = await ctrl.criarEvento({
        nome: "Datas",
        slug: `datas-texto-${Date.now()}`,
        tipo: "esportivo",
        data_inicio: "2026-10-10",
        data_fim: "2026-10-11",
    });
    assert.strictEqual(evento.data_inicio, "2026-10-10");
    assert.strictEqual(evento.data_fim, "2026-10-11");
    assert.strictEqual((await ctrl.obterEvento(evento.id_evento)).data_inicio, "2026-10-10");
    const naLista = (await ctrl.listarEventos()).find((e) => e.id_evento === evento.id_evento);
    assert.strictEqual(naLista?.data_fim, "2026-10-11");
});

test("endereço repetido vira mensagem clara, não erro 500", async () => {
    const slug = `repetido-${Date.now()}`;
    await ctrl.criarEvento({ nome: "A", slug, tipo: "esportivo", data_fim: "2026-12-31" });
    await assert.rejects(
        () => ctrl.criarEvento({ nome: "B", slug, tipo: "esportivo", data_fim: "2026-12-31" }),
        (erro: unknown) =>
            erro instanceof ErroTratado && erro.message === "Esse endereço já é de outro evento." && erro.codigo === "endereco_repetido"
    );
});

test("recusa fim antes do início, na criação e na edição", async () => {
    await assert.rejects(
        () => ctrl.criarEvento({ nome: "C", slug: `datas-c-${Date.now()}`, tipo: "esportivo", data_inicio: "2026-10-11", data_fim: "2026-10-10" }),
        /O fim do evento não pode ser antes do início/
    );
    const evento = await ctrl.criarEvento({ nome: "D", slug: `datas-d-${Date.now()}`, tipo: "esportivo", data_inicio: "2026-10-10", data_fim: "2026-10-10" });
    await assert.rejects(() => ctrl.editarEvento({ id_evento: evento.id_evento, data_fim: "2026-10-09" }), /O fim do evento não pode ser antes do início/);
});

test("editar com config fora da faixa recusa e não grava nada", async () => {
    const evento = await ctrl.criarEvento({ nome: "E", slug: `faixa-${Date.now()}`, tipo: "esportivo", data_fim: "2026-12-31" });
    await assert.rejects(() => ctrl.editarEvento({ id_evento: evento.id_evento, nome: "Outro", config: { max_selfies: 9 } }), /máximo de selfies/);
    const lido = await ctrl.obterEvento(evento.id_evento);
    assert.strictEqual(lido.nome, "E");
    assert.strictEqual(lido.config.max_selfies, 3);
});

test("campo desconhecido na config é ignorado", async () => {
    const evento = await ctrl.criarEvento({ nome: "F", slug: `extra-${Date.now()}`, tipo: "social", data_fim: "2026-12-31", config: { hackeado: true } });
    assert.strictEqual("hackeado" in evento.config, false);
});

test("editar com data de início vazia grava o evento sem início", async () => {
    const evento = await ctrl.criarEvento({ nome: "G", slug: `sem-inicio-${Date.now()}`, tipo: "esportivo", data_inicio: "2026-10-10", data_fim: "2026-10-10" });
    const editado = await ctrl.editarEvento({ id_evento: evento.id_evento, data_inicio: "" });
    assert.strictEqual(editado.data_inicio, null);
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `cd apps/api && npx tsx --test --test-concurrency=1 integracao/adminEvento.test.ts`
Expected: FAIL — o primeiro teste novo não compila (`config` e `data_inicio` fora do tipo de `criarEvento`) ou falha nas asserções de data (`Date` em vez de texto) e no endereço repetido (erro do Postgres em vez de `ErroTratado`).

- [ ] **Step 4: Datas em texto no SQL**

Em `apps/api/src/_ADMIN/evento/sql.evento.ts`, logo depois dos imports:

```ts
// Datas em texto (YYYY-MM-DD): o `date` do Postgres viraria Date no fuso do processo, e a
// tela mostraria o dia anterior.
const COLUNAS = `id_evento, nome, slug, tipo, privado, chave_acesso, chave_anfitriao,
       to_char(data_inicio, 'YYYY-MM-DD') AS data_inicio, to_char(data_fim, 'YYYY-MM-DD') AS data_fim,
       ativo, config, criado_em`;
```

E trocar três consultas:
- em `inserirEvento`: `RETURNING *` → ``RETURNING ${COLUNAS}``;
- `listarEventosSql` inteira por:

```ts
export async function listarEventosSql(conexao: ConexaoPostgres): Promise<LinhaEvento[]> {
    return conexao.queryParam<LinhaEvento>(`SELECT ${COLUNAS} FROM evento WHERE deletado = 'N' ORDER BY criado_em DESC`);
}
```

- `obterEventoSql` inteira por:

```ts
export async function obterEventoSql(conexao: ConexaoPostgres, idEvento: number): Promise<LinhaEvento | undefined> {
    return conexao.queryOneParam<LinhaEvento>(`SELECT ${COLUNAS} FROM evento WHERE id_evento = ? AND deletado = 'N'`, [idEvento]);
}
```

- [ ] **Step 5: Validações na ctrl**

Em `apps/api/src/_ADMIN/evento/ctrl.evento.ts`:

1. Trocar o import de `./i.evento` e acrescentar o de `./regras`:

```ts
import { ConfigEvento, LinhaEvento } from "./i.evento";
import { slugRepetido, validarConfig, validarDatas, validarNome } from "./regras";
```

2. Trocar `const SLUG_VALIDO = …;` por:

```ts
const SLUG_VALIDO = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG_MAXIMO = 80;

function exigir(erro: string | null): void {
    if (erro) throw new ErroTratado(erro);
}

function configValida(bruto: unknown): Partial<ConfigEvento> {
    const r = validarConfig(bruto);
    if ("erro" in r) throw new ErroTratado(r.erro);
    return r.valores;
}
```

3. Trocar os métodos `criarEvento` e `editarEvento` inteiros por:

```ts
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
        if (typeof dados.slug !== "string" || !SLUG_VALIDO.test(dados.slug) || dados.slug.length > SLUG_MAXIMO)
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
```

```ts
    async editarEvento(dados: {
        id_evento: number;
        nome?: string;
        data_inicio?: string | null;
        data_fim?: string;
        ativo?: boolean;
        privado?: boolean;
        config?: unknown;
    }): Promise<LinhaEvento> {
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
```

A rota (`route.evento.ts`) já repassa `req.body` inteiro para as duas: não muda.

- [ ] **Step 6: Rodar e ver passar**

Run: `cd apps/api && npx tsx --test --test-concurrency=1 integracao/adminEvento.test.ts integracao/adminFotografo.test.ts integracao/estacaoSincronizacao.test.ts && npx tsx --test src/_ADMIN/evento/*.test.ts && npx tsc -p tsconfig.json --noEmit`
Expected: `# fail 0` nos três comandos de teste; `tsc` sem saída.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/_ADMIN/evento/sql.evento.ts apps/api/src/_ADMIN/evento/ctrl.evento.ts apps/api/integracao/adminEvento.test.ts
git commit -m "feat(api): criar e editar evento com validação, config na criação e datas em texto

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Links do evento na API

**Files:**
- Modify: `apps/api/src/services/config.ts`
- Modify: `apps/api/src/services/config.test.ts`
- Modify: `apps/api/src/_ADMIN/evento/i.evento.ts`
- Modify: `apps/api/src/_ADMIN/evento/ctrl.evento.ts`
- Modify: `apps/api/src/_ADMIN/evento/evento.http`
- Modify: `apps/api/.env.example`
- Modify: `docker-compose.dev.yml`
- Modify: `docker-compose.vps.yml`
- Test: `apps/api/integracao/adminEvento.test.ts`

**Interfaces:**
- Consumes (Task 1): `montarLinks`, `LinksEvento`.
- Produces:
  - `config.enderecoParticipante: string | null`, lido de `ENDERECO_PARTICIPANTE` sem barra no fim;
  - `type EventoComLinks = LinhaEvento & { links: LinksEvento | null }`;
  - `EventoCtrl.obterEvento(id): Promise<EventoComLinks>` e `editarEvento(...): Promise<EventoComLinks>` (a tela usa a resposta das duas).

- [ ] **Step 1: Escrever os testes**

Em `apps/api/src/services/config.test.ts`, dentro do `describe("carregarConfig", …)`, acrescentar:

```ts
    test("lê o endereço do app do participante sem barra no fim; sem ele, null", () => {
        const vps = { ...BASE, PAPEL: "vps", ARQUIVO_SEGREDO: "x", OPERADOR_SEGREDO: "o".repeat(32), VISION_URL: "http://vision" };
        assert.strictEqual(carregarConfig({ ...vps, ENDERECO_PARTICIPANTE: "https://fotos.exemplo.com.br/" }).enderecoParticipante, "https://fotos.exemplo.com.br");
        assert.strictEqual(carregarConfig(vps).enderecoParticipante, null);
    });
```

Em `apps/api/integracao/adminEvento.test.ts`, no `iniciarConfig` do primeiro `before`, acrescentar `ENDERECO_PARTICIPANTE: "http://fotos.teste/",` e, antes do primeiro `after(`:

```ts
test("obterEvento traz os links do participante e do anfitrião", async () => {
    const slug = `links-${Date.now()}`;
    const publico = await ctrl.criarEvento({ nome: "Links", slug, tipo: "esportivo", data_fim: "2026-12-31" });
    assert.deepStrictEqual((await ctrl.obterEvento(publico.id_evento)).links, {
        participante: `http://fotos.teste/#/e/${slug}`,
        anfitriao: `http://fotos.teste/#/a/${publico.chave_anfitriao}`,
    });

    const privado = await ctrl.criarEvento({ nome: "Links P", slug: `links-p-${Date.now()}`, tipo: "social", data_fim: "2026-12-31" });
    const editado = await ctrl.editarEvento({ id_evento: privado.id_evento, nome: "Links P2" });
    assert.strictEqual(editado.links?.participante, `http://fotos.teste/#/p/${privado.chave_acesso}`);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/api && npx tsx --test src/services/config.test.ts; npx tsx --test --test-concurrency=1 integracao/adminEvento.test.ts`
Expected: FAIL — `enderecoParticipante` é `undefined` e `links` não existe.

- [ ] **Step 3: Configuração**

Em `apps/api/src/services/config.ts`:
- em `iConfig`, depois de `enderecoTunel: string | null;`: `enderecoParticipante: string | null;`
- em `carregarConfig`, depois de `enderecoTunel: helper.endereco(env.ENDERECO_TUNEL),`:

```ts
        // Onde o app do participante está no ar: o admin monta com ele os links do evento.
        enderecoParticipante: helper.endereco(env.ENDERECO_PARTICIPANTE),
```

- [ ] **Step 4: Links no obterEvento**

Em `apps/api/src/_ADMIN/evento/i.evento.ts`, acrescentar no fim:

```ts
export type EventoComLinks = LinhaEvento & { links: LinksEvento | null };
```

Em `apps/api/src/_ADMIN/evento/ctrl.evento.ts`:
- imports: `import { ConfigEvento, EventoComLinks, LinhaEvento } from "./i.evento";` e acrescentar `montarLinks` ao import de `./regras`;
- trocar `obterEvento` por:

```ts
    async obterEvento(idEvento: number): Promise<EventoComLinks> {
        const evento = await obterEventoSql(this.conexao, idEvento);
        if (!evento) throw new ErroTratado("Evento não encontrado.");
        return { ...evento, links: montarLinks(config.enderecoParticipante, evento) };
    }
```

- na assinatura de `editarEvento`, trocar `Promise<LinhaEvento>` por `Promise<EventoComLinks>`.

- [ ] **Step 5: Endereço nos ambientes**

`docker-compose.dev.yml`, no `environment` do `api-vps`, depois de `VISION_URL: http://vision-cpu:8000`:

```yaml
      # O admin monta os links do evento com ele: é onde o nginx de dev serve o app do participante.
      ENDERECO_PARTICIPANTE: http://localhost:8080
```

`docker-compose.vps.yml`, no serviço `api`, logo depois de `env_file: .env.vps`:

```yaml
    environment:
      # Sai do domínio que o Traefik já usa: não há variável nova para preencher no .env.vps.
      ENDERECO_PARTICIPANTE: https://${DOMINIO_PARTICIPANTE}
```

`apps/api/.env.example`, no fim: `ENDERECO_PARTICIPANTE=http://localhost:5173`

- [ ] **Step 6: Exemplos do `.http`**

Em `apps/api/src/_ADMIN/evento/evento.http`, trocar o corpo de "Criar evento" por:

```json
{
    "call": "criarEvento",
    "nome": "Corrida da Serra 2026",
    "slug": "corrida-da-serra-2026",
    "tipo": "esportivo",
    "data_inicio": "2026-11-01",
    "data_fim": "2026-11-01",
    "config": { "exigir_whatsapp": false }
}
```

e acrescentar depois de "Listar eventos":

```http
### Obter evento (com os links do participante e do anfitrião)
POST {{vps}}/api/admin/evento
Content-Type: application/json
Authorization: {{token}}

{ "call": "obterEvento", "id_evento": 1 }
```

- [ ] **Step 7: Rodar e ver passar**

Run: `cd apps/api && npx tsx --test src/services/config.test.ts && npx tsx --test --test-concurrency=1 integracao/adminEvento.test.ts && npx tsc -p tsconfig.json --noEmit && cd ../.. && docker compose -f docker-compose.dev.yml config -q && docker compose --env-file .env.vps.example -f docker-compose.vps.yml config -q`
Expected: `# fail 0` nos dois; `tsc` e os dois `config -q` sem saída.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/services/config.ts apps/api/src/services/config.test.ts apps/api/src/_ADMIN/evento apps/api/.env.example apps/api/integracao/adminEvento.test.ts docker-compose.dev.yml docker-compose.vps.yml
git commit -m "feat(api): links do participante e do anfitrião no obterEvento

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Fotógrafos do evento na API

**Files:**
- Modify: `apps/api/src/_ADMIN/fotografo/sql.fotografo.ts`
- Modify: `apps/api/src/_ADMIN/fotografo/ctrl.fotografo.ts`
- Modify: `apps/api/src/_ADMIN/fotografo/route.fotografo.ts`
- Modify: `apps/api/src/_ADMIN/fotografo/fotografo.http`
- Test: `apps/api/integracao/adminFotografo.test.ts`

**Interfaces:**
- Produces (chamadas `POST /api/admin/fotografo`):
  - `listarVinculos { id_evento }` → `{ id_evento_fotografo: number; id_fotografo: number; nome: string; telefone: string | null }[]`, só ativos, por nome;
  - `desvincularFotografo { id_evento_fotografo }` → `{ ok: true }`;
  - `vincularFotografo { id_evento, id_fotografo }` → `LinhaVinculo` (agora com `ativo: "S" | "N"`); reativa com token novo se o vínculo estava desativado;
  - `criarFotografo { nome, telefone? }` → `LinhaFotografo` (telefone `""` vira `null`).

- [ ] **Step 1: Escrever os testes**

Em `apps/api/integracao/adminFotografo.test.ts`, antes do primeiro `after(`:

```ts
test("listarVinculos traz só os ativos do evento, com nome e telefone e sem o link", async () => {
    const ana = await ctrl.criarFotografo({ nome: "Ana Lista", telefone: "+5511911112222" });
    const bruno = await ctrl.criarFotografo({ nome: "Bruno Lista", telefone: null });
    const vAna = await ctrl.vincularFotografo(idEvento, ana.id_fotografo);
    const vBruno = await ctrl.vincularFotografo(idEvento, bruno.id_fotografo);
    await ctrl.desvincularFotografo(vBruno.id_evento_fotografo);

    const lista = await ctrl.listarVinculos(idEvento);

    assert.deepStrictEqual(
        lista.find((v) => v.id_evento_fotografo === vAna.id_evento_fotografo),
        { id_evento_fotografo: vAna.id_evento_fotografo, id_fotografo: ana.id_fotografo, nome: "Ana Lista", telefone: "+5511911112222" }
    );
    assert.ok(!lista.some((v) => v.id_evento_fotografo === vBruno.id_evento_fotografo));
});

test("desvincular grava ativo = 'N'", async () => {
    const f = await ctrl.criarFotografo({ nome: "Caio", telefone: null });
    const v = await ctrl.vincularFotografo(idEvento, f.id_fotografo);

    assert.deepStrictEqual(await ctrl.desvincularFotografo(v.id_evento_fotografo), { ok: true });

    const [linha] = await conexao.queryParam<{ ativo: string }>("SELECT ativo FROM evento_fotografo WHERE id_evento_fotografo = ?", [
        v.id_evento_fotografo,
    ]);
    assert.strictEqual(linha.ativo, "N");
});

test("desvincular vínculo que não existe lança ErroTratado", async () => {
    await assert.rejects(() => ctrl.desvincularFotografo(999_999_999), ErroTratado);
});

test("vincular de novo depois de remover reativa com um link novo", async () => {
    const f = await ctrl.criarFotografo({ nome: "Duda", telefone: null });
    const antes = await ctrl.vincularFotografo(idEvento, f.id_fotografo);
    await ctrl.desvincularFotografo(antes.id_evento_fotografo);

    const depois = await ctrl.vincularFotografo(idEvento, f.id_fotografo);

    assert.strictEqual(depois.id_evento_fotografo, antes.id_evento_fotografo);
    assert.strictEqual(depois.ativo, "S");
    assert.notStrictEqual(depois.token_upload, antes.token_upload);
});

test("vincular fotógrafo que não existe lança ErroTratado", async () => {
    await assert.rejects(() => ctrl.vincularFotografo(idEvento, 999_999_999), ErroTratado);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/api && npx tsx --test --test-concurrency=1 integracao/adminFotografo.test.ts`
Expected: FAIL — `ctrl.desvincularFotografo is not a function` / `listarVinculos` não existe.

- [ ] **Step 3: SQL**

Em `apps/api/src/_ADMIN/fotografo/sql.fotografo.ts`:

1. `LinhaVinculo` ganha `ativo: "S" | "N";` e há um tipo novo:

```ts
export interface LinhaVinculoDoEvento {
    id_evento_fotografo: number;
    id_fotografo: number;
    nome: string;
    telefone: string | null;
}
```

2. Em `buscarVinculo` e `inserirVinculo`, a lista de colunas (no `SELECT` e no `RETURNING`) passa a ser `id_evento_fotografo, id_evento, id_fotografo, token_upload, ativo`.

3. Acrescentar:

```ts
export async function fotografoExiste(conexao: ConexaoPostgres, idFotografo: number): Promise<boolean> {
    const linha = await conexao.queryOneParam("SELECT 1 FROM fotografo WHERE id_fotografo = ? AND deletado = 'N'", [idFotografo]);
    return !!linha;
}

export async function reativarVinculo(conexao: ConexaoPostgres, idEventoFotografo: number, tokenUpload: string): Promise<LinhaVinculo> {
    const [linha] = await conexao.queryParam<LinhaVinculo>(
        `UPDATE evento_fotografo SET ativo = 'S', token_upload = ? WHERE id_evento_fotografo = ?
         RETURNING id_evento_fotografo, id_evento, id_fotografo, token_upload, ativo`,
        [tokenUpload, idEventoFotografo]
    );
    return linha;
}

export async function listarVinculosSql(conexao: ConexaoPostgres, idEvento: number): Promise<LinhaVinculoDoEvento[]> {
    return conexao.queryParam<LinhaVinculoDoEvento>(
        `SELECT ef.id_evento_fotografo, ef.id_fotografo, f.nome, f.telefone
           FROM evento_fotografo ef
           JOIN fotografo f ON f.id_fotografo = ef.id_fotografo
          WHERE ef.id_evento = ? AND ef.ativo = 'S'
          ORDER BY f.nome, ef.id_evento_fotografo`,
        [idEvento]
    );
}

export async function desativarVinculo(conexao: ConexaoPostgres, idEventoFotografo: number): Promise<number> {
    return conexao.executeParamCount("UPDATE evento_fotografo SET ativo = 'N' WHERE id_evento_fotografo = ?", [idEventoFotografo]);
}
```

- [ ] **Step 4: Ctrl**

`apps/api/src/_ADMIN/fotografo/ctrl.fotografo.ts` inteiro:

```ts
import ConexaoPostgres from "../../db/conexaoPostgres";
import { ErroTratado } from "../../services/erro";
import { gerarChave } from "../../services/aleatorio";
import {
    buscarVinculo,
    desativarVinculo,
    eventoExiste,
    fotografoExiste,
    inserirFotografo,
    inserirVinculo,
    LinhaFotografo,
    LinhaVinculo,
    LinhaVinculoDoEvento,
    listarFotografosSql,
    listarVinculosSql,
    reativarVinculo,
} from "./sql.fotografo";

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
        if (!(await fotografoExiste(this.conexao, idFotografo))) throw new ErroTratado("Fotógrafo não encontrado.");

        const existente = await buscarVinculo(this.conexao, idEvento, idFotografo);
        if (existente?.ativo === "S") return existente;
        // Link novo ao voltar: se o antigo vazou (foi por isso que o removeram), segue sem valer.
        if (existente) return reativarVinculo(this.conexao, existente.id_evento_fotografo, gerarChave());
        return inserirVinculo(this.conexao, idEvento, idFotografo, gerarChave());
    }

    // Sem o token: o admin não mostra o link de upload, só a estação sabe o próprio endereço.
    async listarVinculos(idEvento: number): Promise<LinhaVinculoDoEvento[]> {
        return listarVinculosSql(this.conexao, idEvento);
    }

    async desvincularFotografo(idEventoFotografo: number): Promise<{ ok: true }> {
        if ((await desativarVinculo(this.conexao, idEventoFotografo)) === 0) throw new ErroTratado("Fotógrafo não encontrado neste evento.");
        return { ok: true };
    }
}
```

- [ ] **Step 5: Rota**

Em `apps/api/src/_ADMIN/fotografo/route.fotografo.ts`:
- em `criarFotografo`, `telefone: req.body.telefone ?? null` → `telefone: req.body.telefone || null`;
- acrescentar os métodos:

```ts
    async listarVinculos(req: Request) {
        if (!req.body.id_evento) return { msg: "Campo id_evento é obrigatório", error: true };
        return this.ctrl.listarVinculos(Number(req.body.id_evento));
    }

    async desvincularFotografo(req: Request) {
        if (!req.body.id_evento_fotografo) return { msg: "Campo id_evento_fotografo é obrigatório", error: true };
        return this.ctrl.desvincularFotografo(Number(req.body.id_evento_fotografo));
    }
```

- [ ] **Step 6: `.http`**

Em `apps/api/src/_ADMIN/fotografo/fotografo.http`, acrescentar no fim:

```http
### Fotógrafos do evento (só os ativos)
POST {{vps}}/api/admin/fotografo
Content-Type: application/json
Authorization: {{token}}

{ "call": "listarVinculos", "id_evento": 1 }

### Remover do evento (o link de upload para de valer)
POST {{vps}}/api/admin/fotografo
Content-Type: application/json
Authorization: {{token}}

{ "call": "desvincularFotografo", "id_evento_fotografo": 1 }
```

- [ ] **Step 7: Rodar e ver passar**

Run: `cd apps/api && npx tsx --test --test-concurrency=1 integracao/adminFotografo.test.ts integracao/estacaoSincronizacao.test.ts && npx tsc -p tsconfig.json --noEmit`
Expected: `# fail 0`; `tsc` sem saída.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/_ADMIN/fotografo apps/api/integracao/adminFotografo.test.ts
git commit -m "feat(api): fotógrafos do evento no admin — listar, remover e reativar com link novo

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Evento desativado chega à estação

**Files:**
- Modify: `apps/api/src/_ESTACAO/sincronizacao/sql.sincronizacao.ts`
- Modify: `apps/api/src/_ESTACAO/sincronizacao/ctrl.sincronizacao.ts`
- Test: `apps/api/integracao/estacaoSincronizacao.test.ts`

**Interfaces:**
- Produces: `listarEventosParaEstacao(conexao)` no lugar de `listarEventosAtivosSync`, com o mesmo retorno. A estação já grava o `ativo` que chega (`jobs/sincronizar.ts`), e o upload já recusa evento inativo.

- [ ] **Step 1: Escrever o teste**

Em `apps/api/integracao/estacaoSincronizacao.test.ts`, antes do teste "recusa sem a chave da estação":

```ts
test("evento desativado há pouco continua indo, para a estação saber; o desativado há mais de 7 dias não", async () => {
    const eventoCtrl = new EventoCtrl(conexao);
    const recente = await eventoCtrl.criarEvento({ nome: "Desativado agora", slug: `desativado-${Date.now()}`, tipo: "esportivo", data_fim: "2026-12-31" });
    await eventoCtrl.editarEvento({ id_evento: recente.id_evento, ativo: false });
    const antigo = await eventoCtrl.criarEvento({ nome: "Desativado há tempo", slug: `desativado-antigo-${Date.now()}`, tipo: "esportivo", data_fim: "2026-12-31" });
    await conexao.executeParamCount("UPDATE evento SET ativo = 'N', updated_at = now() - interval '8 days' WHERE id_evento = ?", [antigo.id_evento]);

    const res = resFalso();
    await per({ body: { call: "getSincronizacao" }, headers: { authorization: config.estacaoChave } } as any, res as never, () => {}, Sincronizacao);

    const eventos = (res.chamadas.body as { eventos: { id_evento: number; ativo: string }[] }).eventos;
    assert.strictEqual(eventos.find((e) => e.id_evento === recente.id_evento)?.ativo, "N");
    assert.ok(!eventos.some((e) => e.id_evento === antigo.id_evento));
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/api && npx tsx --test --test-concurrency=1 integracao/estacaoSincronizacao.test.ts`
Expected: FAIL — o evento recém-desativado não vem (`undefined !== 'N'`).

- [ ] **Step 3: Implementar**

Em `sql.sincronizacao.ts`, trocar a função `listarEventosAtivosSync` inteira por:

```ts
// Desativado há pouco também vai: só assim a estação sabe que ele foi desativado e para de
// aceitar fotos. 7 dias cobre a estação ficar desligada entre um evento e outro.
export async function listarEventosParaEstacao(conexao: ConexaoPostgres): Promise<Omit<LinhaEventoSync, "marca_dagua_caminho">[]> {
    return conexao.queryParam(
        `SELECT id_evento, nome, slug, tipo, privado, chave_acesso, chave_anfitriao, data_inicio, data_fim, ativo, config
           FROM evento
          WHERE deletado = 'N' AND (ativo = 'S' OR updated_at > now() - interval '7 days')`
    );
}
```

Em `ctrl.sincronizacao.ts`, trocar `listarEventosAtivosSync` por `listarEventosParaEstacao` no import e na chamada.

- [ ] **Step 4: Rodar e ver passar**

Run: `cd apps/api && npx tsx --test --test-concurrency=1 integracao/estacaoSincronizacao.test.ts integracao/jobSincronizar.test.ts && npx tsc -p tsconfig.json --noEmit`
Expected: `# fail 0`; `tsc` sem saída.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/_ESTACAO/sincronizacao apps/api/integracao/estacaoSincronizacao.test.ts
git commit -m "fix(api): evento desativado no admin também chega à estação

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Limite de tentativas no login do admin

**Files:**
- Modify: `apps/api/src/_ADMIN/login/route.login.ts`
- Test: `apps/api/integracao/adminLogin.test.ts`

**Interfaces:**
- Produces: `login.login` recusa com 422 `{ msg: "Muitas tentativas. Espere alguns minutos." }` a partir da 11ª tentativa do mesmo IP em 10 min. Chave no Redis: `limite:admin-login:<ip>`.

- [ ] **Step 1: Escrever o teste**

Em `apps/api/integracao/adminLogin.test.ts`:
- acrescentar ao `iniciarConfig` do `before`: `REDIS_PREFIXO: "fotos:teste:vps:",` (as chaves do teste não se misturam com as da API de dev);
- acrescentar o import `import { fecharFila, obterRedis } from "../src/services/fila";`;
- no fim do segundo `before` (o que cria o operador), limpar as contagens de execuções anteriores:

```ts
    const redis = obterRedis();
    const chaves = await redis.keys(`${config.redis.prefixo}limite:admin-login:*`);
    if (chaves.length) await redis.del(...chaves);
```

- depois do último `test(`, e antes do `after(`:

```ts
test("a 11ª tentativa do mesmo IP em 10 minutos é recusada, mesmo com a senha certa", async () => {
    const tentar = async (senha: string) => {
        const res = resFalso();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await per({ headers: {}, ip: "10.9.8.7", body: { call: "login", login, senha } } as any, res as any, () => {}, Login);
        return res.chamadas;
    };
    for (let i = 0; i < 10; i++) await tentar("senha-errada");

    const r = await tentar("senha-correta");

    assert.strictEqual(r.status, 422);
    assert.match(String((r.body as { msg: string }).msg), /Muitas tentativas/);
});
```

- no primeiro `after(`, depois de `await conexao?.close();`: `await fecharFila();`

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd apps/api && npx tsx --test --test-concurrency=1 integracao/adminLogin.test.ts`
Expected: FAIL — a 11ª tentativa com a senha certa entra (`status` `undefined`).

- [ ] **Step 3: Implementar**

`apps/api/src/_ADMIN/login/route.login.ts` inteiro:

```ts
import { Request } from "express";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { config } from "../../services/config";
import { ErroTratado } from "../../services/erro";
import { contarNaJanela, ipDoPedido } from "../../services/limiteTaxa";
import { iContexto, iRota } from "../../services/per";
import LoginCtrl from "./ctrl.login";

const TENTATIVAS_POR_JANELA = 10;
const JANELA_S = 600;

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

        // Com a tela do admin na internet, sem teto dá para tentar senhas sem parar.
        const ip = ipDoPedido(req.headers as Record<string, unknown>, req.ip, config.confiarCloudflare);
        if ((await contarNaJanela(`admin-login:${ip}`, JANELA_S)) > TENTATIVAS_POR_JANELA)
            throw new ErroTratado("Muitas tentativas. Espere alguns minutos.");

        return this.ctrl.login(String(login), String(senha));
    }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd apps/api && npx tsx --test --test-concurrency=1 integracao/adminLogin.test.ts && npx tsc -p tsconfig.json --noEmit`
Expected: `# fail 0`; `tsc` sem saída.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/_ADMIN/login/route.login.ts apps/api/integracao/adminLogin.test.ts
git commit -m "feat(api): limite de tentativas no login do admin

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: App web-admin — base, entrada e lista de eventos

**Files:**
- Modify: `package.json` (raiz)
- Create: `apps/web-admin/package.json`, `vite.config.ts`, `vitest.config.ts`, `tsconfig.json`, `index.html`
- Create: `apps/web-admin/src/main.ts`, `App.vue`, `App.test.ts`, `router.ts`, `estilo.css`
- Create: `apps/web-admin/src/ts/erros.ts`, `ts/sessao.ts`, `ts/api.ts`, `ts/api.test.ts`, `ts/datas.ts`, `ts/datas.test.ts`
- Create: `apps/web-admin/src/componentes/Cabecalho.vue`
- Create: `apps/web-admin/src/pages/entrar/index.vue`, `entrar.ts`, `entrar.test.ts`, `services/entrar.service.ts`
- Create: `apps/web-admin/src/pages/eventos/index.vue`, `eventos.ts`, `eventos.test.ts`, `interfaces.ts`, `services/eventos.service.ts`

**Interfaces:**
- Produces (as Tasks 8 a 11 usam):
  - `chamar<T>(modulo: string, corpo: Record<string, unknown>): Promise<T>` → `POST /api/admin/<modulo>`;
  - `chamarMultipart<T>(modulo: string, forma: FormData): Promise<T>`;
  - `ErroDaApi` (`message`, `codigo?`, `status?`);
  - `sessao: Ref<Sessao | null>`, `aviso: Ref<string>`, `entrarComo(s: Sessao)`, `sair(motivo?: string)`;
  - `dataBr(ymd: string): string`, `periodo(inicio: string | null, fim: string): string`, `hoje(agora?: Date): string`, `fimAntesDoInicio(inicio: string, fim: string): boolean`;
  - `criarRouter(history?: RouterHistory)` e `router`; rotas `entrar` (`/entrar`) e `eventos` (`/`);
  - componente `Cabecalho.vue` (sem props).

- [ ] **Step 1: Workspace e pacote**

Na raiz, em `package.json`, acrescentar `"apps/web-admin"` à lista `workspaces`, depois de `"apps/web-fotografo"`.

`apps/web-admin/package.json`:

```json
{
    "name": "@fotos/web-admin",
    "version": "0.1.0",
    "private": true,
    "type": "module",
    "scripts": {
        "dev": "vite",
        "build": "vue-tsc --noEmit && vite build",
        "preview": "vite preview",
        "typecheck": "vue-tsc --noEmit",
        "test": "vitest run"
    },
    "dependencies": {
        "axios": "^1.20.0",
        "qrcode": "^1.5.4",
        "vue": "^3.5.43",
        "vue-router": "^5.3.1"
    },
    "devDependencies": {
        "@tailwindcss/vite": "^4.3.3",
        "@types/qrcode": "^1.5.5",
        "@vitejs/plugin-vue": "^6.0.9",
        "@vue/test-utils": "^2.5.1",
        "daisyui": "^5.7.46",
        "jsdom": "^30.1.1",
        "tailwindcss": "^4.3.3",
        "typescript": "~5.9",
        "vite": "^8.3.1",
        "vitest": "^5.0.2",
        "vue-tsc": "^3.3.11"
    }
}
```

`apps/web-admin/vite.config.ts`:

```ts
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwind from "@tailwindcss/vite";

// Em produção a tela e a API ficam no domínio do admin, atrás do Traefik do VPS. O proxy
// reproduz isso no desenvolvimento, apontando para a API de dev no papel VPS.
export default defineConfig({
    plugins: [vue(), tailwind()],
    server: {
        port: 5175,
        proxy: {
            "/api": { target: "http://127.0.0.1:3002", changeOrigin: true },
        },
    },
});
```

`apps/web-admin/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
    plugins: [vue()],
    test: { environment: "jsdom", globals: false },
});
```

`apps/web-admin/tsconfig.json`: cópia exata de `apps/web-fotografo/tsconfig.json`.

`apps/web-admin/index.html`:

```html
<!doctype html>
<html lang="pt-BR">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Admin · Fotos</title>
    </head>
    <body>
        <div id="app"></div>
        <script type="module" src="/src/main.ts"></script>
    </body>
</html>
```

Run: `cd /mnt/nvme/PROJETOS/reconhecimento_facial && npm install`
Expected: termina sem erro e o `package-lock.json` passa a ter `apps/web-admin`.

- [ ] **Step 2: Estilo**

`apps/web-admin/src/estilo.css`: copiar `apps/web-fotografo/src/estilo.css` inteiro, apagar as regras `.numero`, `.trilho` e `.trilho > i` (o admin não tem barras nem contadores) e acrescentar dentro do `@layer components`:

```css
    .campo {
        width: 100%;
        border-radius: 8px;
        border: 1px solid var(--borda);
        background: #fff;
        padding: 0.45rem 0.7rem;
    }
```

- [ ] **Step 3: Testes das peças puras e da chamada à API**

`apps/web-admin/src/ts/datas.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { fimAntesDoInicio, hoje, periodo } from "./datas";

describe("datas", () => {
    test("período de um dia, sem início, ou de vários dias", () => {
        expect(periodo("2026-09-27", "2026-09-27")).toBe("27/09/2026");
        expect(periodo(null, "2026-09-27")).toBe("27/09/2026");
        expect(periodo("2026-10-10", "2026-10-11")).toBe("10/10/2026 a 11/10/2026");
    });

    test("hoje no relógio do computador, mesmo tarde da noite", () => {
        expect(hoje(new Date(2026, 8, 7, 23, 30))).toBe("2026-09-07");
    });

    test("fim antes do início; início vazio nunca é", () => {
        expect(fimAntesDoInicio("2026-10-11", "2026-10-10")).toBe(true);
        expect(fimAntesDoInicio("2026-10-10", "2026-10-10")).toBe(false);
        expect(fimAntesDoInicio("", "2026-10-10")).toBe(false);
    });
});
```

`apps/web-admin/src/ts/api.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";

const post = vi.hoisted(() => vi.fn());
vi.mock("axios", () => ({ default: { create: () => ({ post }) } }));

import { chamar } from "./api";
import { ErroDaApi } from "./erros";
import { aviso, entrarComo, sessao } from "./sessao";

beforeEach(() => {
    post.mockReset();
    localStorage.clear();
    entrarComo({ token: "tok", nome: "Ana" });
});

describe("chamar", () => {
    test("manda o token cru no Authorization e o corpo com call", async () => {
        post.mockResolvedValue({ data: [{ id_evento: 1 }] });

        const r = await chamar("evento", { call: "listarEventos" });

        expect(r).toEqual([{ id_evento: 1 }]);
        expect(post).toHaveBeenCalledWith("/admin/evento", { call: "listarEventos" }, { headers: { Authorization: "tok" } });
    });

    test("erro de negócio com HTTP 200 vira ErroDaApi", async () => {
        post.mockResolvedValue({ data: { error: true, msg: "Campo nome é obrigatório" } });
        await expect(chamar("evento", { call: "criarEvento" })).rejects.toThrow("Campo nome é obrigatório");
    });

    test("sessão expirada apaga a sessão e guarda o motivo para a entrada", async () => {
        post.mockRejectedValue({ response: { status: 422, data: { msg: "Sessão expirada, faça login novamente.", codigo: "sessao_expirada" } } });

        await expect(chamar("evento", { call: "listarEventos" })).rejects.toBeInstanceOf(ErroDaApi);

        expect(sessao.value).toBeNull();
        expect(localStorage.getItem("sessao_admin")).toBeNull();
        expect(aviso.value).toBe("Sessão expirada, faça login novamente.");
    });

    test("sem resposta é falta de conexão", async () => {
        post.mockRejectedValue({ request: {} });
        await expect(chamar("evento", { call: "listarEventos" })).rejects.toThrow("Sem conexão com o servidor");
    });
});
```

Run: `cd apps/web-admin && npx vitest run src/ts`
Expected: FAIL — módulos `./datas`, `./api` não existem.

- [ ] **Step 4: Implementar as peças puras, a sessão e a API**

`apps/web-admin/src/ts/datas.ts`:

```ts
// Montado do texto, sem `Date`: "2026-09-26" viraria o dia 25 no fuso do Brasil.
export function dataBr(ymd: string): string {
    return ymd.split("-").reverse().join("/");
}

export function periodo(inicio: string | null, fim: string): string {
    return inicio && inicio !== fim ? `${dataBr(inicio)} a ${dataBr(fim)}` : dataBr(fim);
}

// "Hoje" no relógio do computador do operador, em YYYY-MM-DD.
export function hoje(agora = new Date()): string {
    const d = (n: number) => String(n).padStart(2, "0");
    return `${agora.getFullYear()}-${d(agora.getMonth() + 1)}-${d(agora.getDate())}`;
}

export function fimAntesDoInicio(inicio: string, fim: string): boolean {
    return Boolean(inicio && fim && fim < inicio);
}
```

`apps/web-admin/src/ts/erros.ts`:

```ts
export class ErroDaApi extends Error {
    constructor(
        mensagem: string,
        public codigo?: string,
        public status?: number
    ) {
        super(mensagem);
        this.name = "ErroDaApi";
    }
}

interface RespostaBruta {
    response?: { status?: number; data?: unknown };
    request?: unknown;
}

// A tela reage ao `codigo` (sessão expirada, endereço repetido), nunca ao texto.
export function paraErroDaApi(erro: unknown): ErroDaApi {
    if (erro instanceof ErroDaApi) return erro;
    const bruto = erro as RespostaBruta;

    if (bruto?.response) {
        const { status, data } = bruto.response;
        const corpo = (typeof data === "object" && data !== null ? data : {}) as { msg?: unknown; codigo?: unknown };
        const mensagem = typeof corpo.msg === "string" && corpo.msg ? corpo.msg : `O servidor recusou o pedido (código ${status}).`;
        return new ErroDaApi(mensagem, typeof corpo.codigo === "string" ? corpo.codigo : undefined, status);
    }
    if (bruto?.request) return new ErroDaApi("Sem conexão com o servidor. Confira a internet e tente de novo.");
    return new ErroDaApi("Não conseguimos completar. Tente de novo.");
}
```

`apps/web-admin/src/ts/sessao.ts`:

```ts
import { ref } from "vue";

export interface Sessao {
    token: string;
    nome: string;
}

const CHAVE = "sessao_admin";

function ler(): Sessao | null {
    try {
        const bruto = localStorage.getItem(CHAVE);
        return bruto ? (JSON.parse(bruto) as Sessao) : null;
    } catch {
        return null;
    }
}

// Reativa: o App volta para a entrada quando ela some no meio de uma tela (sessão expirada).
export const sessao = ref<Sessao | null>(ler());
// Por que caiu na entrada ("Sessão expirada…"): a entrada mostra uma vez.
export const aviso = ref("");

export function entrarComo(nova: Sessao): void {
    try {
        localStorage.setItem(CHAVE, JSON.stringify(nova));
    } catch {
        // Sem armazenamento a sessão vale só até recarregar a página.
    }
    sessao.value = nova;
    aviso.value = "";
}

export function sair(motivo = ""): void {
    try {
        localStorage.removeItem(CHAVE);
    } catch {
        // Nada guardado para apagar.
    }
    sessao.value = null;
    aviso.value = motivo;
}
```

`apps/web-admin/src/ts/api.ts`:

```ts
import axios from "axios";
import { ErroDaApi, paraErroDaApi } from "./erros";
import { sair, sessao } from "./sessao";

export { ErroDaApi };

const http = axios.create({ baseURL: "/api", timeout: 30_000 });

// Erro de negócio da API chega com HTTP 200 e `{ error: true }`.
function conferir<T>(dados: unknown): T {
    const corpo = dados as { error?: boolean; msg?: string };
    if (corpo?.error) throw new ErroDaApi(corpo.msg ?? "Não conseguimos completar. Tente de novo.");
    return dados as T;
}

async function enviar<T>(modulo: string, corpo: Record<string, unknown> | FormData): Promise<T> {
    try {
        const { data } = await http.post(`/admin/${modulo}`, corpo, {
            headers: sessao.value ? { Authorization: sessao.value.token } : undefined,
        });
        return conferir<T>(data);
    } catch (bruto) {
        const erro = paraErroDaApi(bruto);
        if (erro.codigo === "sessao_expirada") sair(erro.message);
        throw erro;
    }
}

export function chamar<T>(modulo: string, corpo: Record<string, unknown>): Promise<T> {
    return enviar<T>(modulo, corpo);
}

// Sem Content-Type manual: o axios precisa pôr o boundary do multipart.
export function chamarMultipart<T>(modulo: string, forma: FormData): Promise<T> {
    return enviar<T>(modulo, forma);
}
```

Run: `cd apps/web-admin && npx vitest run src/ts`
Expected: PASS (7 testes).

- [ ] **Step 5: Testes da entrada, da lista e das rotas**

`apps/web-admin/src/pages/entrar/entrar.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import Entrar from "./index.vue";
import { login } from "./services/entrar.service";
import { ErroDaApi } from "../../ts/erros";
import { sair } from "../../ts/sessao";

vi.mock("./services/entrar.service", () => ({ login: vi.fn() }));

async function abrir() {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: "/entrar", name: "entrar", component: Entrar },
            { path: "/", name: "eventos", component: { template: "<p>eventos</p>" } },
        ],
    });
    await router.push("/entrar");
    const tela = mount(Entrar, { global: { plugins: [router] } });
    await flushPromises();
    return { tela, router };
}

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sair();
});

describe("entrar", () => {
    test("login certo guarda a sessão e abre a lista de eventos", async () => {
        vi.mocked(login).mockResolvedValue({ token: "tok-novo", nome: "Ana" });
        const { tela, router } = await abrir();

        await tela.get("input[name=login]").setValue("ana");
        await tela.get("input[name=senha]").setValue("senha-dev-123");
        await tela.get("form").trigger("submit");
        await flushPromises();

        expect(login).toHaveBeenCalledWith("ana", "senha-dev-123");
        expect(JSON.parse(localStorage.getItem("sessao_admin")!)).toEqual({ token: "tok-novo", nome: "Ana" });
        expect(router.currentRoute.value.path).toBe("/");
    });

    test("login errado mostra a mensagem da API e fica na entrada", async () => {
        vi.mocked(login).mockRejectedValue(new ErroDaApi("Login ou senha inválidos.", undefined, 422));
        const { tela, router } = await abrir();

        await tela.get("input[name=login]").setValue("ana");
        await tela.get("input[name=senha]").setValue("errada");
        await tela.get("form").trigger("submit");
        await flushPromises();

        expect(tela.text()).toContain("Login ou senha inválidos.");
        expect(router.currentRoute.value.path).toBe("/entrar");
    });

    test("vindo de uma sessão expirada, mostra o motivo", async () => {
        sair("Sessão expirada, faça login novamente.");
        const { tela } = await abrir();

        expect(tela.text()).toContain("Sessão expirada, faça login novamente.");
    });
});
```

`apps/web-admin/src/pages/eventos/eventos.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import Eventos from "./index.vue";
import { listarEventos } from "./services/eventos.service";
import { entrarComo } from "../../ts/sessao";
import type { EventoDaLista } from "./interfaces";

vi.mock("./services/eventos.service", () => ({ listarEventos: vi.fn() }));

const serra: EventoDaLista = { id_evento: 7, nome: "Corrida da Serra", slug: "corrida-da-serra", tipo: "esportivo", privado: "N", data_inicio: "2026-09-27", data_fim: "2026-09-27", ativo: "S" };
const festa: EventoDaLista = { id_evento: 9, nome: "Festa da Bia", slug: "festa-da-bia", tipo: "social", privado: "S", data_inicio: "2026-10-10", data_fim: "2026-10-11", ativo: "N" };

async function abrir() {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: "/", component: Eventos },
            { path: "/entrar", name: "entrar", component: { template: "<p>entrar</p>" } },
            { path: "/eventos/novo", component: { template: "<p>novo</p>" } },
            { path: "/eventos/:id", component: { template: "<p>evento</p>" } },
        ],
    });
    await router.push("/");
    const tela = mount(Eventos, { global: { plugins: [router] } });
    await flushPromises();
    return { tela, router };
}

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    entrarComo({ token: "tok", nome: "Ana" });
    vi.mocked(listarEventos).mockResolvedValue([serra, festa]);
});

describe("lista de eventos", () => {
    test("mostra período, tipo, acesso e situação", async () => {
        const { tela } = await abrir();

        const texto = tela.text();
        expect(texto).toContain("Corrida da Serra");
        expect(texto).toContain("27/09/2026");
        expect(texto).toContain("10/10/2026 a 11/10/2026");
        expect(texto).toContain("Esportivo");
        expect(texto).toContain("Privado");
        expect(texto).toContain("Inativo");
    });

    test("clicar na linha abre a página do evento", async () => {
        const { tela, router } = await abrir();

        await tela.get("[data-evento='7']").trigger("click");
        await flushPromises();

        expect(router.currentRoute.value.path).toBe("/eventos/7");
    });

    test("sem eventos, convida a criar o primeiro", async () => {
        vi.mocked(listarEventos).mockResolvedValue([]);
        const { tela } = await abrir();

        expect(tela.text()).toContain("Nenhum evento ainda. Crie o primeiro.");
        expect(tela.find("[data-acao=novo-evento]").exists()).toBe(true);
    });

    test("Sair apaga a sessão e volta para a entrada", async () => {
        const { tela, router } = await abrir();

        await tela.get("[data-acao=sair]").trigger("click");
        await flushPromises();

        expect(localStorage.getItem("sessao_admin")).toBeNull();
        expect(router.currentRoute.value.path).toBe("/entrar");
    });
});
```

`apps/web-admin/src/App.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory } from "vue-router";
import App from "./App.vue";
import { criarRouter } from "./router";
import { entrarComo, sair } from "./ts/sessao";

vi.mock("./pages/eventos/services/eventos.service", () => ({ listarEventos: vi.fn().mockResolvedValue([]) }));

// A troca de rota que o App dispara sozinho carrega a tela da entrada sob demanda (import
// dinâmico): leva mais que uma rodada de microtarefas.
async function ate(condicao: () => boolean): Promise<void> {
    for (let i = 0; i < 50 && !condicao(); i++) await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => localStorage.clear());

describe("rotas protegidas", () => {
    test("sem sessão, qualquer tela leva à entrada", async () => {
        sair();
        const router = criarRouter(createMemoryHistory());

        await router.push("/");

        expect(router.currentRoute.value.name).toBe("entrar");
    });

    test("a sessão que expira no meio de uma tela volta para a entrada", async () => {
        entrarComo({ token: "tok", nome: "Ana" });
        const router = criarRouter(createMemoryHistory());
        await router.push("/");
        mount(App, { global: { plugins: [router] } });
        await flushPromises();
        expect(router.currentRoute.value.name).toBe("eventos");

        sair("Sessão expirada, faça login novamente.");
        await ate(() => router.currentRoute.value.name === "entrar");

        expect(router.currentRoute.value.name).toBe("entrar");
    });
});
```

Run: `cd apps/web-admin && npx vitest run`
Expected: FAIL — as telas, o `router` e o `App` não existem.

- [ ] **Step 6: Implementar rotas, App e cabeçalho**

`apps/web-admin/src/router.ts`:

```ts
import { createRouter, createWebHashHistory, type RouterHistory } from "vue-router";
import { sessao } from "./ts/sessao";

// Função, e não só a instância: os testes montam cada um o seu roteador em memória.
export function criarRouter(history: RouterHistory = createWebHashHistory()) {
    const router = createRouter({
        history,
        routes: [
            { path: "/entrar", name: "entrar", component: () => import("./pages/entrar/index.vue") },
            { path: "/", name: "eventos", component: () => import("./pages/eventos/index.vue") },
            { path: "/:qualquer(.*)*", redirect: "/" },
        ],
    });
    router.beforeEach((para) => (para.name !== "entrar" && !sessao.value ? { name: "entrar" } : true));
    return router;
}

export const router = criarRouter();
```

`apps/web-admin/src/App.vue`:

```vue
<script setup lang="ts">
import { watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { sessao } from "./ts/sessao";

const rota = useRoute();
const roteador = useRouter();

// A sessão que some no meio de uma tela (expirou numa chamada) leva de volta à entrada.
watch(sessao, (atual) => {
    if (!atual && rota.name !== "entrar") roteador.replace({ name: "entrar" });
});
</script>

<template>
    <router-view />
</template>
```

`apps/web-admin/src/main.ts`:

```ts
import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import "./estilo.css";

createApp(App).use(router).mount("#app");
```

`apps/web-admin/src/componentes/Cabecalho.vue`:

```vue
<script setup lang="ts">
import { useRouter } from "vue-router";
import { sair, sessao } from "../ts/sessao";

const roteador = useRouter();

function sairAgora(): void {
    sair();
    roteador.replace({ name: "entrar" });
}
</script>

<template>
    <header class="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--borda)] bg-white px-4 py-2.5">
        <div class="flex items-center gap-4">
            <span><span class="selo mr-2"></span><b>Admin</b></span>
            <RouterLink to="/" class="apagado hover:underline">Eventos</RouterLink>
        </div>
        <span v-if="sessao" class="apagado">
            {{ sessao.nome }} · <button type="button" class="underline" data-acao="sair" @click="sairAgora">Sair</button>
        </span>
    </header>
</template>
```

- [ ] **Step 7: Implementar a entrada**

`apps/web-admin/src/pages/entrar/services/entrar.service.ts`:

```ts
import { chamar } from "../../../ts/api";

export function login(usuario: string, senha: string): Promise<{ token: string; nome: string }> {
    return chamar("login", { call: "login", login: usuario, senha });
}
```

`apps/web-admin/src/pages/entrar/entrar.ts`:

```ts
import { reactive } from "vue";
import { aviso, entrarComo } from "../../ts/sessao";
import { login } from "./services/entrar.service";

export const state = reactive({ usuario: "", senha: "", erro: "", entrando: false });

export const actions = {
    init(): void {
        // O motivo de ter caído aqui (sessão expirada) aparece uma vez, no lugar do erro.
        Object.assign(state, { usuario: "", senha: "", erro: aviso.value, entrando: false });
        aviso.value = "";
    },

    async entrar(): Promise<boolean> {
        if (state.entrando) return false;
        state.erro = "";
        state.entrando = true;
        try {
            const r = await login(state.usuario, state.senha);
            entrarComo({ token: r.token, nome: r.nome });
            return true;
        } catch (erro) {
            state.erro = erro instanceof Error ? erro.message : "Não conseguimos entrar.";
            return false;
        } finally {
            state.entrando = false;
        }
    },
};
```

`apps/web-admin/src/pages/entrar/index.vue`:

```vue
<script setup lang="ts">
import { useRouter } from "vue-router";
import { actions, state } from "./entrar";

const roteador = useRouter();
actions.init();

async function entrar(): Promise<void> {
    if (await actions.entrar()) await roteador.replace("/");
}
</script>

<template>
    <main class="pagina flex items-start justify-center p-4">
        <form class="superficie mt-16 w-full max-w-sm p-6" @submit.prevent="entrar">
            <p><span class="selo mr-2"></span><b>Admin</b></p>
            <h1 class="mt-3 text-lg font-extrabold">Entrar</h1>
            <label class="mt-4 block">
                <span class="apagado">Login</span>
                <input v-model="state.usuario" name="login" autocomplete="username" class="campo mt-1" />
            </label>
            <label class="mt-3 block">
                <span class="apagado">Senha</span>
                <input v-model="state.senha" name="senha" type="password" autocomplete="current-password" class="campo mt-1" />
            </label>
            <p v-if="state.erro" class="mt-3 text-[var(--erro)]">{{ state.erro }}</p>
            <button type="submit" class="botao mt-4 w-full" :disabled="state.entrando">Entrar</button>
        </form>
    </main>
</template>
```

`actions.init()` roda direto no `setup` (e não no `nextTick`): o aviso de sessão expirada precisa estar no estado já na primeira pintura.

- [ ] **Step 8: Implementar a lista**

`apps/web-admin/src/pages/eventos/interfaces.ts`:

```ts
export interface EventoDaLista {
    id_evento: number;
    nome: string;
    slug: string;
    tipo: "esportivo" | "social";
    privado: "S" | "N";
    data_inicio: string | null;
    data_fim: string;
    ativo: "S" | "N";
}
```

`apps/web-admin/src/pages/eventos/services/eventos.service.ts`:

```ts
import { chamar } from "../../../ts/api";
import type { EventoDaLista } from "../interfaces";

export function listarEventos(): Promise<EventoDaLista[]> {
    return chamar("evento", { call: "listarEventos" });
}
```

`apps/web-admin/src/pages/eventos/eventos.ts`:

```ts
import { reactive } from "vue";
import type { EventoDaLista } from "./interfaces";
import { listarEventos } from "./services/eventos.service";

export const state = reactive({ carregando: true, eventos: [] as EventoDaLista[], erro: "" });

export const actions = {
    async init(): Promise<void> {
        Object.assign(state, { carregando: true, erro: "" });
        try {
            state.eventos = await listarEventos();
        } catch (erro) {
            state.erro = erro instanceof Error ? erro.message : "Não conseguimos carregar os eventos.";
        } finally {
            state.carregando = false;
        }
    },
};
```

`apps/web-admin/src/pages/eventos/index.vue`:

```vue
<script setup lang="ts">
import { nextTick } from "vue";
import { useRouter } from "vue-router";
import Cabecalho from "../../componentes/Cabecalho.vue";
import { periodo } from "../../ts/datas";
import { actions, state } from "./eventos";

const roteador = useRouter();
nextTick(() => actions.init());
</script>

<template>
    <main class="pagina">
        <Cabecalho />
        <div class="mx-auto max-w-5xl p-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <h1 class="text-lg font-extrabold">Eventos</h1>
                <RouterLink to="/eventos/novo" class="botao" data-acao="novo-evento">Novo evento</RouterLink>
            </div>

            <p v-if="state.carregando" class="apagado mt-4">Carregando…</p>
            <p v-else-if="state.erro" class="mt-4 text-[var(--erro)]">{{ state.erro }}</p>
            <p v-else-if="state.eventos.length === 0" class="superficie mt-4 p-6 text-center">Nenhum evento ainda. Crie o primeiro.</p>
            <div v-else class="superficie mt-4 overflow-x-auto">
                <table class="w-full">
                    <thead>
                        <tr class="rotulo-secao text-left">
                            <th class="px-3 py-2">Evento</th>
                            <th class="px-3 py-2">Período</th>
                            <th class="px-3 py-2">Tipo</th>
                            <th class="px-3 py-2">Acesso</th>
                            <th class="px-3 py-2">Situação</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="e in state.eventos"
                            :key="e.id_evento"
                            :data-evento="e.id_evento"
                            class="cursor-pointer border-t border-[#ececf0] hover:bg-[var(--fundo)]"
                            @click="roteador.push(`/eventos/${e.id_evento}`)"
                        >
                            <td class="px-3 py-2 font-bold">{{ e.nome }}</td>
                            <td class="px-3 py-2">{{ periodo(e.data_inicio, e.data_fim) }}</td>
                            <td class="px-3 py-2">{{ e.tipo === "esportivo" ? "Esportivo" : "Social" }}</td>
                            <td class="px-3 py-2">{{ e.privado === "S" ? "Privado" : "Público" }}</td>
                            <td class="px-3 py-2" :class="e.ativo === 'S' ? 'text-[var(--sucesso)]' : 'apagado'">{{ e.ativo === "S" ? "Ativo" : "Inativo" }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </main>
</template>
```

- [ ] **Step 9: Rodar e ver passar**

Run: `cd apps/web-admin && npx vitest run && npx vue-tsc --noEmit && npx vite build`
Expected: todos os testes passam (16); `vue-tsc` sem saída; o build termina com `dist/index.html`.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json apps/web-admin
git commit -m "feat(web-admin): esqueleto do app, entrada e lista de eventos

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Novo evento

**Files:**
- Create: `apps/web-admin/src/ts/endereco.ts`, `ts/endereco.test.ts`
- Create: `apps/web-admin/src/pages/novo-evento/index.vue`, `novo-evento.ts`, `novo-evento.test.ts`, `interfaces.ts`, `services/novo-evento.service.ts`
- Modify: `apps/web-admin/src/router.ts`

**Interfaces:**
- Consumes (Task 7): `chamar`, `hoje`, `fimAntesDoInicio`, `Cabecalho.vue`. Da API (Task 2): `evento.criarEvento` aceita `data_inicio`, `privado`, `config` e responde `{ id_evento, … }` ou 422 com `codigo: "endereco_repetido"`.
- Produces: rota `novo-evento` (`/eventos/novo`); `enderecoDoNome(texto: string): string`.

- [ ] **Step 1: Escrever os testes**

`apps/web-admin/src/ts/endereco.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { enderecoDoNome } from "./endereco";

describe("enderecoDoNome", () => {
    test("minúsculas, sem acento, espaços e símbolos viram um hífen só", () => {
        expect(enderecoDoNome("Corrida da Serra 2026")).toBe("corrida-da-serra-2026");
        expect(enderecoDoNome("  São João — Festa!! ")).toBe("sao-joao-festa");
        expect(enderecoDoNome("Corrida X!")).toBe("corrida-x");
    });

    test("nada aproveitável vira vazio", () => {
        expect(enderecoDoNome("!!!")).toBe("");
    });

    test("até 80 caracteres, sem hífen sobrando no fim do corte", () => {
        const endereco = enderecoDoNome(`${"a".repeat(79)} b`);
        expect(endereco.length).toBeLessThanOrEqual(80);
        expect(endereco.endsWith("-")).toBe(false);
    });
});
```

`apps/web-admin/src/pages/novo-evento/novo-evento.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import NovoEvento from "./index.vue";
import { criarEvento } from "./services/novo-evento.service";
import { ErroDaApi } from "../../ts/erros";
import { hoje } from "../../ts/datas";
import { entrarComo } from "../../ts/sessao";

vi.mock("./services/novo-evento.service", () => ({ criarEvento: vi.fn() }));

async function abrir() {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: "/eventos/novo", component: NovoEvento },
            { path: "/", component: { template: "<p>lista</p>" } },
            { path: "/entrar", name: "entrar", component: { template: "<p>entrar</p>" } },
            { path: "/eventos/:id", component: { template: "<p>evento</p>" } },
        ],
    });
    await router.push("/eventos/novo");
    const tela = mount(NovoEvento, { global: { plugins: [router] } });
    await flushPromises();
    return { tela, router };
}

const valor = (tela: VueWrapper, seletor: string) => (tela.get(seletor).element as HTMLInputElement).value;
const marcado = (tela: VueWrapper, seletor: string) => (tela.get(seletor).element as HTMLInputElement).checked;

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    entrarComo({ token: "tok", nome: "Ana" });
});

describe("novo evento", () => {
    test("começa com hoje nas duas datas, esportivo, público e sem exigir WhatsApp, com o aviso", async () => {
        const { tela } = await abrir();

        expect(valor(tela, "input[name=data_inicio]")).toBe(hoje());
        expect(valor(tela, "input[name=data_fim]")).toBe(hoje());
        expect(marcado(tela, "input[name=tipo][value=esportivo]")).toBe(true);
        expect(marcado(tela, "input[name=acesso][value=publico]")).toBe(true);
        expect(marcado(tela, "input[name=exigir_whatsapp]")).toBe(false);
        expect(tela.text()).toContain("A verificação por WhatsApp ainda não existe: ligado, o participante não vê as fotos.");
    });

    test("o endereço acompanha o nome até o operador mexer nele", async () => {
        const { tela } = await abrir();

        await tela.get("input[name=nome]").setValue("Corrida da Serra 2026");
        expect(valor(tela, "input[name=endereco]")).toBe("corrida-da-serra-2026");

        await tela.get("input[name=endereco]").setValue("serra-26");
        await tela.get("input[name=nome]").setValue("Corrida da Serra");
        expect(valor(tela, "input[name=endereco]")).toBe("serra-26");
    });

    test("endereço digitado à mão vira endereço válido ao sair do campo", async () => {
        const { tela } = await abrir();

        const campo = tela.get("input[name=endereco]");
        await campo.setValue("Corrida X!");
        await campo.trigger("change");

        expect(valor(tela, "input[name=endereco]")).toBe("corrida-x");
    });

    test("o acesso acompanha o tipo até o operador mexer nele", async () => {
        const { tela } = await abrir();

        await tela.get("input[name=tipo][value=social]").setValue();
        expect(marcado(tela, "input[name=acesso][value=privado]")).toBe(true);

        await tela.get("input[name=acesso][value=publico]").setValue();
        await tela.get("input[name=tipo][value=esportivo]").setValue();
        await tela.get("input[name=tipo][value=social]").setValue();
        expect(marcado(tela, "input[name=acesso][value=publico]")).toBe(true);
    });

    test("criar manda os campos e a config e abre a página do evento", async () => {
        vi.mocked(criarEvento).mockResolvedValue({ id_evento: 42 });
        const { tela, router } = await abrir();

        await tela.get("input[name=nome]").setValue("Corrida da Serra");
        await tela.get("input[name=data_inicio]").setValue("2026-10-10");
        await tela.get("input[name=data_fim]").setValue("2026-10-11");
        await tela.get("form").trigger("submit");
        await flushPromises();

        expect(criarEvento).toHaveBeenCalledWith({
            nome: "Corrida da Serra",
            slug: "corrida-da-serra",
            tipo: "esportivo",
            data_inicio: "2026-10-10",
            data_fim: "2026-10-11",
            privado: false,
            config: { exigir_whatsapp: false },
        });
        expect(router.currentRoute.value.path).toBe("/eventos/42");
    });

    test("dois cliques seguidos em Criar mandam um pedido só", async () => {
        let responder!: (v: { id_evento: number }) => void;
        vi.mocked(criarEvento).mockReturnValue(new Promise((r) => (responder = r)));
        const { tela } = await abrir();
        await tela.get("input[name=nome]").setValue("Corrida");

        await tela.get("form").trigger("submit");
        await tela.get("form").trigger("submit");
        responder({ id_evento: 1 });
        await flushPromises();

        expect(criarEvento).toHaveBeenCalledTimes(1);
    });

    test("endereço repetido: mostra a mensagem e mantém o que foi preenchido", async () => {
        vi.mocked(criarEvento).mockRejectedValue(new ErroDaApi("Esse endereço já é de outro evento.", "endereco_repetido", 422));
        const { tela, router } = await abrir();

        await tela.get("input[name=nome]").setValue("Corrida da Serra");
        await tela.get("form").trigger("submit");
        await flushPromises();

        expect(tela.text()).toContain("Esse endereço já é de outro evento.");
        expect(valor(tela, "input[name=nome]")).toBe("Corrida da Serra");
        expect(router.currentRoute.value.path).toBe("/eventos/novo");
    });

    test("fim antes do início não chega à API", async () => {
        const { tela } = await abrir();

        await tela.get("input[name=nome]").setValue("Corrida");
        await tela.get("input[name=data_inicio]").setValue("2026-10-11");
        await tela.get("input[name=data_fim]").setValue("2026-10-10");
        await tela.get("form").trigger("submit");
        await flushPromises();

        expect(criarEvento).not.toHaveBeenCalled();
        expect(tela.text()).toContain("O fim do evento não pode ser antes do início.");
    });
});
```

Run: `cd apps/web-admin && npx vitest run src/ts/endereco.test.ts src/pages/novo-evento`
Expected: FAIL — módulos não existem.

- [ ] **Step 2: Endereço a partir do nome**

`apps/web-admin/src/ts/endereco.ts`:

```ts
const MAXIMO = 80;

// Mesmo formato que a API aceita: minúsculas, números e hífen, sem hífen nas pontas.
export function enderecoDoNome(texto: string): string {
    return texto
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, MAXIMO)
        .replace(/-+$/, "");
}
```

- [ ] **Step 3: Serviço, estado e tela**

`apps/web-admin/src/pages/novo-evento/interfaces.ts`:

```ts
export interface NovoEvento {
    nome: string;
    slug: string;
    tipo: "esportivo" | "social";
    data_inicio: string | null;
    data_fim: string;
    privado: boolean;
    config: { exigir_whatsapp: boolean };
}
```

`apps/web-admin/src/pages/novo-evento/services/novo-evento.service.ts`:

```ts
import { chamar } from "../../../ts/api";
import type { NovoEvento } from "../interfaces";

export function criarEvento(dados: NovoEvento): Promise<{ id_evento: number }> {
    return chamar("evento", { call: "criarEvento", ...dados });
}
```

`apps/web-admin/src/pages/novo-evento/novo-evento.ts`:

```ts
import { reactive } from "vue";
import { fimAntesDoInicio, hoje } from "../../ts/datas";
import { enderecoDoNome } from "../../ts/endereco";
import { criarEvento } from "./services/novo-evento.service";

function formVazio() {
    const dia = hoje();
    return {
        nome: "",
        slug: "",
        tipo: "esportivo" as "esportivo" | "social",
        data_inicio: dia,
        data_fim: dia,
        privado: false,
        // Desligado enquanto a verificação por WhatsApp não existe (spec §3.3).
        exigir_whatsapp: false,
    };
}

export const state = reactive({ form: formVazio(), slugEditado: false, acessoEditado: false, salvando: false, erro: "" });

export const actions = {
    init(): void {
        Object.assign(state, { form: formVazio(), slugEditado: false, acessoEditado: false, salvando: false, erro: "" });
    },

    mudarNome(nome: string): void {
        state.form.nome = nome;
        if (!state.slugEditado) state.form.slug = enderecoDoNome(nome);
    },

    editarEndereco(valor: string): void {
        state.slugEditado = true;
        state.form.slug = valor;
    },

    // Ao sair do campo: o que o operador digitou vira um endereço válido, em vez de voltar
    // recusado pela API com uma mensagem técnica.
    arrumarEndereco(): void {
        state.form.slug = enderecoDoNome(state.form.slug);
    },

    mudarTipo(tipo: "esportivo" | "social"): void {
        state.form.tipo = tipo;
        if (!state.acessoEditado) state.form.privado = tipo === "social";
    },

    mudarAcesso(privado: boolean): void {
        state.acessoEditado = true;
        state.form.privado = privado;
    },

    async criar(): Promise<number | null> {
        if (state.salvando) return null;
        const f = state.form;
        const nome = f.nome.trim();
        if (!nome) return falhar("Informe o nome do evento.");
        if (!f.slug) return falhar("Informe o endereço do evento.");
        if (!f.data_fim) return falhar("Informe a data de fim.");
        if (fimAntesDoInicio(f.data_inicio, f.data_fim)) return falhar("O fim do evento não pode ser antes do início.");

        state.erro = "";
        state.salvando = true;
        try {
            const evento = await criarEvento({
                nome,
                slug: f.slug,
                tipo: f.tipo,
                data_inicio: f.data_inicio || null,
                data_fim: f.data_fim,
                privado: f.privado,
                config: { exigir_whatsapp: f.exigir_whatsapp },
            });
            return evento.id_evento;
        } catch (erro) {
            return falhar(erro instanceof Error ? erro.message : "Não conseguimos criar o evento.");
        } finally {
            state.salvando = false;
        }
    },
};

function falhar(mensagem: string): null {
    state.erro = mensagem;
    return null;
}
```

`apps/web-admin/src/pages/novo-evento/index.vue`:

```vue
<script setup lang="ts">
import { useRouter } from "vue-router";
import Cabecalho from "../../componentes/Cabecalho.vue";
import { actions, state } from "./novo-evento";

const roteador = useRouter();
actions.init();

const texto = (ev: Event) => (ev.target as HTMLInputElement).value;

async function criar(): Promise<void> {
    const id = await actions.criar();
    if (id !== null) await roteador.push(`/eventos/${id}`);
}
</script>

<template>
    <main class="pagina">
        <Cabecalho />
        <div class="mx-auto max-w-2xl p-4">
            <h1 class="text-lg font-extrabold">Novo evento</h1>
            <form class="superficie mt-3 grid gap-3 p-4 sm:grid-cols-2" @submit.prevent="criar">
                <label class="block sm:col-span-2">
                    <span class="apagado">Nome</span>
                    <input name="nome" class="campo mt-1" :value="state.form.nome" @input="actions.mudarNome(texto($event))" />
                </label>
                <label class="block sm:col-span-2">
                    <span class="apagado">Endereço</span>
                    <input
                        name="endereco"
                        class="campo mt-1"
                        :value="state.form.slug"
                        @input="actions.editarEndereco(texto($event))"
                        @change="actions.arrumarEndereco()"
                    />
                    <span class="apagado mt-1 block">Vai no link do participante quando o evento é público.</span>
                </label>
                <fieldset>
                    <legend class="apagado">Tipo</legend>
                    <label class="mr-4"><input type="radio" name="tipo" value="esportivo" :checked="state.form.tipo === 'esportivo'" @change="actions.mudarTipo('esportivo')" /> Esportivo</label>
                    <label><input type="radio" name="tipo" value="social" :checked="state.form.tipo === 'social'" @change="actions.mudarTipo('social')" /> Social</label>
                </fieldset>
                <fieldset>
                    <legend class="apagado">Acesso</legend>
                    <label class="mr-4"><input type="radio" name="acesso" value="publico" :checked="!state.form.privado" @change="actions.mudarAcesso(false)" /> Público</label>
                    <label><input type="radio" name="acesso" value="privado" :checked="state.form.privado" @change="actions.mudarAcesso(true)" /> Privado</label>
                </fieldset>
                <label class="block">
                    <span class="apagado">Início</span>
                    <input v-model="state.form.data_inicio" type="date" name="data_inicio" class="campo mt-1" />
                </label>
                <label class="block">
                    <span class="apagado">Fim</span>
                    <input v-model="state.form.data_fim" type="date" name="data_fim" class="campo mt-1" />
                </label>
                <div class="sm:col-span-2">
                    <label class="flex items-center gap-2"><input v-model="state.form.exigir_whatsapp" type="checkbox" name="exigir_whatsapp" /> Exigir WhatsApp</label>
                    <p class="aviso mt-1 px-3 py-2">A verificação por WhatsApp ainda não existe: ligado, o participante não vê as fotos.</p>
                </div>
                <p v-if="state.erro" class="text-[var(--erro)] sm:col-span-2">{{ state.erro }}</p>
                <div class="flex gap-2 sm:col-span-2">
                    <button type="submit" class="botao" :disabled="state.salvando">Criar evento</button>
                    <RouterLink to="/" class="botao-secundario">Cancelar</RouterLink>
                </div>
            </form>
        </div>
    </main>
</template>
```

- [ ] **Step 4: Rota**

Em `apps/web-admin/src/router.ts`, depois da rota `eventos`:

```ts
            { path: "/eventos/novo", name: "novo-evento", component: () => import("./pages/novo-evento/index.vue") },
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd apps/web-admin && npx vitest run && npx vue-tsc --noEmit`
Expected: todos passam; `vue-tsc` sem saída.

- [ ] **Step 6: Commit**

```bash
git add apps/web-admin
git commit -m "feat(web-admin): novo evento

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Página do evento — dados e marca d'água

**Files:**
- Create: `apps/web-admin/src/pages/evento/index.vue`, `evento.ts`, `evento.test.ts`, `interfaces.ts`, `services/evento.service.ts`, `components/Dados.vue`
- Modify: `apps/web-admin/src/router.ts`

**Interfaces:**
- Consumes (Task 7): `chamar`, `chamarMultipart`, `periodo`, `fimAntesDoInicio`, `Cabecalho.vue`. Da API (Tasks 2 e 3): `obterEvento`/`editarEvento` devolvem o evento com `links`; `subirMarcaDagua` (multipart `call`, `id_evento`, `logo`).
- Produces (Tasks 10 e 11 estendem):
  - `state` e `actions` em `pages/evento/evento.ts`, com `estadoInicial()` e `actions.init(idEvento)`;
  - interfaces `ConfigEvento`, `Evento` (com `links: { participante: string; anfitriao: string } | null`), `FormDados`, `DadosEdicao`;
  - rota `evento` (`/eventos/:id`).

- [ ] **Step 1: Escrever os testes**

`apps/web-admin/src/pages/evento/evento.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import PaginaEvento from "./index.vue";
import { editarEvento, obterEvento, subirMarcaDagua } from "./services/evento.service";
import { ErroDaApi } from "../../ts/erros";
import { entrarComo } from "../../ts/sessao";
import type { Evento } from "./interfaces";

vi.mock("./services/evento.service", () => ({
    obterEvento: vi.fn(),
    editarEvento: vi.fn(),
    subirMarcaDagua: vi.fn(),
}));

function eventoFalso(parcial: Partial<Evento> = {}): Evento {
    return {
        id_evento: 7,
        nome: "Corrida da Serra",
        slug: "corrida-da-serra",
        tipo: "esportivo",
        privado: "N",
        chave_acesso: null,
        chave_anfitriao: "anf123",
        data_inicio: "2026-09-27",
        data_fim: "2026-09-27",
        ativo: "S",
        config: {
            limiar: 0.42,
            exigir_whatsapp: false,
            marca_dagua: false,
            organizador: "Corrida da Serra",
            dias_expurgo: 90,
            validade_resultado_dias: 30,
            max_selfies: 3,
        },
        links: { participante: "http://localhost:8080/#/e/corrida-da-serra", anfitriao: "http://localhost:8080/#/a/anf123" },
        ...parcial,
    };
}

async function abrir(id = 7) {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: "/eventos/:id", component: PaginaEvento },
            { path: "/", component: { template: "<p>lista</p>" } },
            { path: "/entrar", name: "entrar", component: { template: "<p>entrar</p>" } },
        ],
    });
    await router.push(`/eventos/${id}`);
    const tela = mount(PaginaEvento, { global: { plugins: [router] } });
    await flushPromises();
    return { tela, router };
}

const valor = (tela: VueWrapper, seletor: string) => (tela.get(seletor).element as HTMLInputElement).value;

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    entrarComo({ token: "tok", nome: "Ana" });
    vi.mocked(obterEvento).mockResolvedValue(eventoFalso());
});

describe("página do evento — dados", () => {
    test("mostra os dados para editar; endereço e tipo só para leitura", async () => {
        const { tela } = await abrir();

        expect(obterEvento).toHaveBeenCalledWith(7);
        expect(valor(tela, "input[name=nome]")).toBe("Corrida da Serra");
        expect(tela.text()).toContain("corrida-da-serra");
        expect(tela.find("input[name=endereco]").exists()).toBe(false);
        expect(tela.text()).toContain("A verificação por WhatsApp ainda não existe: ligado, o participante não vê as fotos.");
    });

    test("salvar manda os campos e a config; validade apagada vai como null", async () => {
        vi.mocked(editarEvento).mockResolvedValue(eventoFalso({ nome: "Corrida Nova" }));
        const { tela } = await abrir();

        await tela.get("input[name=nome]").setValue("Corrida Nova");
        await tela.get("input[name=validade_resultado_dias]").setValue("");
        await tela.get("form[data-form=dados]").trigger("submit");
        await flushPromises();

        expect(editarEvento).toHaveBeenCalledWith(7, {
            nome: "Corrida Nova",
            data_inicio: "2026-09-27",
            data_fim: "2026-09-27",
            privado: false,
            ativo: true,
            config: {
                organizador: "Corrida da Serra",
                exigir_whatsapp: false,
                marca_dagua: false,
                limiar: 0.42,
                max_selfies: 3,
                dias_expurgo: 90,
                validade_resultado_dias: null,
            },
        });
        expect(tela.text()).toContain("Salvo. A estação recebe a mudança em até 1 minuto.");
    });

    test("erro da API aparece sem perder o que foi digitado", async () => {
        vi.mocked(editarEvento).mockRejectedValue(new ErroDaApi("O máximo de selfies deve ser de 1 a 5.", undefined, 422));
        const { tela } = await abrir();

        await tela.get("input[name=nome]").setValue("Corrida Nova");
        await tela.get("form[data-form=dados]").trigger("submit");
        await flushPromises();

        expect(tela.text()).toContain("O máximo de selfies deve ser de 1 a 5.");
        expect(valor(tela, "input[name=nome]")).toBe("Corrida Nova");
    });

    test("fim antes do início não chega à API", async () => {
        const { tela } = await abrir();

        await tela.get("input[name=data_fim]").setValue("2026-09-20");
        await tela.get("form[data-form=dados]").trigger("submit");
        await flushPromises();

        expect(editarEvento).not.toHaveBeenCalled();
        expect(tela.text()).toContain("O fim do evento não pode ser antes do início.");
    });

    test("evento que não existe: mensagem e caminho de volta para a lista", async () => {
        vi.mocked(obterEvento).mockRejectedValue(new ErroDaApi("Evento não encontrado.", undefined, 422));
        const { tela } = await abrir(999);

        expect(tela.text()).toContain("Evento não encontrado.");
        // O cabeçalho também leva a "/": o que importa é o botão de volta dentro da página.
        expect(tela.get("[data-acao=voltar]").text()).toBe("Voltar aos eventos");
    });

    test("enviar a marca d'água: sucesso e recusa", async () => {
        const { tela } = await abrir();
        const arquivo = new File(["png"], "marca.png", { type: "image/png" });
        const campo = tela.get("input[name=marca]");
        Object.defineProperty(campo.element, "files", { value: [arquivo], configurable: true });

        vi.mocked(subirMarcaDagua).mockResolvedValue({ ok: true });
        await campo.trigger("change");
        await flushPromises();
        expect(subirMarcaDagua).toHaveBeenCalledWith(7, arquivo);
        expect(tela.text()).toContain("Marca d'água enviada.");

        vi.mocked(subirMarcaDagua).mockRejectedValue(new ErroDaApi("A marca d'água deve ser um PNG.", undefined, 422));
        await campo.trigger("change");
        await flushPromises();
        expect(tela.text()).toContain("A marca d'água deve ser um PNG.");
    });
});
```

Run: `cd apps/web-admin && npx vitest run src/pages/evento`
Expected: FAIL — módulos não existem.

- [ ] **Step 2: Interfaces e serviço**

`apps/web-admin/src/pages/evento/interfaces.ts`:

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

export interface Evento {
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
    links: { participante: string; anfitriao: string } | null;
}

// Campo numérico apagado chega do v-model como "" (o Vue só converte o que é número).
export interface FormDados {
    nome: string;
    data_inicio: string;
    data_fim: string;
    privado: boolean;
    ativo: boolean;
    organizador: string;
    exigir_whatsapp: boolean;
    marca_dagua: boolean;
    limiar: number | "";
    max_selfies: number | "";
    dias_expurgo: number | "";
    validade_resultado_dias: number | "";
}

export interface DadosEdicao {
    nome: string;
    data_inicio: string | null;
    data_fim: string;
    privado: boolean;
    ativo: boolean;
    config: Omit<ConfigEvento, "limiar" | "max_selfies" | "dias_expurgo"> & {
        limiar: number | "";
        max_selfies: number | "";
        dias_expurgo: number | "";
    };
}
```

`apps/web-admin/src/pages/evento/services/evento.service.ts`:

```ts
import { chamar, chamarMultipart } from "../../../ts/api";
import type { DadosEdicao, Evento } from "../interfaces";

export function obterEvento(idEvento: number): Promise<Evento> {
    return chamar("evento", { call: "obterEvento", id_evento: idEvento });
}

export function editarEvento(idEvento: number, dados: DadosEdicao): Promise<Evento> {
    return chamar("evento", { call: "editarEvento", id_evento: idEvento, ...dados });
}

export function subirMarcaDagua(idEvento: number, arquivo: File): Promise<{ ok: true }> {
    const forma = new FormData();
    forma.append("call", "subirMarcaDagua");
    forma.append("id_evento", String(idEvento));
    forma.append("logo", arquivo);
    return chamarMultipart("evento", forma);
}
```

- [ ] **Step 3: Estado e ações**

`apps/web-admin/src/pages/evento/evento.ts`:

```ts
import { reactive } from "vue";
import { fimAntesDoInicio } from "../../ts/datas";
import type { DadosEdicao, Evento, FormDados } from "./interfaces";
import { editarEvento, obterEvento, subirMarcaDagua } from "./services/evento.service";

export function formDoEvento(e: Evento): FormDados {
    return {
        nome: e.nome,
        data_inicio: e.data_inicio ?? "",
        data_fim: e.data_fim,
        privado: e.privado === "S",
        ativo: e.ativo === "S",
        organizador: e.config.organizador,
        exigir_whatsapp: e.config.exigir_whatsapp,
        marca_dagua: e.config.marca_dagua,
        limiar: e.config.limiar,
        max_selfies: e.config.max_selfies,
        dias_expurgo: e.config.dias_expurgo,
        validade_resultado_dias: e.config.validade_resultado_dias ?? "",
    };
}

// Os números vazios seguem como "" e a API responde com a faixa do campo; só a validade
// vazia tem sentido próprio ("sem validade") e vira null.
function dadosDoForm(f: FormDados): DadosEdicao {
    return {
        nome: f.nome,
        data_inicio: f.data_inicio || null,
        data_fim: f.data_fim,
        privado: f.privado,
        ativo: f.ativo,
        config: {
            organizador: f.organizador,
            exigir_whatsapp: f.exigir_whatsapp,
            marca_dagua: f.marca_dagua,
            limiar: f.limiar,
            max_selfies: f.max_selfies,
            dias_expurgo: f.dias_expurgo,
            validade_resultado_dias: f.validade_resultado_dias === "" ? null : f.validade_resultado_dias,
        },
    };
}

const mensagem = (erro: unknown, padrao: string) => (erro instanceof Error ? erro.message : padrao);

function estadoInicial() {
    return {
        carregando: true,
        erro: "",
        evento: null as Evento | null,
        form: null as FormDados | null,
        salvando: false,
        mensagemDados: "",
        erroDados: "",
        enviandoMarca: false,
        mensagemMarca: "",
        erroMarca: "",
    };
}

export const state = reactive(estadoInicial());

export const actions = {
    async init(idEvento: number): Promise<void> {
        Object.assign(state, estadoInicial());
        try {
            const evento = await obterEvento(idEvento);
            state.evento = evento;
            state.form = formDoEvento(evento);
        } catch (erro) {
            state.erro = mensagem(erro, "Não conseguimos abrir o evento.");
        } finally {
            state.carregando = false;
        }
    },

    async salvar(): Promise<void> {
        if (!state.evento || !state.form || state.salvando) return;
        Object.assign(state, { mensagemDados: "", erroDados: "" });
        if (fimAntesDoInicio(state.form.data_inicio, state.form.data_fim)) {
            state.erroDados = "O fim do evento não pode ser antes do início.";
            return;
        }
        state.salvando = true;
        try {
            const evento = await editarEvento(state.evento.id_evento, dadosDoForm(state.form));
            state.evento = evento;
            state.form = formDoEvento(evento);
            state.mensagemDados = "Salvo. A estação recebe a mudança em até 1 minuto.";
        } catch (erro) {
            state.erroDados = mensagem(erro, "Não conseguimos salvar.");
        } finally {
            state.salvando = false;
        }
    },

    async enviarMarca(arquivo: File): Promise<void> {
        if (!state.evento) return;
        Object.assign(state, { mensagemMarca: "", erroMarca: "", enviandoMarca: true });
        try {
            await subirMarcaDagua(state.evento.id_evento, arquivo);
            state.mensagemMarca = "Marca d'água enviada.";
        } catch (erro) {
            state.erroMarca = mensagem(erro, "Não conseguimos enviar a marca d'água.");
        } finally {
            state.enviandoMarca = false;
        }
    },
};
```

- [ ] **Step 4: Telas**

`apps/web-admin/src/pages/evento/components/Dados.vue`:

```vue
<script setup lang="ts">
import { actions, state } from "../evento";

function escolherMarca(ev: Event): void {
    const arquivo = (ev.target as HTMLInputElement).files?.[0];
    if (arquivo) actions.enviarMarca(arquivo);
}
</script>

<template>
    <section v-if="state.evento && state.form" class="superficie mt-4 p-4" data-bloco="dados">
        <p class="rotulo-secao">Dados</p>
        <form data-form="dados" class="mt-2 grid gap-3 sm:grid-cols-2" @submit.prevent="actions.salvar()">
            <label class="block sm:col-span-2">
                <span class="apagado">Nome</span>
                <input v-model="state.form.nome" name="nome" class="campo mt-1" />
            </label>
            <p class="apagado sm:col-span-2">
                Endereço <b>{{ state.evento.slug }}</b> · {{ state.evento.tipo === "esportivo" ? "Esportivo" : "Social" }} — não mudam depois de
                criado, para não quebrar os links já distribuídos.
            </p>
            <label class="block">
                <span class="apagado">Início</span>
                <input v-model="state.form.data_inicio" type="date" name="data_inicio" class="campo mt-1" />
            </label>
            <label class="block">
                <span class="apagado">Fim</span>
                <input v-model="state.form.data_fim" type="date" name="data_fim" class="campo mt-1" />
            </label>
            <fieldset>
                <legend class="apagado">Acesso</legend>
                <label class="mr-4"><input v-model="state.form.privado" type="radio" name="acesso" :value="false" /> Público</label>
                <label><input v-model="state.form.privado" type="radio" name="acesso" :value="true" /> Privado</label>
            </fieldset>
            <label class="flex items-center gap-2"><input v-model="state.form.ativo" type="checkbox" name="ativo" /> Evento ativo</label>
            <label class="block sm:col-span-2">
                <span class="apagado">Organizador (o nome que o participante vê)</span>
                <input v-model="state.form.organizador" name="organizador" class="campo mt-1" />
            </label>
            <div class="sm:col-span-2">
                <label class="flex items-center gap-2"><input v-model="state.form.exigir_whatsapp" type="checkbox" name="exigir_whatsapp" /> Exigir WhatsApp</label>
                <p class="aviso mt-1 px-3 py-2">A verificação por WhatsApp ainda não existe: ligado, o participante não vê as fotos.</p>
            </div>
            <div class="sm:col-span-2">
                <label class="flex items-center gap-2"><input v-model="state.form.marca_dagua" type="checkbox" name="marca_dagua" /> Marca d'água nas fotos</label>
                <label class="mt-2 block">
                    <span class="apagado">Enviar PNG (até 2 MB) — vale para as fotos processadas depois do envio.</span>
                    <input type="file" name="marca" accept="image/png" class="mt-1 block" :disabled="state.enviandoMarca" @change="escolherMarca" />
                </label>
                <p v-if="state.mensagemMarca" class="mt-1 text-[var(--sucesso)]">{{ state.mensagemMarca }}</p>
                <p v-if="state.erroMarca" class="mt-1 text-[var(--erro)]">{{ state.erroMarca }}</p>
            </div>
            <details class="sm:col-span-2">
                <summary class="cursor-pointer font-bold">Avançado</summary>
                <div class="mt-2 grid gap-3 sm:grid-cols-2">
                    <label class="block">
                        <span class="apagado">Limiar de semelhança (0,20 a 0,80)</span>
                        <input v-model="state.form.limiar" type="number" step="0.01" min="0.2" max="0.8" name="limiar" class="campo mt-1" />
                    </label>
                    <label class="block">
                        <span class="apagado">Máximo de selfies (1 a 5)</span>
                        <input v-model="state.form.max_selfies" type="number" min="1" max="5" name="max_selfies" class="campo mt-1" />
                    </label>
                    <label class="block">
                        <span class="apagado">Dias até apagar o evento (1 a 3650)</span>
                        <input v-model="state.form.dias_expurgo" type="number" min="1" max="3650" name="dias_expurgo" class="campo mt-1" />
                    </label>
                    <label class="block">
                        <span class="apagado">Validade do resultado, em dias (vazio = sem validade)</span>
                        <input v-model="state.form.validade_resultado_dias" type="number" min="1" max="3650" name="validade_resultado_dias" class="campo mt-1" />
                    </label>
                </div>
            </details>
            <p v-if="state.erroDados" class="text-[var(--erro)] sm:col-span-2">{{ state.erroDados }}</p>
            <p v-if="state.mensagemDados" class="text-[var(--sucesso)] sm:col-span-2">{{ state.mensagemDados }}</p>
            <div class="sm:col-span-2">
                <button type="submit" class="botao" :disabled="state.salvando">Salvar</button>
            </div>
        </form>
    </section>
</template>
```

`apps/web-admin/src/pages/evento/index.vue`:

```vue
<script setup lang="ts">
import { nextTick } from "vue";
import { useRoute } from "vue-router";
import Cabecalho from "../../componentes/Cabecalho.vue";
import { periodo } from "../../ts/datas";
import Dados from "./components/Dados.vue";
import { actions, state } from "./evento";

const rota = useRoute();
nextTick(() => actions.init(Number(rota.params.id)));
</script>

<template>
    <main class="pagina">
        <Cabecalho />
        <div class="mx-auto max-w-4xl p-4">
            <p v-if="state.carregando" class="apagado">Carregando…</p>
            <div v-else-if="state.erro" class="superficie p-6 text-center">
                <p class="text-base font-extrabold">{{ state.erro }}</p>
                <RouterLink to="/" class="botao-secundario mt-3 inline-block" data-acao="voltar">Voltar aos eventos</RouterLink>
            </div>
            <template v-else-if="state.evento">
                <h1 class="text-lg font-extrabold">{{ state.evento.nome }}</h1>
                <p class="apagado">
                    {{ periodo(state.evento.data_inicio, state.evento.data_fim) }} · {{ state.evento.privado === "S" ? "Privado" : "Público" }} ·
                    {{ state.evento.ativo === "S" ? "Ativo" : "Inativo" }}
                </p>
                <Dados />
            </template>
        </div>
    </main>
</template>
```

- [ ] **Step 5: Rota**

Em `apps/web-admin/src/router.ts`, depois da rota `novo-evento`:

```ts
            { path: "/eventos/:id(\\d+)", name: "evento", component: () => import("./pages/evento/index.vue") },
```

- [ ] **Step 6: Rodar e ver passar**

Run: `cd apps/web-admin && npx vitest run && npx vue-tsc --noEmit`
Expected: todos passam; `vue-tsc` sem saída.

- [ ] **Step 7: Commit**

```bash
git add apps/web-admin
git commit -m "feat(web-admin): página do evento — dados e marca d'água

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Página do evento — links e QR

**Files:**
- Create: `apps/web-admin/src/componentes/QrCode.vue`
- Create: `apps/web-admin/src/pages/evento/components/Links.vue`
- Create: `apps/web-admin/src/pages/evento/links.test.ts`
- Modify: `apps/web-admin/src/pages/evento/evento.ts`, `pages/evento/index.vue`

**Interfaces:**
- Consumes (Task 9): `state.evento.links`, `state.evento.privado`, `state.evento.ativo`, `estadoInicial()`.
- Produces: `actions.copiar(texto: string)`, `actions.abrirQr(link: string)`, `actions.fecharQr()`; campos `qrGrande` e `mensagemLinks` no estado.

- [ ] **Step 1: Escrever os testes**

`apps/web-admin/src/pages/evento/links.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import PaginaEvento from "./index.vue";
import { obterEvento } from "./services/evento.service";
import { entrarComo } from "../../ts/sessao";
import type { Evento } from "./interfaces";

vi.mock("./services/evento.service", () => ({
    obterEvento: vi.fn(),
    editarEvento: vi.fn(),
    subirMarcaDagua: vi.fn(),
    listarVinculos: vi.fn().mockResolvedValue([]),
    listarFotografos: vi.fn().mockResolvedValue([]),
    criarFotografo: vi.fn(),
    vincularFotografo: vi.fn(),
    desvincularFotografo: vi.fn(),
}));

function eventoFalso(parcial: Partial<Evento> = {}): Evento {
    return {
        id_evento: 7,
        nome: "Corrida da Serra",
        slug: "corrida-da-serra",
        tipo: "esportivo",
        privado: "N",
        chave_acesso: null,
        chave_anfitriao: "anf123",
        data_inicio: "2026-09-27",
        data_fim: "2026-09-27",
        ativo: "S",
        config: { limiar: 0.42, exigir_whatsapp: false, marca_dagua: false, organizador: "X", dias_expurgo: 90, validade_resultado_dias: null, max_selfies: 3 },
        links: { participante: "http://localhost:8080/#/e/corrida-da-serra", anfitriao: "http://localhost:8080/#/a/anf123" },
        ...parcial,
    };
}

async function abrir() {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: "/eventos/:id", component: PaginaEvento },
            { path: "/", component: { template: "<p>lista</p>" } },
            { path: "/entrar", name: "entrar", component: { template: "<p>entrar</p>" } },
        ],
    });
    await router.push("/eventos/7");
    const tela = mount(PaginaEvento, { global: { plugins: [router] } });
    await flushPromises();
    return tela;
}

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    entrarComo({ token: "tok", nome: "Ana" });
    vi.mocked(obterEvento).mockResolvedValue(eventoFalso());
});

describe("página do evento — links", () => {
    test("mostra o link do participante e o do anfitrião, cada um com QR", async () => {
        const tela = await abrir();

        expect(tela.get("[data-link=participante]").text()).toContain("http://localhost:8080/#/e/corrida-da-serra");
        expect(tela.get("[data-link=anfitriao]").text()).toContain("http://localhost:8080/#/a/anf123");
        expect(tela.findAll("[data-bloco=links] svg").length).toBe(2);
    });

    test("copiar põe o link na área de transferência; sem permissão, explica", async () => {
        const escrever = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", { value: { writeText: escrever }, configurable: true });
        const tela = await abrir();

        await tela.get("[data-acao=copiar-participante]").trigger("click");
        await flushPromises();
        expect(escrever).toHaveBeenCalledWith("http://localhost:8080/#/e/corrida-da-serra");
        expect(tela.text()).toContain("Link copiado.");

        escrever.mockRejectedValue(new Error("negado"));
        await tela.get("[data-acao=copiar-anfitriao]").trigger("click");
        await flushPromises();
        expect(tela.text()).toContain("O navegador não deixou copiar. Selecione o link e copie à mão.");
    });

    test("QR grande abre em tela cheia e fecha no clique", async () => {
        const tela = await abrir();

        await tela.get("[data-acao=qr-participante]").trigger("click");
        expect(tela.find("[data-qr-grande] svg").exists()).toBe(true);

        await tela.get("[data-qr-grande]").trigger("click");
        expect(tela.find("[data-qr-grande]").exists()).toBe(false);
    });

    test("sem ENDERECO_PARTICIPANTE no VPS, diz o que configurar", async () => {
        vi.mocked(obterEvento).mockResolvedValue(eventoFalso({ links: null }));
        const tela = await abrir();

        expect(tela.text()).toContain("Configure ENDERECO_PARTICIPANTE no VPS para ver os links.");
    });

    test("evento inativo avisa que o participante não consegue buscar", async () => {
        vi.mocked(obterEvento).mockResolvedValue(eventoFalso({ ativo: "N" }));
        const tela = await abrir();

        expect(tela.text()).toContain("Evento inativo: o participante não consegue buscar as fotos.");
    });
});
```

O mock já lista as funções de fotógrafo da Task 11, para este arquivo não precisar mudar depois.

Run: `cd apps/web-admin && npx vitest run src/pages/evento/links.test.ts`
Expected: FAIL — não há bloco de links.

- [ ] **Step 2: QR**

`apps/web-admin/src/componentes/QrCode.vue`: cópia exata de `apps/web-fotografo/src/componentes/QrCode.vue`.

- [ ] **Step 3: Estado e ações**

Em `apps/web-admin/src/pages/evento/evento.ts`:
- em `estadoInicial()`, acrescentar `qrGrande: "",` e `mensagemLinks: "",`;
- em `actions`, acrescentar:

```ts
    async copiar(texto: string): Promise<void> {
        try {
            await navigator.clipboard.writeText(texto);
            state.mensagemLinks = "Link copiado.";
        } catch {
            // Fora de HTTPS o navegador não libera a área de transferência: o link está na tela.
            state.mensagemLinks = "O navegador não deixou copiar. Selecione o link e copie à mão.";
        }
    },

    abrirQr(link: string): void {
        state.qrGrande = link;
    },

    fecharQr(): void {
        state.qrGrande = "";
    },
```

- [ ] **Step 4: Tela**

`apps/web-admin/src/pages/evento/components/Links.vue`:

```vue
<script setup lang="ts">
import { computed } from "vue";
import QrCode from "../../../componentes/QrCode.vue";
import { actions, state } from "../evento";

const links = computed(() => {
    const e = state.evento;
    if (!e?.links) return [];
    return [
        { chave: "participante", titulo: e.privado === "S" ? "Participante (evento privado: entra pela chave)" : "Participante", url: e.links.participante },
        { chave: "anfitriao", titulo: "Anfitrião (vê o evento inteiro, sem selfie)", url: e.links.anfitriao },
    ];
});
</script>

<template>
    <section v-if="state.evento" class="superficie mt-4 p-4" data-bloco="links">
        <p class="rotulo-secao">Links</p>
        <p v-if="!state.evento.links" class="aviso mt-2 px-3 py-2">Configure ENDERECO_PARTICIPANTE no VPS para ver os links.</p>
        <template v-else>
            <p v-if="state.evento.ativo === 'N'" class="aviso mt-2 px-3 py-2">Evento inativo: o participante não consegue buscar as fotos.</p>
            <div v-for="l in links" :key="l.chave" class="mt-3" :data-link="l.chave">
                <p class="font-bold">{{ l.titulo }}</p>
                <div class="mt-1 flex flex-wrap items-center gap-2">
                    <QrCode :texto="l.url" />
                    <span class="apagado break-all">{{ l.url }}</span>
                    <button type="button" class="botao-secundario" :data-acao="`copiar-${l.chave}`" @click="actions.copiar(l.url)">Copiar</button>
                    <button type="button" class="botao-secundario" :data-acao="`qr-${l.chave}`" @click="actions.abrirQr(l.url)">QR grande</button>
                </div>
            </div>
            <p v-if="state.mensagemLinks" class="apagado mt-2">{{ state.mensagemLinks }}</p>
        </template>

        <div v-if="state.qrGrande" data-qr-grande class="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white p-6" @click="actions.fecharQr()">
            <QrCode :texto="state.qrGrande" :tamanho="320" />
            <p class="apagado mt-4 break-all text-center">{{ state.qrGrande }}</p>
            <button type="button" class="botao mt-4">Fechar</button>
        </div>
    </section>
</template>
```

Em `apps/web-admin/src/pages/evento/index.vue`: importar `import Links from "./components/Links.vue";` e acrescentar `<Links />` logo depois de `<Dados />`.

- [ ] **Step 5: Rodar e ver passar**

Run: `cd apps/web-admin && npx vitest run && npx vue-tsc --noEmit`
Expected: todos passam; `vue-tsc` sem saída.

- [ ] **Step 6: Commit**

```bash
git add apps/web-admin
git commit -m "feat(web-admin): links do participante e do anfitrião com QR

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Página do evento — fotógrafos

**Files:**
- Create: `apps/web-admin/src/pages/evento/components/Fotografos.vue`
- Create: `apps/web-admin/src/pages/evento/fotografos.test.ts`
- Modify: `apps/web-admin/src/pages/evento/evento.ts`, `pages/evento/index.vue`, `pages/evento/interfaces.ts`, `pages/evento/services/evento.service.ts`, `pages/evento/evento.test.ts`

**Interfaces:**
- Consumes (Task 4): `fotografo.listarVinculos`, `listarFotografos`, `criarFotografo`, `vincularFotografo`, `desvincularFotografo`.
- Produces: estado `vinculos`, `fotografos`, `idParaAdicionar`, `novoNome`, `novoTelefone`, `removendo`, `ocupadoFotografos`, `erroFotografos`; ações `carregarFotografos`, `adicionar`, `cadastrarEAdicionar`, `pedirRemocao`, `cancelarRemocao`, `confirmarRemocao`.

- [ ] **Step 1: Escrever os testes**

`apps/web-admin/src/pages/evento/fotografos.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { createMemoryHistory, createRouter } from "vue-router";
import PaginaEvento from "./index.vue";
import {
    criarFotografo,
    desvincularFotografo,
    listarFotografos,
    listarVinculos,
    obterEvento,
    vincularFotografo,
} from "./services/evento.service";
import { ErroDaApi } from "../../ts/erros";
import { entrarComo } from "../../ts/sessao";
import type { Evento, Fotografo, Vinculo } from "./interfaces";

vi.mock("./services/evento.service", () => ({
    obterEvento: vi.fn(),
    editarEvento: vi.fn(),
    subirMarcaDagua: vi.fn(),
    listarVinculos: vi.fn(),
    listarFotografos: vi.fn(),
    criarFotografo: vi.fn(),
    vincularFotografo: vi.fn(),
    desvincularFotografo: vi.fn(),
}));

const evento: Evento = {
    id_evento: 7,
    nome: "Corrida da Serra",
    slug: "corrida-da-serra",
    tipo: "esportivo",
    privado: "N",
    chave_acesso: null,
    chave_anfitriao: "anf123",
    data_inicio: "2026-09-27",
    data_fim: "2026-09-27",
    ativo: "S",
    config: { limiar: 0.42, exigir_whatsapp: false, marca_dagua: false, organizador: "X", dias_expurgo: 90, validade_resultado_dias: null, max_selfies: 3 },
    links: null,
};
const ana: Fotografo = { id_fotografo: 1, nome: "Ana Souza", telefone: "+5511911112222" };
const bruno: Fotografo = { id_fotografo: 2, nome: "Bruno Lima", telefone: null };
const vinculoAna: Vinculo = { id_evento_fotografo: 50, id_fotografo: 1, nome: "Ana Souza", telefone: "+5511911112222" };

async function abrir() {
    const router = createRouter({
        history: createMemoryHistory(),
        routes: [
            { path: "/eventos/:id", component: PaginaEvento },
            { path: "/", component: { template: "<p>lista</p>" } },
            { path: "/entrar", name: "entrar", component: { template: "<p>entrar</p>" } },
        ],
    });
    await router.push("/eventos/7");
    const tela = mount(PaginaEvento, { global: { plugins: [router] } });
    await flushPromises();
    return tela;
}

beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    entrarComo({ token: "tok", nome: "Ana" });
    vi.mocked(obterEvento).mockResolvedValue(evento);
    vi.mocked(listarVinculos).mockResolvedValue([vinculoAna]);
    vi.mocked(listarFotografos).mockResolvedValue([ana, bruno]);
});

describe("página do evento — fotógrafos", () => {
    test("lista os vinculados e avisa onde fica o link de upload", async () => {
        const tela = await abrir();

        expect(listarVinculos).toHaveBeenCalledWith(7);
        expect(tela.get("[data-bloco=fotografos]").text()).toContain("Ana Souza");
        expect(tela.text()).toContain("O link e o QR de upload de cada fotógrafo aparecem no painel da estação.");
    });

    test("a escolha só traz quem ainda não está no evento; adicionar vincula e recarrega", async () => {
        vi.mocked(vincularFotografo).mockResolvedValue(undefined as never);
        const tela = await abrir();

        const opcoes = tela.findAll("select[name=fotografo] option").map((o) => o.text());
        expect(opcoes.some((t) => t.includes("Bruno Lima"))).toBe(true);
        expect(opcoes.some((t) => t.includes("Ana Souza"))).toBe(false);

        await tela.get("select[name=fotografo]").setValue("2");
        await tela.get("[data-acao=adicionar]").trigger("click");
        await flushPromises();

        expect(vincularFotografo).toHaveBeenCalledWith(7, 2);
        expect(listarVinculos).toHaveBeenCalledTimes(2);
    });

    test("cadastrar novo cria o fotógrafo e já vincula; telefone vazio vai como null", async () => {
        vi.mocked(criarFotografo).mockResolvedValue({ id_fotografo: 3, nome: "Bia", telefone: null });
        vi.mocked(vincularFotografo).mockResolvedValue(undefined as never);
        const tela = await abrir();

        await tela.get("input[name=novo_nome]").setValue("Bia");
        await tela.get("[data-acao=cadastrar]").trigger("click");
        await flushPromises();

        expect(criarFotografo).toHaveBeenCalledWith("Bia", null);
        expect(vincularFotografo).toHaveBeenCalledWith(7, 3);
        expect((tela.get("input[name=novo_nome]").element as HTMLInputElement).value).toBe("");
    });

    test("cadastrar sem nome não chama a API", async () => {
        const tela = await abrir();

        await tela.get("[data-acao=cadastrar]").trigger("click");
        await flushPromises();

        expect(criarFotografo).not.toHaveBeenCalled();
        expect(tela.text()).toContain("Informe o nome do fotógrafo.");
    });

    test("remover pede confirmação; cancelar não remove, confirmar remove e recarrega", async () => {
        vi.mocked(desvincularFotografo).mockResolvedValue({ ok: true });
        const tela = await abrir();

        await tela.get("[data-acao=remover-50]").trigger("click");
        expect(tela.text()).toContain("O link de upload dele para de aceitar fotos. As fotos já enviadas continuam.");
        await tela.get("[data-acao=cancelar-remocao]").trigger("click");
        expect(desvincularFotografo).not.toHaveBeenCalled();

        await tela.get("[data-acao=remover-50]").trigger("click");
        await tela.get("[data-acao=confirmar-remocao]").trigger("click");
        await flushPromises();

        expect(desvincularFotografo).toHaveBeenCalledWith(50);
        expect(listarVinculos).toHaveBeenCalledTimes(2);
    });

    test("erro ao adicionar aparece no bloco", async () => {
        vi.mocked(vincularFotografo).mockRejectedValue(new ErroDaApi("Fotógrafo não encontrado.", undefined, 422));
        const tela = await abrir();

        await tela.get("select[name=fotografo]").setValue("2");
        await tela.get("[data-acao=adicionar]").trigger("click");
        await flushPromises();

        expect(tela.get("[data-bloco=fotografos]").text()).toContain("Fotógrafo não encontrado.");
    });
});
```

Em `apps/web-admin/src/pages/evento/evento.test.ts`, acrescentar ao objeto do `vi.mock` (a página passa a carregar os fotógrafos):

```ts
    listarVinculos: vi.fn().mockResolvedValue([]),
    listarFotografos: vi.fn().mockResolvedValue([]),
    criarFotografo: vi.fn(),
    vincularFotografo: vi.fn(),
    desvincularFotografo: vi.fn(),
```

Run: `cd apps/web-admin && npx vitest run src/pages/evento/fotografos.test.ts`
Expected: FAIL — não há bloco de fotógrafos (e os tipos `Fotografo`/`Vinculo` não existem).

- [ ] **Step 2: Interfaces e serviço**

Em `apps/web-admin/src/pages/evento/interfaces.ts`, acrescentar:

```ts
export interface Fotografo {
    id_fotografo: number;
    nome: string;
    telefone: string | null;
}

export interface Vinculo {
    id_evento_fotografo: number;
    id_fotografo: number;
    nome: string;
    telefone: string | null;
}
```

Em `apps/web-admin/src/pages/evento/services/evento.service.ts`, trocar o import de tipos por `import type { DadosEdicao, Evento, Fotografo, Vinculo } from "../interfaces";` e acrescentar:

```ts
export function listarVinculos(idEvento: number): Promise<Vinculo[]> {
    return chamar("fotografo", { call: "listarVinculos", id_evento: idEvento });
}

export function listarFotografos(): Promise<Fotografo[]> {
    return chamar("fotografo", { call: "listarFotografos" });
}

export function criarFotografo(nome: string, telefone: string | null): Promise<Fotografo> {
    return chamar("fotografo", { call: "criarFotografo", nome, telefone });
}

export function vincularFotografo(idEvento: number, idFotografo: number): Promise<unknown> {
    return chamar("fotografo", { call: "vincularFotografo", id_evento: idEvento, id_fotografo: idFotografo });
}

export function desvincularFotografo(idEventoFotografo: number): Promise<{ ok: true }> {
    return chamar("fotografo", { call: "desvincularFotografo", id_evento_fotografo: idEventoFotografo });
}
```

- [ ] **Step 3: Estado e ações**

Em `apps/web-admin/src/pages/evento/evento.ts`:
- imports: `import type { DadosEdicao, Evento, FormDados, Fotografo, Vinculo } from "./interfaces";` e acrescentar ao import do serviço `criarFotografo, desvincularFotografo, listarFotografos, listarVinculos, vincularFotografo`;
- em `estadoInicial()`, acrescentar:

```ts
        vinculos: [] as Vinculo[],
        fotografos: [] as Fotografo[],
        idParaAdicionar: 0,
        novoNome: "",
        novoTelefone: "",
        removendo: null as Vinculo | null,
        ocupadoFotografos: false,
        erroFotografos: "",
```

- em `actions.init`, depois de `state.form = formDoEvento(evento);`: `await actions.carregarFotografos();`
- em `actions`, acrescentar:

```ts
    async carregarFotografos(): Promise<void> {
        if (!state.evento) return;
        try {
            const [vinculos, fotografos] = await Promise.all([listarVinculos(state.evento.id_evento), listarFotografos()]);
            Object.assign(state, { vinculos, fotografos });
        } catch (erro) {
            state.erroFotografos = mensagem(erro, "Não conseguimos carregar os fotógrafos.");
        }
    },

    async adicionar(): Promise<void> {
        const idFotografo = Number(state.idParaAdicionar);
        if (!idFotografo) return;
        await comFotografos(async (idEvento) => {
            await vincularFotografo(idEvento, idFotografo);
            state.idParaAdicionar = 0;
        });
    },

    async cadastrarEAdicionar(): Promise<void> {
        const nome = state.novoNome.trim();
        if (!nome) {
            state.erroFotografos = "Informe o nome do fotógrafo.";
            return;
        }
        await comFotografos(async (idEvento) => {
            const fotografo = await criarFotografo(nome, state.novoTelefone.trim() || null);
            await vincularFotografo(idEvento, fotografo.id_fotografo);
            Object.assign(state, { novoNome: "", novoTelefone: "" });
        });
    },

    pedirRemocao(vinculo: Vinculo): void {
        state.removendo = vinculo;
    },

    cancelarRemocao(): void {
        state.removendo = null;
    },

    async confirmarRemocao(): Promise<void> {
        const vinculo = state.removendo;
        state.removendo = null;
        if (!vinculo) return;
        await comFotografos(async () => {
            await desvincularFotografo(vinculo.id_evento_fotografo);
        });
    },
```

- depois do objeto `actions`, acrescentar:

```ts
// Uma operação por vez no bloco, e a lista recarregada no fim: é ela que diz quem ficou.
async function comFotografos(operacao: (idEvento: number) => Promise<void>): Promise<void> {
    if (!state.evento || state.ocupadoFotografos) return;
    Object.assign(state, { ocupadoFotografos: true, erroFotografos: "" });
    try {
        await operacao(state.evento.id_evento);
        await actions.carregarFotografos();
    } catch (erro) {
        state.erroFotografos = mensagem(erro, "Não conseguimos completar.");
    } finally {
        state.ocupadoFotografos = false;
    }
}
```

- [ ] **Step 4: Tela**

`apps/web-admin/src/pages/evento/components/Fotografos.vue`:

```vue
<script setup lang="ts">
import { computed } from "vue";
import { actions, state } from "../evento";

const disponiveis = computed(() => state.fotografos.filter((f) => !state.vinculos.some((v) => v.id_fotografo === f.id_fotografo)));
</script>

<template>
    <section v-if="state.evento" class="superficie mt-4 p-4" data-bloco="fotografos">
        <p class="rotulo-secao">Fotógrafos</p>
        <p class="aviso mt-2 px-3 py-2">O link e o QR de upload de cada fotógrafo aparecem no painel da estação.</p>

        <p v-if="state.vinculos.length === 0" class="apagado mt-3">Nenhum fotógrafo neste evento ainda.</p>
        <ul v-else class="mt-3">
            <li v-for="v in state.vinculos" :key="v.id_evento_fotografo" class="flex flex-wrap items-center justify-between gap-2 border-t border-[#ececf0] py-2 first:border-t-0">
                <span>{{ v.nome }} <span v-if="v.telefone" class="apagado">· {{ v.telefone }}</span></span>
                <button type="button" class="botao-perigo" :data-acao="`remover-${v.id_evento_fotografo}`" @click="actions.pedirRemocao(v)">Remover do evento</button>
            </li>
        </ul>

        <div class="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
                <p class="font-bold">Adicionar um já cadastrado</p>
                <div class="mt-1 flex gap-2">
                    <select v-model="state.idParaAdicionar" name="fotografo" class="campo">
                        <option :value="0" disabled>Escolha o fotógrafo…</option>
                        <option v-for="f in disponiveis" :key="f.id_fotografo" :value="f.id_fotografo">{{ f.nome }}{{ f.telefone ? ` · ${f.telefone}` : "" }}</option>
                    </select>
                    <button type="button" class="botao" data-acao="adicionar" :disabled="state.ocupadoFotografos || !state.idParaAdicionar" @click="actions.adicionar()">
                        Adicionar
                    </button>
                </div>
            </div>
            <div>
                <p class="font-bold">Cadastrar novo</p>
                <input v-model="state.novoNome" name="novo_nome" placeholder="Nome" class="campo mt-1" />
                <input v-model="state.novoTelefone" name="novo_telefone" placeholder="Telefone (opcional)" class="campo mt-2" />
                <button type="button" class="botao-secundario mt-2" data-acao="cadastrar" :disabled="state.ocupadoFotografos" @click="actions.cadastrarEAdicionar()">
                    Cadastrar e adicionar
                </button>
            </div>
        </div>

        <p v-if="state.erroFotografos" class="mt-3 text-[var(--erro)]">{{ state.erroFotografos }}</p>

        <div v-if="state.removendo" class="modal modal-open">
            <div class="modal-box">
                <p class="font-extrabold">Remover {{ state.removendo.nome }} do evento?</p>
                <p class="mt-2">O link de upload dele para de aceitar fotos. As fotos já enviadas continuam.</p>
                <div class="modal-action">
                    <button type="button" class="botao-secundario" data-acao="cancelar-remocao" @click="actions.cancelarRemocao()">Cancelar</button>
                    <button type="button" class="botao-perigo" data-acao="confirmar-remocao" @click="actions.confirmarRemocao()">Remover</button>
                </div>
            </div>
        </div>
    </section>
</template>
```

O teste de "adicionar" faz `setValue("2")` no `select`: o `v-model` de `select` devolve o valor da `option` (número, pelo `:value`), e `adicionar()` ainda passa por `Number(...)`.

Em `apps/web-admin/src/pages/evento/index.vue`: importar `import Fotografos from "./components/Fotografos.vue";` e acrescentar `<Fotografos />` depois de `<Links />`.

- [ ] **Step 5: Rodar e ver passar**

Run: `cd apps/web-admin && npx vitest run && npx vue-tsc --noEmit && npx vite build`
Expected: todos passam; `vue-tsc` sem saída; build termina.

- [ ] **Step 6: Commit**

```bash
git add apps/web-admin
git commit -m "feat(web-admin): fotógrafos do evento — adicionar, cadastrar e remover

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Servir no VPS, documentação e prova ponta a ponta

**Files:**
- Modify: `infra/nginx/Dockerfile`
- Modify: `infra/nginx/arquivos.conf.template`
- Modify: `docker-compose.dev.yml`
- Modify: `docker-compose.vps.yml`
- Modify: `docs/desenvolvimento.md`

**Interfaces:**
- Consumes: o build de `apps/web-admin` (`npm run build -w apps/web-admin` → `apps/web-admin/dist`).
- Produces: o admin em `http://admin.localhost:8080` (dev) e em `https://${DOMINIO_ADMIN}` (VPS).

- [ ] **Step 1: Build do admin na imagem do nginx**

`infra/nginx/Dockerfile` — o estágio `build` passa a fazer os dois apps:

```dockerfile
# As telas do participante e do admin são estáticas: este mesmo nginx, que já valida os links
# assinados, serve os dois builds. Uma origem por domínio, sem CORS e sem container novo.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web-participante/package.json apps/web-participante/
COPY apps/web-admin/package.json apps/web-admin/
RUN npm ci -w apps/web-participante -w apps/web-admin
COPY apps/web-participante apps/web-participante
COPY apps/web-admin apps/web-admin
RUN npm run build -w apps/web-participante && npm run build -w apps/web-admin
```

e, no fim do arquivo, depois do `COPY` do participante:

```dockerfile
COPY --from=build /app/apps/web-admin/dist /usr/share/nginx/admin
```

- [ ] **Step 2: Segundo `server` no template**

No fim de `infra/nginx/arquivos.conf.template`, depois do `}` que fecha o primeiro `server`:

```nginx
# O admin no domínio dele: só o app, sem /arquivos. O /api desse domínio vai para a API pelo
# Traefik (em dev, pelo include abaixo).
server {
    listen 80;
    server_name ${DOMINIO_ADMIN};

    include /etc/nginx/extra/*.conf;

    location / {
        root /usr/share/nginx/admin;
        add_header Cache-Control "no-cache" always;
        try_files $uri $uri/ /index.html;
    }

    location /assets/ {
        root /usr/share/nginx/admin;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }
}
```

- [ ] **Step 3: Domínio do admin nos composes**

`docker-compose.dev.yml`, no `environment` do serviço `arquivos`, depois de `ARQUIVO_SEGREDO: dev-somente-local`:

```yaml
      # O navegador resolve *.localhost para a própria máquina: o admin abre em
      # http://admin.localhost:8080 sem mexer no /etc/hosts.
      DOMINIO_ADMIN: admin.localhost
```

`docker-compose.vps.yml`, no serviço `arquivos`:
- no `environment`, depois de `ARQUIVO_SEGREDO: ${ARQUIVO_SEGREDO}`: `DOMINIO_ADMIN: ${DOMINIO_ADMIN}`
- nas `labels`, depois de `traefik.http.routers.arquivos.tls=true`:

```yaml
      # O app do admin, no domínio dele. O /api desse domínio continua na API: a regra dela é
      # mais longa, e o Traefik dá prioridade à regra mais longa.
      - traefik.http.routers.admin.rule=Host(`${DOMINIO_ADMIN}`)
      - traefik.http.routers.admin.entrypoints=websecure
      - traefik.http.routers.admin.tls=true
      - traefik.http.routers.admin.service=arquivos
```

- [ ] **Step 4: Subir e conferir o nginx**

Run:
```bash
cd /mnt/nvme/PROJETOS/reconhecimento_facial
docker compose -f docker-compose.dev.yml up -d --build api-vps arquivos
docker compose --env-file .env.vps.example -f docker-compose.vps.yml config -q
curl -s -H "Host: admin.localhost" http://127.0.0.1:8080/ | grep -o "<title>[^<]*"
curl -s http://127.0.0.1:8080/ | grep -o "<title>[^<]*"
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: admin.localhost" -H "Content-Type: application/json" -X POST http://127.0.0.1:8080/api/admin/login -d '{"call":"login","login":"ninguem","senha":"x"}'
```
Expected:
- `config -q` sem saída;
- o primeiro `curl` imprime `<title>Admin · Fotos`;
- o segundo imprime o título da tela do participante (não mudou);
- o terceiro imprime `422` (o `/api` no domínio do admin chega à API).

- [ ] **Step 5: Documentação**

Em `docs/desenvolvimento.md`:

1. Na seção "Upload do fotógrafo e painel da estação", trocar a frase "O evento, o fotógrafo e o vínculo nascem no admin do VPS (`apps/api/src/_ADMIN/evento/evento.http` e `fotografo/fotografo.http`) e chegam à estação pela sincronização, a cada 60 s." por:

```md
O evento, o fotógrafo e o vínculo nascem no admin (ver "Admin" abaixo) e chegam à estação pela sincronização, a cada 60 s.
```

2. Acrescentar a seção nova antes de "## Upload do fotógrafo e painel da estação":

````md
## Admin

Em desenvolvimento, com recarregamento automático:

```bash
docker compose -f docker-compose.dev.yml up -d --build api-vps
npm run dev -w apps/web-admin        # http://localhost:5175
npm run test -w apps/web-admin       # Vitest + Vue Test Utils, sem API no ar
```

O Vite encaminha `/api` para a API do VPS de dev (`127.0.0.1:3002`). Entre com o operador de dev (`ana` / `senha-dev-123` depois do `criar-operador`).

Servido como em produção pelo nginx do VPS: `docker compose -f docker-compose.dev.yml up -d --build arquivos` e abra `http://admin.localhost:8080` (o navegador resolve `*.localhost` para a própria máquina).

- **Novo evento:** as datas já vêm com hoje. "Exigir WhatsApp" vem desligado: a verificação ainda não existe, e ligada o participante não vê as fotos.
- **Página do evento:** dados e config, marca d'água, links do participante e do anfitrião (com QR) e os fotógrafos. Os links saem de `ENDERECO_PARTICIPANTE` (em dev, `http://localhost:8080`; na VPS, `https://${DOMINIO_PARTICIPANTE}`, montado pelo compose).
- **Link de upload:** o admin só vincula o fotógrafo; o link e o QR ficam no painel da estação (`http://localhost:5174/#/estacao`), que é quem sabe o próprio endereço na rede do evento.
- **Remover um fotógrafo** fecha o link dele em até 60 s. Adicionar de novo gera um link novo.
- **Desativar o evento** também chega à estação em até 60 s (a sincronização leva os desativados nos últimos 7 dias).
````

- [ ] **Step 6: Prova ponta a ponta contra o compose de dev**

Com `postgres`, `redis`, `api-vps`, `api-estacao`, `worker-estacao`, `worker-vps`, `vision-gpu` e `arquivos` no ar (`docker compose -f docker-compose.dev.yml --profile gpu up -d --build`) e o admin em `npm run dev -w apps/web-admin`, rodar tudo **no mesmo shell** (as variáveis passam de um passo para o outro):

1. Entrar, criar um evento de hoje e vincular um fotógrafo novo, pelo proxy do Vite (o mesmo caminho da tela):

```bash
V=http://localhost:5175/api/admin
campo() { node -pe "JSON.parse(require('fs').readFileSync(0)).$1"; }
TOK=$(curl -s -X POST $V/login -H 'Content-Type: application/json' -d '{"call":"login","login":"ana","senha":"senha-dev-123"}' | campo token)
HOJE=$(TZ=America/Sao_Paulo date +%F)
EV=$(curl -s -X POST $V/evento -H "Authorization: $TOK" -H 'Content-Type: application/json' \
  -d "{\"call\":\"criarEvento\",\"nome\":\"Prova do admin\",\"slug\":\"prova-admin-$(date +%s)\",\"tipo\":\"esportivo\",\"data_inicio\":\"$HOJE\",\"data_fim\":\"$HOJE\",\"config\":{\"exigir_whatsapp\":false}}" | campo id_evento)
curl -s -X POST $V/evento -H "Authorization: $TOK" -H 'Content-Type: application/json' -d "{\"call\":\"obterEvento\",\"id_evento\":$EV}" | campo links
F=$(curl -s -X POST $V/fotografo -H "Authorization: $TOK" -H 'Content-Type: application/json' -d '{"call":"criarFotografo","nome":"Fotógrafo da prova"}' | campo id_fotografo)
VINC=$(curl -s -X POST $V/fotografo -H "Authorization: $TOK" -H 'Content-Type: application/json' -d "{\"call\":\"vincularFotografo\",\"id_evento\":$EV,\"id_fotografo\":$F}")
IDV=$(echo "$VINC" | campo id_evento_fotografo)
TUP=$(echo "$VINC" | campo token_upload)
echo "evento $EV · vínculo $IDV · ativo $(echo "$VINC" | campo ativo)"
```

Expected: `links` com `participante: 'http://localhost:8080/#/e/prova-admin-…'` e `anfitriao: 'http://localhost:8080/#/a/…'`; a última linha termina em `ativo S`.

2. Em até 60 s, o evento e o link chegam à estação:

```bash
sleep 65
docker exec fotos-dev-postgres-1 psql -U fotos -d fotos_estacao -tAc "SELECT ativo FROM evento WHERE id_evento = $EV"
curl -s -X POST localhost:3001/api/fotografo/upload -H 'Content-Type: application/json' -d "{\"call\":\"getSessao\",\"token\":\"$TUP\"}"
```

Expected: `S`; e a sessão de upload com `"evento":{"nome":"Prova do admin"}`.

3. Remover o fotógrafo pelo admin; em até 60 s o link dele é recusado pela estação:

```bash
curl -s -X POST $V/fotografo -H "Authorization: $TOK" -H 'Content-Type: application/json' -d "{\"call\":\"desvincularFotografo\",\"id_evento_fotografo\":$IDV}"
sleep 65
curl -s -X POST localhost:3001/api/fotografo/upload -H 'Content-Type: application/json' -d "{\"call\":\"getSessao\",\"token\":\"$TUP\"}"
```

Expected: `{"ok":true}`; depois `{"msg":"Este link não aceita mais fotos. Fale com o operador da estação.","codigo":"link_invalido"}`.

4. Desativar o evento pelo admin; em até 60 s a estação grava `ativo = 'N'`:

```bash
curl -s -X POST $V/evento -H "Authorization: $TOK" -H 'Content-Type: application/json' -d "{\"call\":\"editarEvento\",\"id_evento\":$EV,\"ativo\":false}" | campo ativo
sleep 65
docker exec fotos-dev-postgres-1 psql -U fotos -d fotos_estacao -tAc "SELECT ativo FROM evento WHERE id_evento = $EV"
```

Expected: `N` e `N`.

5. Pedir ao usuário para abrir `http://localhost:5175` no navegador e repetir o fluxo pelas telas: entrar, criar evento, ver os links e o QR, adicionar e remover fotógrafo, salvar dados. Registrar no resumo o que ele confirmou.

- [ ] **Step 7: Suíte inteira**

Run:
```bash
cd /mnt/nvme/PROJETOS/reconhecimento_facial
docker compose -f docker-compose.dev.yml stop worker-estacao
npm run typecheck && npm test && npm run test:integracao
docker compose -f docker-compose.dev.yml start worker-estacao
```
Expected: tudo verde, com uma exceção conhecida: se o `worker-estacao` for religado antes do fim, `ingerir.test.ts` falha porque o worker consome os jobs (não é deste trabalho).

- [ ] **Step 8: Commit**

```bash
git add infra/nginx docker-compose.dev.yml docker-compose.vps.yml docs/desenvolvimento.md
git commit -m "feat(web-admin): servir no nginx do VPS e documentação

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Cobertura da spec

| Spec | Onde |
|---|---|
| §2 Identidade visual | Task 7 (estilo copiado do web-fotografo, `.campo`) |
| §3.1 Entrar, sessão de 12 h, sessão expirada | Task 7 (entrada, `sessao.ts`, `api.ts`, `App.vue`); 12 h é o `gerarToken` que já existe |
| §3.2 Eventos | Task 7 |
| §3.3 Novo evento (endereço automático, acesso pelo tipo, WhatsApp desligado, datas de hoje, erros sem perder o preenchido) | Task 8 |
| §3.4 Dados, marca d'água, Avançado com faixas | Task 9 (tela), Tasks 1 e 2 (faixas na API) |
| §3.4 Links, QR, inativo, sem endereço | Task 10 (tela), Task 3 (API) |
| §3.4 Fotógrafos (lista, adicionar, cadastrar, remover com confirmação, aviso do painel) | Task 11 (tela), Task 4 (API) |
| §4 Limite do login | Task 6 |
| §4 `criarEvento`/`editarEvento` com validação e endereço repetido | Tasks 1 e 2 |
| §4 `obterEvento` com links, `ENDERECO_PARTICIPANTE` | Task 3 |
| §4 `listarVinculos`, `desvincularFotografo`, reativar com token novo | Task 4 |
| §4 Evento desativado também sincroniza | Task 5 |
| §4 Tamanhos (nome 150, endereço 80) | Tasks 1 e 2 |
| §5 Arquitetura da tela | Tasks 7 a 11 |
| §6 Como sobe (dev 5175, `admin.localhost:8080`, VPS com Traefik) | Tasks 7 e 12; `ENDERECO_PARTICIPANTE` nos composes na Task 3 |
| §7 Testes | em cada tarefa; ponta a ponta na Task 12 |
