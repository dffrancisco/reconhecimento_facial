# Melhorias do web-participante — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Home do evento num link só, galeria pública com abas de dia, selfie lembrada no aparelho e botão único Salvar/Compartilhar, com a repaginação "foto em primeiro lugar".

**Architecture:** Uma rota nova na API (`/api/participante/galeria`, padrão `call`) espelha a galeria do anfitrião mas identifica o evento por `slug`/`chave_acesso` e agrega os dias por `capturada_em`. No front, o link do evento passa a abrir uma home (`pages/home/`), a câmera desce para `/…/selfie`, a galeria nova vive em `/…/fotos` (`pages/galeria/`), e módulos compartilhados em `src/ts/` cuidam da busca, da memória no IndexedDB e do compartilhar.

**Tech Stack:** Express 5 + TypeScript + Postgres (placeholders `?`), Vue 3 `<script setup>` + vue-router (hash) + Tailwind 4 + daisyUI, idb-keyval, @fontsource-variable/bricolage-grotesque, vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-melhorias-participante-design.md`

## Global Constraints

- Tudo em português: nomes, comentários, mensagens e commits (as mensagens de erro são voltadas ao participante).
- API no padrão do projeto: Router só despacha e valida presença (`{ msg, error: true }`), regra de negócio na ctrl com `ErroTratado`, SQL só query; métodos recebem só `req` e **retornam** o valor (o `per` responde).
- SQL com placeholder `?`; nunca misturar com `$N` na mesma query.
- Paginação da galeria: `FOTOS_POR_PAGINA = 60`, offset, sem `count(*)` por página.
- Fuso dos dias fixo: `America/Sao_Paulo` (constante `FUSO_EVENTO` no `sql.galeria.ts` do participante).
- Front no padrão `pages/<tela>/{index.vue, <tela>.ts, interfaces.ts}` com `state` reactive + `actions`; sem store global.
- URLs de foto chegam assinadas da API; o front nunca altera o caminho (só anexa `&dl=1`).
- daisyUI com tema `light` fixo; `prefers-color-scheme` não muda nada.
- Bricolage Grotesque Variable só em display (classes `.display` e `.titulo-tela`); corpo continua `system-ui`.
- Commits: conventional commits em português, terminando com `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Rodar testes: `npm run test -w apps/api -- <filtro>` e `npm run test -w apps/web-participante -- <filtro>`.

## Review Focus

Entradas que a spec implica e que precisam de teste no dono do código:

1. **Foto tirada 23h30 (hora do Brasil)** deve cair no dia local, não no dia seguinte em UTC — o SQL usa `AT TIME ZONE 'America/Sao_Paulo'` (Task 1, conferência manual via `.http`) e o rótulo do chip nunca passa por `new Date("AAAA-MM-DD")` (teste de `rotuloDoDia`, Task 3).
2. **`dia` forjado no body** (`"2026-9-2"`, `"x' OR 1=1"`, número) deve virar erro de negócio, nunca 500 nem filtro furado — teste de `diaValido` na Task 1.
3. **IndexedDB indisponível** (aba anônima, armazenamento bloqueado): toda função da memória devolve `null`/silêncio e o app segue como se não houvesse memória — teste na Task 2.
4. **Evento de um dia só**: sem chips na tela e `getGaleria` chamado **sem** `dia` — teste na Task 5.
5. **iPhone recusando o share por falta de toque** com o botão único: "Toque de novo" reaproveita o arquivo já baixado, sem novo download — teste de `compartilharFoto` na Task 3 e do fluxo do resultado na Task 7.

## Estrutura de arquivos

| Arquivo | Papel |
|---|---|
| `apps/api/src/_PARTICIPANTE/galeria/{route,ctrl,sql,regras}.galeria*.ts` + `galeria.http` | Rota pública `getEvento`/`getGaleria` |
| `apps/web-participante/src/ts/busca.ts` | `buscarPorSelfie` compartilhado (sai de `pages/evento/services/`) |
| `apps/web-participante/src/ts/aparelho.ts` | `chave_aparelho` (UUID em localStorage) |
| `apps/web-participante/src/ts/memoria.ts` | token + selfie no IndexedDB (idb-keyval) |
| `apps/web-participante/src/ts/dias.ts` | `rotuloDoDia`, `periodoParaTela` |
| `apps/web-participante/src/ts/compartilhar.ts` | `podeCompartilharArquivos`, `compartilharFoto` |
| `apps/web-participante/src/ts/galeriaPublica.ts` | serviço `getEvento`/`getGaleria` (home e galeria usam) |
| `apps/web-participante/src/pages/home/` | Home do evento |
| `apps/web-participante/src/pages/galeria/` | Galeria "todas as fotos" com chips |
| `apps/web-participante/src/{router.ts, estilo.css, main.ts}` | Rotas novas, `.tela-foto`/`.display`/`.chip`, fonte |
| `apps/web-participante/src/pages/{evento,resultado}/` | Memória, rebusca sem câmera, botão único |
| `apps/web-participante/src/componentes/FotoAberta.vue` | Botão único Salvar/Compartilhar |

---

### Task 1: API — rota pública `participante/galeria`

**Files:**
- Create: `apps/api/src/_PARTICIPANTE/galeria/regras.ts`
- Create: `apps/api/src/_PARTICIPANTE/galeria/regras.test.ts`
- Create: `apps/api/src/_PARTICIPANTE/galeria/sql.galeria.ts`
- Create: `apps/api/src/_PARTICIPANTE/galeria/ctrl.galeria.ts`
- Create: `apps/api/src/_PARTICIPANTE/galeria/route.galeria.ts`
- Create: `apps/api/src/_PARTICIPANTE/galeria/galeria.http`
- Modify: `apps/api/src/routes/participanteRoute.ts`

**Interfaces:**
- Consumes: `ConexaoPostgres`, `ErroTratado` (`services/erro`), `urlDaFoto` (`services/linkArquivo`), `iContexto`/`iRota` (`services/per`).
- Produces (contrato com o front, Tasks 4-5):
  - `{ call: "getEvento", slug | chave_acesso }` → `{ nome: string, data_inicio: string | null, data_fim: string, total_fotos: number, dias: { dia: "AAAA-MM-DD", qtd: number }[] }`
  - `{ call: "getGaleria", slug | chave_acesso, offset: number, dia?: "AAAA-MM-DD" }` → `{ fotos: { id_foto: number, thumb: string, web: string }[] }`

Nota de teste: a API não tem harness de teste com banco (as rotas existentes também não têm); a cobertura automatizada fica nas regras puras (`regras.test.ts`) e o comportamento da rota se confere pelo `galeria.http` contra o compose de dev, como nas demais rotas.

- [ ] **Step 1: Teste que falha — `diaValido`**

`apps/api/src/_PARTICIPANTE/galeria/regras.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { diaValido } from "./regras";

describe("diaValido", () => {
    test("aceita o formato AAAA-MM-DD", () => {
        expect(diaValido("2026-09-26")).toBe(true);
    });

    // O dia entra numa comparação com to_char: qualquer outra forma é recusada antes do SQL.
    test.each(["26/09/2026", "2026-9-26", "2026-09-26T00:00", "x' OR '1'='1", 20260926, null, undefined, ["2026-09-26"]])(
        "recusa %j",
        (dia) => {
            expect(diaValido(dia)).toBe(false);
        }
    );
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -w apps/api -- regras.test`
Expected: FAIL — `Cannot find module './regras'` (ou equivalente).

- [ ] **Step 3: Implementar `regras.ts`**

```ts
// O dia chega do corpo da requisição e entra na comparação com o to_char do SQL:
// só passa o formato exato que o próprio getEvento devolve.
const FORMATO_DIA = /^\d{4}-\d{2}-\d{2}$/;

export function diaValido(dia: unknown): dia is string {
    return typeof dia === "string" && FORMATO_DIA.test(dia);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -w apps/api -- regras.test`
Expected: PASS.

- [ ] **Step 5: Escrever `sql.galeria.ts`**

```ts
import ConexaoPostgres from "../../db/conexaoPostgres";

export const FOTOS_POR_PAGINA = 60;
// Evento é sempre no Brasil nesta etapa: o dia do chip é o dia local do evento,
// não o dia UTC do servidor (spec §3).
export const FUSO_EVENTO = "America/Sao_Paulo";

export interface LinhaEventoPublico {
    id_evento: number;
    nome: string;
    data_inicio: string | null;
    data_fim: string;
    ativo: "S" | "N";
}

// Evento privado nunca abre pelo slug, como na busca (spec do app §3.1).
// to_char nas datas: o driver devolveria Date, que vira ISO com fuso no JSON e
// quebraria o split("-") do front.
export async function eventoPublico(
    conexao: ConexaoPostgres,
    entrada: { slug?: string; chaveAcesso?: string }
): Promise<LinhaEventoPublico | undefined> {
    const colunas = `id_evento, nome, to_char(data_inicio, 'YYYY-MM-DD') AS data_inicio,
                     to_char(data_fim, 'YYYY-MM-DD') AS data_fim, ativo`;
    if (entrada.chaveAcesso)
        return conexao.queryOneParam<LinhaEventoPublico>(
            `SELECT ${colunas} FROM evento WHERE chave_acesso = ? AND deletado = 'N'`,
            [entrada.chaveAcesso]
        );
    if (entrada.slug)
        return conexao.queryOneParam<LinhaEventoPublico>(
            `SELECT ${colunas} FROM evento WHERE slug = ? AND privado = 'N' AND deletado = 'N'`,
            [entrada.slug]
        );
    return undefined;
}

// Foto sem EXIF ganha a hora do processamento em capturada_em (processarFoto), mas a
// coluna é anulável: o COALESCE com publicada_em garante que nenhuma foto fique fora
// de todos os dias.
export async function diasDoEvento(conexao: ConexaoPostgres, idEvento: number): Promise<{ dia: string; qtd: number }[]> {
    return conexao.queryParam(
        `SELECT to_char(COALESCE(capturada_em, publicada_em) AT TIME ZONE '${FUSO_EVENTO}', 'YYYY-MM-DD') AS dia,
                count(*)::int AS qtd
           FROM foto
          WHERE id_evento = ? AND situacao = 'visivel'
          GROUP BY 1
          ORDER BY 1`,
        [idEvento]
    );
}

export async function fotosDoEvento(
    conexao: ConexaoPostgres,
    idEvento: number,
    offset: number,
    dia: string | null
): Promise<{ id_foto: number; hash_arquivo: string }[]> {
    if (dia !== null)
        return conexao.queryParam(
            `SELECT id_foto, hash_arquivo FROM foto
              WHERE id_evento = ? AND situacao = 'visivel'
                AND to_char(COALESCE(capturada_em, publicada_em) AT TIME ZONE '${FUSO_EVENTO}', 'YYYY-MM-DD') = ?
              ORDER BY capturada_em ASC NULLS LAST, id_foto ASC LIMIT ? OFFSET ?`,
            [idEvento, dia, FOTOS_POR_PAGINA, offset]
        );
    return conexao.queryParam(
        `SELECT id_foto, hash_arquivo FROM foto
          WHERE id_evento = ? AND situacao = 'visivel'
          ORDER BY capturada_em ASC NULLS LAST, id_foto ASC LIMIT ? OFFSET ?`,
        [idEvento, FOTOS_POR_PAGINA, offset]
    );
}
```

- [ ] **Step 6: Escrever `ctrl.galeria.ts`**

```ts
import ConexaoPostgres from "../../db/conexaoPostgres";
import { ErroTratado } from "../../services/erro";
import { urlDaFoto } from "../../services/linkArquivo";
import { diasDoEvento, eventoPublico, fotosDoEvento, LinhaEventoPublico } from "./sql.galeria";

export default class GaleriaCtrl {
    constructor(private conexao: ConexaoPostgres) {}

    async getEvento(entrada: { slug?: string; chaveAcesso?: string }) {
        const evento = await this.exigirEvento(entrada);
        const dias = await diasDoEvento(this.conexao, evento.id_evento);
        return {
            nome: evento.nome,
            data_inicio: evento.data_inicio,
            data_fim: evento.data_fim,
            total_fotos: dias.reduce((soma, d) => soma + d.qtd, 0),
            dias,
        };
    }

    async getGaleria(entrada: { slug?: string; chaveAcesso?: string }, offset: number, dia: string | null) {
        const evento = await this.exigirEvento(entrada);
        const fotos = await fotosDoEvento(this.conexao, evento.id_evento, offset, dia);
        return {
            fotos: fotos.map((foto) => ({
                id_foto: foto.id_foto,
                thumb: urlDaFoto(evento.id_evento, foto.hash_arquivo, "thumb"),
                web: urlDaFoto(evento.id_evento, foto.hash_arquivo, "web"),
            })),
        };
    }

    // Inexistente, inativo, expurgado (deletado) e privado pelo slug: a mesma resposta,
    // para a galeria pública não contar mais do que a busca contaria (spec §3).
    private async exigirEvento(entrada: { slug?: string; chaveAcesso?: string }): Promise<LinhaEventoPublico> {
        const evento = await eventoPublico(this.conexao, entrada);
        if (!evento || evento.ativo !== "S") throw new ErroTratado("Evento não encontrado. Confira o link.");
        return evento;
    }
}
```

- [ ] **Step 7: Escrever `route.galeria.ts`**

```ts
import { Request } from "express";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { iContexto, iRota } from "../../services/per";
import GaleriaCtrl from "./ctrl.galeria";
import { diaValido } from "./regras";

export default class Galeria implements iRota {
    conexao = new ConexaoPostgres();
    private ctrl!: GaleriaCtrl;

    // A galeria é pública: o evento vem pelo slug ou pela chave de acesso do link.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(private contexto: iContexto) {}

    async init(): Promise<void> {
        await this.conexao.open();
        this.ctrl = new GaleriaCtrl(this.conexao);
    }

    async getEvento(req: Request) {
        const { slug, chave_acesso } = req.body;
        if (!slug && !chave_acesso) return { msg: "Informe o evento (slug ou chave_acesso)", error: true };
        return this.ctrl.getEvento({ slug, chaveAcesso: chave_acesso });
    }

    async getGaleria(req: Request) {
        const { slug, chave_acesso, dia } = req.body;
        if (!slug && !chave_acesso) return { msg: "Informe o evento (slug ou chave_acesso)", error: true };
        if (dia !== undefined && dia !== null && !diaValido(dia)) return { msg: "Dia inválido", error: true };
        const offset = Number.isInteger(Number(req.body.offset)) ? Math.max(0, Number(req.body.offset)) : 0;
        return this.ctrl.getGaleria({ slug, chaveAcesso: chave_acesso }, offset, diaValido(dia) ? dia : null);
    }
}
```

- [ ] **Step 8: Registrar a rota**

Em `apps/api/src/routes/participanteRoute.ts`, o arquivo inteiro fica:

```ts
import { Router } from "express";
import per from "../services/per";
import Busca from "../_PARTICIPANTE/busca/route.busca";
import Galeria from "../_PARTICIPANTE/galeria/route.galeria";
import Resultado from "../_PARTICIPANTE/resultado/route.resultado";

const router = Router();

router.post("/busca", (req, res, next) => per(req, res, next, Busca));
router.post("/galeria", (req, res, next) => per(req, res, next, Galeria));
router.post("/resultado", (req, res, next) => per(req, res, next, Resultado));

export default router;
```

- [ ] **Step 9: Criar `galeria.http`** (mesmo formato do `_ANFITRIAO/galeria/galeria.http`; copie o cabeçalho de host/variáveis de lá)

```
### Evento público — dados e dias
POST {{host}}/api/participante/galeria
Content-Type: application/json

{ "call": "getEvento", "slug": "corrida-demo" }

### Galeria — primeira página, sem filtro
POST {{host}}/api/participante/galeria
Content-Type: application/json

{ "call": "getGaleria", "slug": "corrida-demo", "offset": 0 }

### Galeria — filtrando por dia
POST {{host}}/api/participante/galeria
Content-Type: application/json

{ "call": "getGaleria", "slug": "corrida-demo", "offset": 0, "dia": "2026-09-26" }

### Evento privado pela chave
POST {{host}}/api/participante/galeria
Content-Type: application/json

{ "call": "getEvento", "chave_acesso": "CHAVE-DO-EVENTO" }

### Privado pelo slug: deve responder 422 "Evento não encontrado. Confira o link."
POST {{host}}/api/participante/galeria
Content-Type: application/json

{ "call": "getEvento", "slug": "slug-do-evento-privado" }

### Dia inválido: deve responder erro de negócio "Dia inválido"
POST {{host}}/api/participante/galeria
Content-Type: application/json

{ "call": "getGaleria", "slug": "corrida-demo", "offset": 0, "dia": "26/09/2026" }
```

- [ ] **Step 10: Verificar tudo**

Run: `npm run test -w apps/api` e `npm run typecheck -w apps/api` (se o script não existir, `npx tsc --noEmit -p apps/api`).
Expected: PASS / sem erros de tipo.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/_PARTICIPANTE/galeria apps/api/src/routes/participanteRoute.ts
git commit -m "feat(api): galeria pública do evento por slug/chave com dias

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Front — busca compartilhada, chave do aparelho e memória no IndexedDB

**Files:**
- Create: `apps/web-participante/src/ts/busca.ts`
- Create: `apps/web-participante/src/ts/aparelho.ts`
- Create: `apps/web-participante/src/ts/memoria.ts`
- Create: `apps/web-participante/src/ts/memoria.test.ts`
- Delete: `apps/web-participante/src/pages/evento/services/evento.service.ts`
- Modify: `apps/web-participante/src/pages/evento/interfaces.ts` (remove `EntradaBusca`/`RespostaBusca`; se ficar vazio, delete o arquivo)
- Modify: `apps/web-participante/src/pages/evento/evento.ts` (imports)
- Modify: `apps/web-participante/src/pages/evento/evento.test.ts` (mock aponta para `ts/busca`)
- Modify: `apps/web-participante/package.json` (dependência)

**Interfaces:**
- Consumes: `chamarMultipart` (`ts/api.ts`), `idb-keyval`.
- Produces:
  - `ts/busca.ts`: `VERSAO_TERMO = "v1"`, `interface EntradaBusca { slug?: string; chaveAcesso?: string; versaoTermo: string; selfies: File[]; tokenOrigem?: string }`, `interface RespostaBusca { token: string; status: "aguardando" | "liberada"; qtd_fotos: number; previas: string[]; codigo?: string }`, `buscarPorSelfie(entrada: EntradaBusca): Promise<RespostaBusca>` (anexa `chave_aparelho` sozinho).
  - `ts/aparelho.ts`: `chaveDoAparelho(): string | null`.
  - `ts/memoria.ts`: `interface MemoriaDoEvento { token: string; qtd_fotos: number; validade_ate: string | null; selfie: Blob | null; criado_em: string }`, `guardarMemoria(caminho: string, memoria: MemoriaDoEvento): Promise<void>`, `memoriaDoEvento(caminho: string): Promise<MemoriaDoEvento | null>`, `atualizarMemoria(caminho: string, parcial: Partial<MemoriaDoEvento>): Promise<void>`, `limparMemoria(caminho: string): Promise<void>`. O `caminho` é a entrada do evento (`/e/<slug>` ou `/p/<chave>`), a mesma convenção de `ts/entrada.ts`.

- [ ] **Step 1: Instalar o idb-keyval** (mesma versão do web-fotografo)

Run: `npm install -w apps/web-participante idb-keyval@^6.2.1`

- [ ] **Step 2: Teste que falha — memória**

`apps/web-participante/src/ts/memoria.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";
import { get } from "idb-keyval";
import { atualizarMemoria, guardarMemoria, limparMemoria, memoriaDoEvento, MemoriaDoEvento } from "./memoria";

const banco = vi.hoisted(() => new Map<string, unknown>());
vi.mock("idb-keyval", () => ({
    get: vi.fn(async (chave: string) => banco.get(chave)),
    set: vi.fn(async (chave: string, valor: unknown) => void banco.set(chave, valor)),
    del: vi.fn(async (chave: string) => void banco.delete(chave)),
}));

const memoria: MemoriaDoEvento = {
    token: "tok123",
    qtd_fotos: 7,
    validade_ate: null,
    selfie: new Blob(["selfie"], { type: "image/jpeg" }),
    criado_em: "2026-09-29T10:00:00.000Z",
};

describe("memória do aparelho", () => {
    beforeEach(() => {
        banco.clear();
        vi.mocked(get).mockClear();
    });

    test("guarda e lê pela entrada do evento", async () => {
        await guardarMemoria("/e/corrida-demo", memoria);
        const lida = await memoriaDoEvento("/e/corrida-demo");
        expect(lida?.token).toBe("tok123");
        expect(lida?.qtd_fotos).toBe(7);
    });

    test("memória vencida some e é apagada", async () => {
        await guardarMemoria("/e/corrida-demo", { ...memoria, validade_ate: "2020-01-01T00:00:00.000Z" });
        expect(await memoriaDoEvento("/e/corrida-demo")).toBeNull();
        expect(banco.has("memoria:/e/corrida-demo")).toBe(false);
    });

    test("atualizar mescla sem apagar a selfie", async () => {
        await guardarMemoria("/e/corrida-demo", memoria);
        await atualizarMemoria("/e/corrida-demo", { validade_ate: "2099-01-01T00:00:00.000Z", qtd_fotos: 9 });
        const lida = await memoriaDoEvento("/e/corrida-demo");
        expect(lida?.qtd_fotos).toBe(9);
        expect(lida?.selfie).not.toBeNull();
    });

    test("atualizar sem memória existente não cria uma pela metade", async () => {
        await atualizarMemoria("/e/corrida-demo", { validade_ate: "2099-01-01T00:00:00.000Z" });
        expect(banco.has("memoria:/e/corrida-demo")).toBe(false);
    });

    test("limpar apaga", async () => {
        await guardarMemoria("/e/corrida-demo", memoria);
        await limparMemoria("/e/corrida-demo");
        expect(await memoriaDoEvento("/e/corrida-demo")).toBeNull();
    });

    // Aba anônima do Safari: o IndexedDB lança. O app segue como se não houvesse memória.
    test("armazenamento indisponível devolve null sem lançar", async () => {
        vi.mocked(get).mockRejectedValueOnce(new DOMException("bloqueado"));
        await expect(memoriaDoEvento("/e/corrida-demo")).resolves.toBeNull();
    });
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm run test -w apps/web-participante -- memoria`
Expected: FAIL — módulo `./memoria` não existe.

- [ ] **Step 4: Implementar `ts/memoria.ts`**

```ts
import { del, get, set } from "idb-keyval";

export interface MemoriaDoEvento {
    token: string;
    qtd_fotos: number;
    validade_ate: string | null;
    selfie: Blob | null;
    criado_em: string;
}

// A memória vive por entrada do evento ("/e/<slug>" ou "/p/<chave>"), a mesma convenção
// da entrada.ts: evento privado não vaza para o slug. A selfie fica só neste aparelho —
// no servidor ela é apagada logo depois da busca (spec §4).
const chaveDe = (caminho: string) => `memoria:${caminho}`;

export async function guardarMemoria(caminho: string, memoria: MemoriaDoEvento): Promise<void> {
    try {
        await set(chaveDe(caminho), memoria);
    } catch {
        // Aba anônima ou armazenamento cheio: a pessoa só perde o atalho.
    }
}

export async function memoriaDoEvento(caminho: string): Promise<MemoriaDoEvento | null> {
    try {
        const memoria = await get<MemoriaDoEvento>(chaveDe(caminho));
        if (!memoria) return null;
        // A validade local é atalho; quem manda é o servidor (o resultado limpa se ele recusar).
        if (memoria.validade_ate && new Date(memoria.validade_ate).getTime() < Date.now()) {
            await del(chaveDe(caminho));
            return null;
        }
        return memoria;
    } catch {
        return null;
    }
}

export async function atualizarMemoria(caminho: string, parcial: Partial<MemoriaDoEvento>): Promise<void> {
    try {
        const memoria = await get<MemoriaDoEvento>(chaveDe(caminho));
        if (memoria) await set(chaveDe(caminho), { ...memoria, ...parcial });
    } catch {
        // Sem armazenamento, sem atalho.
    }
}

export async function limparMemoria(caminho: string): Promise<void> {
    try {
        await del(chaveDe(caminho));
    } catch {
        // Sem armazenamento, não há o que limpar.
    }
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm run test -w apps/web-participante -- memoria`
Expected: PASS.

- [ ] **Step 6: Implementar `ts/aparelho.ts`**

```ts
// Um UUID por navegador, criado uma vez: a API já aceita chave_aparelho e vai ligá-la ao
// participante quando a verificação por WhatsApp existir. Sem armazenamento, a busca segue sem ele.
export function chaveDoAparelho(): string | null {
    try {
        let chave = localStorage.getItem("chave_aparelho");
        if (!chave) {
            chave = crypto.randomUUID();
            localStorage.setItem("chave_aparelho", chave);
        }
        return chave;
    } catch {
        return null;
    }
}
```

- [ ] **Step 7: Criar `ts/busca.ts`** (conteúdo movido de `pages/evento/services/evento.service.ts` + `interfaces.ts`, com `chave_aparelho` e `VERSAO_TERMO`)

```ts
import { chamarMultipart } from "./api";
import { chaveDoAparelho } from "./aparelho";

export const VERSAO_TERMO = "v1";

export interface EntradaBusca {
    slug?: string;
    chaveAcesso?: string;
    versaoTermo: string;
    selfies: File[];
    // Token da busca anterior no "buscar de novo": é ele que dispensa refazer a verificação
    // quando ela existir (spec da plataforma §8).
    tokenOrigem?: string;
}

export interface RespostaBusca {
    token: string;
    status: "aguardando" | "liberada";
    qtd_fotos: number;
    previas: string[];
    codigo?: string;
}

export async function buscarPorSelfie(entrada: EntradaBusca): Promise<RespostaBusca> {
    const forma = new FormData();
    forma.append("call", "buscar");
    if (entrada.chaveAcesso) forma.append("chave_acesso", entrada.chaveAcesso);
    else if (entrada.slug) forma.append("slug", entrada.slug);
    forma.append("versao_termo", entrada.versaoTermo);
    // O visto de marketing só existe na tela de verificação, que é da parte 2: até lá,
    // ninguém entra em lista de marketing (spec do app, §5).
    forma.append("aceita_marketing", "N");
    if (entrada.tokenOrigem) forma.append("token_origem", entrada.tokenOrigem);
    const chave = chaveDoAparelho();
    if (chave) forma.append("chave_aparelho", chave);
    for (const selfie of entrada.selfies) forma.append("selfies", selfie, selfie.name);

    return chamarMultipart<RespostaBusca>("participante", "busca", forma);
}
```

- [ ] **Step 8: Apontar a tela do evento para o módulo novo**

- Em `evento.ts`: trocar `import { buscarPorSelfie } from "./services/evento.service";` por `import { buscarPorSelfie, VERSAO_TERMO } from "../../ts/busca";` e **remover** a linha `export const VERSAO_TERMO = "v1";` (quem usava importa de `ts/busca`).
- Em `pages/evento/interfaces.ts`: remover `EntradaBusca` e `RespostaBusca`; se nada sobrar, apagar o arquivo.
- Apagar `pages/evento/services/evento.service.ts` (e a pasta `services/` se ficar vazia).
- Em `evento.test.ts`: trocar `vi.mock("./services/evento.service", …)` por `vi.mock("../../ts/busca", () => ({ buscarPorSelfie: vi.fn(), VERSAO_TERMO: "v1" }))` e ajustar o import correspondente.

- [ ] **Step 9: Verificar tudo**

Run: `npm run test -w apps/web-participante` e `npm run typecheck -w apps/web-participante`
Expected: PASS / sem erros. (Os testes do evento continuam passando com o mock novo.)

- [ ] **Step 10: Commit**

```bash
git add apps/web-participante package-lock.json
git commit -m "feat(web-participante): memória do aparelho, chave_aparelho e busca compartilhada

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Front — dias, compartilhar e serviço da galeria pública

**Files:**
- Create: `apps/web-participante/src/ts/dias.ts`
- Create: `apps/web-participante/src/ts/dias.test.ts`
- Create: `apps/web-participante/src/ts/compartilhar.ts`
- Create: `apps/web-participante/src/ts/compartilhar.test.ts`
- Create: `apps/web-participante/src/ts/galeriaPublica.ts`

**Interfaces:**
- Consumes: `chamar` (`ts/api.ts`); contrato da Task 1.
- Produces:
  - `ts/dias.ts`: `rotuloDoDia(dia: string): string` ("2026-09-26" → "Sáb 26/09"), `periodoParaTela(inicio: string | null, fim: string): string`.
  - `ts/compartilhar.ts`: `podeCompartilharArquivos(): boolean`, `type ResultadoCompartilhar = { situacao: "ok" | "cancelado" } | { situacao: "toqueDeNovo"; arquivo: File }`, `compartilharFoto(entrada: { url: string; nomeArquivo: string; titulo: string; arquivoPronto?: File }): Promise<ResultadoCompartilhar>` (lança em falha de rede; o chamador decide o fallback).
  - `ts/galeriaPublica.ts`: `interface DiaDoEvento { dia: string; qtd: number }`, `interface EventoPublico { nome: string; data_inicio: string | null; data_fim: string; total_fotos: number; dias: DiaDoEvento[] }`, `interface FotoPublica { id_foto: number; thumb: string; web: string }`, `interface EntradaEvento { slug?: string; chaveAcesso?: string }`, `getEvento(entrada: EntradaEvento): Promise<EventoPublico>`, `getGaleria(entrada: EntradaEvento, offset: number, dia?: string): Promise<{ fotos: FotoPublica[] }>`.

- [ ] **Step 1: Teste que falha — dias**

`apps/web-participante/src/ts/dias.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { periodoParaTela, rotuloDoDia } from "./dias";

describe("rotuloDoDia", () => {
    // 2026-09-26 é um sábado. Montado por partes: new Date("2026-09-26") seria meia-noite
    // UTC e viraria sexta à noite no Brasil.
    test("dia vira rótulo com dia da semana", () => {
        expect(rotuloDoDia("2026-09-26")).toBe("Sáb 26/09");
        expect(rotuloDoDia("2026-09-27")).toBe("Dom 27/09");
    });

    test("valor fora do formato volta como veio", () => {
        expect(rotuloDoDia("sem-data")).toBe("sem-data");
    });
});

describe("periodoParaTela", () => {
    test("dois dias no mesmo mês", () => {
        expect(periodoParaTela("2026-09-26", "2026-09-27")).toBe("26 e 27/09/2026");
    });

    test("um dia só (ou sem data_inicio)", () => {
        expect(periodoParaTela(null, "2026-09-27")).toBe("27/09/2026");
        expect(periodoParaTela("2026-09-27", "2026-09-27")).toBe("27/09/2026");
    });

    test("meses diferentes viram intervalo", () => {
        expect(periodoParaTela("2026-09-30", "2026-10-01")).toBe("30/09/2026 a 01/10/2026");
    });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -w apps/web-participante -- dias`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `ts/dias.ts`**

```ts
const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

// "2026-09-26" → "Sáb 26/09". Montado por partes: new Date("AAAA-MM-DD") seria meia-noite
// UTC, que no Brasil ainda é o dia anterior.
export function rotuloDoDia(dia: string): string {
    const [ano, mes, diaNum] = dia.split("-").map(Number);
    if (!ano || !mes || !diaNum) return dia;
    const data = new Date(ano, mes - 1, diaNum);
    return `${DIAS_SEMANA[data.getDay()]} ${String(diaNum).padStart(2, "0")}/${String(mes).padStart(2, "0")}`;
}

// As datas chegam da API como "AAAA-MM-DD" (to_char no SQL, justamente para este split).
export function periodoParaTela(inicio: string | null, fim: string): string {
    const paraTela = (data: string) => data.split("-").reverse().join("/");
    if (!inicio || inicio === fim) return paraTela(fim);
    const [anoI, mesI, diaI] = inicio.split("-");
    const [anoF, mesF, diaF] = fim.split("-");
    if (anoI === anoF && mesI === mesF) return `${diaI} e ${diaF}/${mesF}/${anoF}`;
    return `${paraTela(inicio)} a ${paraTela(fim)}`;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -w apps/web-participante -- dias`
Expected: PASS.

- [ ] **Step 5: Teste que falha — compartilhar**

`apps/web-participante/src/ts/compartilhar.test.ts`:

```ts
import { afterEach, describe, expect, test, vi } from "vitest";
import { compartilharFoto, podeCompartilharArquivos } from "./compartilhar";

afterEach(() => vi.unstubAllGlobals());

describe("podeCompartilharArquivos", () => {
    test("só quando o navegador aceita arquivo, não só link", () => {
        // O navigator.share do computador existe, mas recusa anexo: o clique daria erro.
        vi.stubGlobal("navigator", { share: vi.fn(), canShare: () => false });
        expect(podeCompartilharArquivos()).toBe(false);

        vi.stubGlobal("navigator", { share: vi.fn(), canShare: () => true });
        expect(podeCompartilharArquivos()).toBe(true);

        vi.stubGlobal("navigator", {});
        expect(podeCompartilharArquivos()).toBe(false);
    });
});

describe("compartilharFoto", () => {
    const url = "/arquivos/7/a_web.jpg?md5=x&expires=1&dl=1";

    test("baixa a foto e abre o menu do sistema", async () => {
        const share = vi.fn().mockResolvedValue(undefined);
        vi.stubGlobal("navigator", { share, canShare: () => true });
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["foto"]) }));

        const resultado = await compartilharFoto({ url, nomeArquivo: "foto-1.jpg", titulo: "Corrida da Serra" });

        expect(resultado.situacao).toBe("ok");
        expect(share).toHaveBeenCalledWith(expect.objectContaining({ title: "Corrida da Serra" }));
    });

    // No iPhone o menu só abre colado no toque, e o download pode passar desse tempo:
    // o arquivo volta pronto para o segundo toque abrir o menu na hora, sem baixar de novo.
    test("recusa por falta de toque devolve o arquivo para o segundo toque", async () => {
        const share = vi.fn().mockRejectedValue(new DOMException("gesto", "NotAllowedError"));
        vi.stubGlobal("navigator", { share, canShare: () => true });
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["foto"]) });
        vi.stubGlobal("fetch", fetchMock);

        const primeira = await compartilharFoto({ url, nomeArquivo: "foto-1.jpg", titulo: "Corrida" });
        expect(primeira.situacao).toBe("toqueDeNovo");
        if (primeira.situacao !== "toqueDeNovo") return;

        share.mockResolvedValueOnce(undefined);
        const segunda = await compartilharFoto({ url, nomeArquivo: "foto-1.jpg", titulo: "Corrida", arquivoPronto: primeira.arquivo });
        expect(segunda.situacao).toBe("ok");
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test("cancelar não é erro", async () => {
        vi.stubGlobal("navigator", { share: vi.fn().mockRejectedValue(new DOMException("cancelou", "AbortError")), canShare: () => true });
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["foto"]) }));

        const resultado = await compartilharFoto({ url, nomeArquivo: "foto-1.jpg", titulo: "Corrida" });
        expect(resultado.situacao).toBe("cancelado");
    });

    test("foto que não baixa lança para o chamador decidir o fallback", async () => {
        vi.stubGlobal("navigator", { share: vi.fn(), canShare: () => true });
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 410 }));

        await expect(compartilharFoto({ url, nomeArquivo: "foto-1.jpg", titulo: "Corrida" })).rejects.toThrow("410");
    });
});
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `npm run test -w apps/web-participante -- compartilhar`
Expected: FAIL — módulo não existe.

- [ ] **Step 7: Implementar `ts/compartilhar.ts`**

```ts
// O navigator.share do computador existe mas recusa anexo; a pergunta é se ele aceita
// um arquivo, não só se a função existe.
export function podeCompartilharArquivos(): boolean {
    const nav = globalThis.navigator as Navigator | undefined;
    if (typeof nav?.share !== "function" || typeof nav.canShare !== "function") return false;
    return nav.canShare({ files: [new File([], "foto.jpg", { type: "image/jpeg" })] });
}

export type ResultadoCompartilhar = { situacao: "ok" | "cancelado" } | { situacao: "toqueDeNovo"; arquivo: File };

// Baixa a foto para anexar (compartilhar só o link mandaria uma URL que vence em uma hora)
// e abre o menu do sistema — no iOS ele tem "Salvar imagem", que é o salvar de verdade.
export async function compartilharFoto(entrada: {
    url: string;
    nomeArquivo: string;
    titulo: string;
    arquivoPronto?: File;
}): Promise<ResultadoCompartilhar> {
    let arquivo = entrada.arquivoPronto ?? null;
    if (!arquivo) {
        const resposta = await fetch(entrada.url);
        if (!resposta.ok) throw new Error(`A foto respondeu ${resposta.status}.`);
        arquivo = new File([await resposta.blob()], entrada.nomeArquivo, { type: "image/jpeg" });
    }

    try {
        await navigator.share({ files: [arquivo], title: entrada.titulo });
        return { situacao: "ok" };
    } catch (erro) {
        if (erro instanceof DOMException && erro.name === "AbortError") return { situacao: "cancelado" };
        // No iPhone o menu só abre colado no toque: com a foto já em mãos, o segundo toque
        // abre na hora — baixar para Arquivos no lugar não põe a foto na galeria.
        if (!entrada.arquivoPronto && erro instanceof DOMException && erro.name === "NotAllowedError")
            return { situacao: "toqueDeNovo", arquivo };
        throw erro;
    }
}
```

- [ ] **Step 8: Rodar e ver passar**

Run: `npm run test -w apps/web-participante -- compartilhar`
Expected: PASS.

- [ ] **Step 9: Implementar `ts/galeriaPublica.ts`** (serviço fino; os testes das telas o mockam)

```ts
import { chamar } from "./api";

export interface DiaDoEvento {
    dia: string;
    qtd: number;
}

export interface EventoPublico {
    nome: string;
    data_inicio: string | null;
    data_fim: string;
    total_fotos: number;
    dias: DiaDoEvento[];
}

// A galeria pública já traz a versão web assinada, como a do anfitrião: aqui não há
// token de busca para o gerarLinks.
export interface FotoPublica {
    id_foto: number;
    thumb: string;
    web: string;
}

export interface EntradaEvento {
    slug?: string;
    chaveAcesso?: string;
}

function corpo(entrada: EntradaEvento): Record<string, string | undefined> {
    return entrada.chaveAcesso ? { chave_acesso: entrada.chaveAcesso } : { slug: entrada.slug };
}

export function getEvento(entrada: EntradaEvento): Promise<EventoPublico> {
    return chamar("participante", "galeria", { call: "getEvento", ...corpo(entrada) });
}

export function getGaleria(entrada: EntradaEvento, offset: number, dia?: string): Promise<{ fotos: FotoPublica[] }> {
    return chamar("participante", "galeria", { call: "getGaleria", ...corpo(entrada), offset, ...(dia ? { dia } : {}) });
}
```

- [ ] **Step 10: Verificar e commitar**

Run: `npm run test -w apps/web-participante` e `npm run typecheck -w apps/web-participante`
Expected: PASS.

```bash
git add apps/web-participante/src/ts
git commit -m "feat(web-participante): rótulos de dia, compartilhar com arquivo e serviço da galeria pública

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Front — rotas novas, base visual e home do evento

**Files:**
- Modify: `apps/web-participante/src/router.ts`
- Modify: `apps/web-participante/src/estilo.css`
- Modify: `apps/web-participante/src/main.ts`
- Modify: `apps/web-participante/package.json` (fonte)
- Create: `apps/web-participante/src/pages/home/home.ts`
- Create: `apps/web-participante/src/pages/home/home.test.ts`
- Create: `apps/web-participante/src/pages/home/index.vue`

**Interfaces:**
- Consumes: `getEvento`/`EventoPublico` (`ts/galeriaPublica.ts`), `memoriaDoEvento` (`ts/memoria.ts`), `periodoParaTela` (`ts/dias.ts`), `BotaoPilula`, `FaixaPatrocinadores`.
- Produces: rotas nomeadas — `evento` (`/e/:slug`, home), `selfie` (`/e/:slug/selfie`), `galeria` (`/e/:slug/fotos`), `eventoPrivado` (`/p/:chave`), `selfiePrivado` (`/p/:chave/selfie`), `galeriaPrivada` (`/p/:chave/fotos`) — e as classes CSS `.tela-foto`, `.display`, `.titulo-tela`, `.chip`, `.chip-ativo` que as Tasks 5 e 7 usam.

- [ ] **Step 1: Instalar a fonte**

Run: `npm install -w apps/web-participante @fontsource-variable/bricolage-grotesque`

- [ ] **Step 2: Rotas** — em `router.ts`, o bloco `routes` fica:

```ts
routes: [
    { path: "/e/:slug", name: "evento", component: () => import("./pages/home/index.vue") },
    { path: "/e/:slug/selfie", name: "selfie", component: () => import("./pages/evento/index.vue") },
    { path: "/e/:slug/fotos", name: "galeria", component: () => import("./pages/galeria/index.vue") },
    { path: "/p/:chave", name: "eventoPrivado", component: () => import("./pages/home/index.vue") },
    { path: "/p/:chave/selfie", name: "selfiePrivado", component: () => import("./pages/evento/index.vue") },
    { path: "/p/:chave/fotos", name: "galeriaPrivada", component: () => import("./pages/galeria/index.vue") },
    { path: "/r/:token", name: "resultado", component: () => import("./pages/resultado/index.vue") },
    { path: "/a/:chave", name: "anfitriao", component: () => import("./pages/anfitriao/index.vue") },
    { path: "/privacidade", name: "privacidade", component: () => import("./pages/privacidade/index.vue") },
    { path: "/:qualquer(.*)*", redirect: "/privacidade" },
],
```

Atualize o comentário do topo ("são sete e fixas" → "são dez e fixas"). A rota `galeria` aponta para uma página que a Task 5 cria — o `import()` é lazy, então o build só falha se a Task 5 não vier; crie já na Task 5, e nesta task deixe as duas linhas de `fotos` **comentadas** com `// Task 5:` se for commitar antes dela. (Ordem recomendada: Tasks 4 e 5 na sequência, descomentando aqui no fim da 5.)

- [ ] **Step 3: Fonte e classes novas**

Em `main.ts`, antes do `import "./estilo.css";`:

```ts
// Só o display usa a Bricolage; o corpo continua system-ui, que carrega instantâneo.
import "@fontsource-variable/bricolage-grotesque";
```

Em `estilo.css`, dentro do `@layer components`, acrescentar:

```css
    /* Telas onde a foto manda (galeria, resultado, foto aberta): fundo sólido escuro,
       o gradiente largada fica como marca na home e na câmera (spec das melhorias §6). */
    .tela-foto {
        background: var(--largada-foto);
        border-top: env(safe-area-inset-top) solid transparent;
        border-bottom: env(safe-area-inset-bottom) solid transparent;
        color: #fff;
        min-height: 100dvh;
        font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    }

    /* Nome do evento na home: o "número de peito" da identidade. */
    .display {
        font-family: "Bricolage Grotesque Variable", system-ui, -apple-system, "Segoe UI", sans-serif;
        font-size: clamp(2rem, 9vw, 2.9rem);
        font-weight: 800;
        line-height: 1.02;
        letter-spacing: -0.03em;
        overflow-wrap: anywhere;
    }

    /* Títulos de tela ("N fotos suas", "Todas as fotos"): a mesma família, no tamanho do .titulo. */
    .titulo-tela {
        font-family: "Bricolage Grotesque Variable", system-ui, -apple-system, "Segoe UI", sans-serif;
    }

    .chip {
        border-radius: 999px;
        padding: 0.55rem 0.95rem;
        font-size: 0.75rem;
        font-weight: 700;
        background: rgb(255 255 255 / 0.14);
        color: #fff;
    }

    .chip-ativo {
        background: #fff;
        color: var(--largada-fim);
    }
```

E, fora do `@layer` (no fim do arquivo):

```css
/* Os pontinhos do "Procurando você" são a única animação contínua do app. */
@media (prefers-reduced-motion: reduce) {
    .animate-pulse {
        animation: none;
    }
}
```

- [ ] **Step 4: Teste que falha — home**

`apps/web-participante/src/pages/home/home.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";
import { actions, state } from "./home";
import { getEvento } from "../../ts/galeriaPublica";
import { memoriaDoEvento } from "../../ts/memoria";
import { ErroDaApi } from "../../ts/api";

vi.mock("../../ts/galeriaPublica", () => ({ getEvento: vi.fn(), getGaleria: vi.fn() }));
vi.mock("../../ts/memoria", () => ({ memoriaDoEvento: vi.fn() }));
const roteador = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("../../router", () => ({ router: roteador }));

const evento = {
    nome: "Correndo com Elas",
    data_inicio: "2026-09-26",
    data_fim: "2026-09-27",
    total_fotos: 2221,
    dias: [
        { dia: "2026-09-26", qtd: 1234 },
        { dia: "2026-09-27", qtd: 987 },
    ],
};

describe("home do evento", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(memoriaDoEvento).mockResolvedValue(null);
    });

    test("carrega o evento pelo slug e monta o caminho", async () => {
        vi.mocked(getEvento).mockResolvedValue(evento);

        await actions.init("correndo-com-elas", "");

        expect(state.evento?.nome).toBe("Correndo com Elas");
        expect(state.caminho).toBe("/e/correndo-com-elas");
        expect(state.carregando).toBe(false);
    });

    test("evento privado usa a chave e o caminho /p/", async () => {
        vi.mocked(getEvento).mockResolvedValue(evento);

        await actions.init("", "CHAVE123");

        expect(vi.mocked(getEvento)).toHaveBeenCalledWith({ slug: undefined, chaveAcesso: "CHAVE123" });
        expect(state.caminho).toBe("/p/CHAVE123");
    });

    test("com memória válida oferece 'Minhas fotos (N)'", async () => {
        vi.mocked(getEvento).mockResolvedValue(evento);
        vi.mocked(memoriaDoEvento).mockResolvedValue({
            token: "tok123",
            qtd_fotos: 7,
            validade_ate: null,
            selfie: null,
            criado_em: "2026-09-29T10:00:00.000Z",
        });

        await actions.init("correndo-com-elas", "");

        expect(state.tokenLembrado).toBe("tok123");
        expect(state.qtdLembrada).toBe(7);

        actions.irParaMinhasFotos();
        expect(roteador.push).toHaveBeenCalledWith({ name: "resultado", params: { token: "tok123" } });
    });

    test("evento não encontrado mostra a mensagem da API", async () => {
        vi.mocked(getEvento).mockRejectedValue(new ErroDaApi("Evento não encontrado. Confira o link."));

        await actions.init("nao-existe", "");

        expect(state.mensagem).toContain("não encontrado");
        expect(state.evento).toBeNull();
    });
});
```

- [ ] **Step 5: Rodar e ver falhar**

Run: `npm run test -w apps/web-participante -- home`
Expected: FAIL — módulo `./home` não existe.

- [ ] **Step 6: Implementar `pages/home/home.ts`**

```ts
import { reactive } from "vue";
import { router } from "../../router";
import type { EventoPublico } from "../../ts/galeriaPublica";
import { getEvento } from "../../ts/galeriaPublica";
import { memoriaDoEvento } from "../../ts/memoria";

export const state = reactive({
    carregando: true,
    caminho: "",
    evento: null as EventoPublico | null,
    mensagem: "",
    tokenLembrado: "",
    qtdLembrada: 0,
});

export const actions = {
    async init(slug: string, chave: string): Promise<void> {
        state.caminho = chave ? `/p/${chave}` : `/e/${slug}`;
        state.carregando = true;
        state.mensagem = "";
        state.evento = null;
        state.tokenLembrado = "";
        state.qtdLembrada = 0;
        try {
            const [evento, memoria] = await Promise.all([
                getEvento({ slug: slug || undefined, chaveAcesso: chave || undefined }),
                memoriaDoEvento(state.caminho),
            ]);
            state.evento = evento;
            if (memoria) {
                state.tokenLembrado = memoria.token;
                state.qtdLembrada = memoria.qtd_fotos;
            }
        } catch (erro) {
            state.mensagem = erro instanceof Error ? erro.message : "Não conseguimos abrir o evento.";
        } finally {
            state.carregando = false;
        }
    },

    irParaSelfie(): void {
        router.push(`${state.caminho}/selfie`);
    },

    irParaGaleria(): void {
        router.push(`${state.caminho}/fotos`);
    },

    irParaMinhasFotos(): void {
        if (state.tokenLembrado) router.push({ name: "resultado", params: { token: state.tokenLembrado } });
    },
};
```

- [ ] **Step 7: Rodar e ver passar**

Run: `npm run test -w apps/web-participante -- home`
Expected: PASS.

- [ ] **Step 8: Implementar `pages/home/index.vue`**

```vue
<script setup lang="ts">
import { computed, nextTick } from "vue";
import { useRoute } from "vue-router";
import BotaoPilula from "../../componentes/BotaoPilula.vue";
import FaixaPatrocinadores from "../../componentes/FaixaPatrocinadores.vue";
import { periodoParaTela } from "../../ts/dias";
import { actions, state } from "./home";

const rota = useRoute();
nextTick(() => actions.init(String(rota.params.slug ?? ""), String(rota.params.chave ?? "")));

const periodo = computed(() => (state.evento ? periodoParaTela(state.evento.data_inicio, state.evento.data_fim) : ""));
</script>

<template>
    <main class="tela-largada flex flex-col px-6 py-8">
        <p v-if="state.carregando" class="titulo">Abrindo o evento…</p>

        <section v-else-if="state.mensagem" class="flex flex-1 flex-col justify-center">
            <h1 class="titulo">{{ state.mensagem }}</h1>
            <router-link to="/privacidade" class="mt-4 text-xs underline">Dúvidas sobre seus dados</router-link>
        </section>

        <template v-else-if="state.evento">
            <!-- O nome grande é o elemento memorável: um número de peito, não um cartaz. -->
            <section class="flex flex-1 flex-col justify-center">
                <p class="rotulo">Suas fotos do evento</p>
                <h1 class="display mt-2">{{ state.evento.nome }}</h1>
                <p class="mt-3 text-sm text-white/85">
                    {{ periodo }}<template v-if="state.evento.total_fotos > 0"> · {{ state.evento.total_fotos }} fotos</template>
                </p>
            </section>

            <section class="flex flex-col gap-2 pb-2">
                <BotaoPilula v-if="state.tokenLembrado" @click="actions.irParaMinhasFotos()">
                    Minhas fotos ({{ state.qtdLembrada }})
                </BotaoPilula>
                <BotaoPilula v-if="!state.tokenLembrado" @click="actions.irParaSelfie()">Buscar minhas fotos</BotaoPilula>
                <BotaoPilula v-else variante="secundaria" @click="actions.irParaSelfie()">Buscar com outra selfie</BotaoPilula>
                <BotaoPilula variante="secundaria" @click="actions.irParaGaleria()">Ver todas as fotos</BotaoPilula>
            </section>

            <FaixaPatrocinadores :patrocinadores="[]" />
        </template>
    </main>
</template>
```

(Confira em `BotaoPilula.vue` o nome exato da prop de variante — o anfitrião usa `variante="secundaria"`.)

- [ ] **Step 9: Verificar e commitar**

Run: `npm run test -w apps/web-participante` e `npm run typecheck -w apps/web-participante`
Expected: PASS (com as rotas `fotos` comentadas até a Task 5, se necessário).

```bash
git add apps/web-participante package-lock.json
git commit -m "feat(web-participante): home do evento num link só, com fonte de display

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Front — galeria "todas as fotos" com chips de dia

**Files:**
- Create: `apps/web-participante/src/pages/galeria/galeria.ts`
- Create: `apps/web-participante/src/pages/galeria/galeria.test.ts`
- Create: `apps/web-participante/src/pages/galeria/index.vue`
- Modify: `apps/web-participante/src/router.ts` (descomentar/incluir as rotas `fotos`, se ficaram para cá)

**Interfaces:**
- Consumes: `getEvento`, `getGaleria`, `FotoPublica`, `DiaDoEvento` (`ts/galeriaPublica.ts`), `rotuloDoDia` (`ts/dias.ts`), `podeCompartilharArquivos`/`compartilharFoto` (`ts/compartilhar.ts`), `baixarArquivo` (`ts/arquivos.ts`), `GradeFotos`, `FotoAberta`, `BotaoPilula`.
- Produces: página da rota `galeria`/`galeriaPrivada`. Nenhuma outra task consome seus símbolos.

- [ ] **Step 1: Teste que falha**

`apps/web-participante/src/pages/galeria/galeria.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";
import { actions, state } from "./galeria";
import { getEvento, getGaleria } from "../../ts/galeriaPublica";

vi.mock("../../ts/galeriaPublica", () => ({ getEvento: vi.fn(), getGaleria: vi.fn() }));
vi.mock("../../ts/arquivos", () => ({ baixarArquivo: vi.fn() }));
vi.mock("../../ts/compartilhar", () => ({ podeCompartilharArquivos: () => false, compartilharFoto: vi.fn() }));

const eventoDoisDias = {
    nome: "Correndo com Elas",
    data_inicio: "2026-09-26",
    data_fim: "2026-09-27",
    total_fotos: 3,
    dias: [
        { dia: "2026-09-26", qtd: 2 },
        { dia: "2026-09-27", qtd: 1 },
    ],
};

const fotos = (ids: number[]) =>
    ids.map((id) => ({ id_foto: id, thumb: `/arquivos/7/${id}_thumb.jpg?md5=x`, web: `/arquivos/7/${id}_web.jpg?md5=x` }));

describe("galeria pública", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getGaleria).mockResolvedValue({ fotos: fotos([1, 2]) });
    });

    test("dois dias: primeiro dia ativo e filtro na chamada", async () => {
        vi.mocked(getEvento).mockResolvedValue(eventoDoisDias);

        await actions.init("correndo-com-elas", "");

        expect(state.dias).toHaveLength(2);
        expect(state.diaAtivo).toBe("2026-09-26");
        expect(vi.mocked(getGaleria)).toHaveBeenCalledWith({ slug: "correndo-com-elas", chaveAcesso: undefined }, 0, "2026-09-26");
    });

    test("um dia só: sem chips e sem filtro", async () => {
        vi.mocked(getEvento).mockResolvedValue({ ...eventoDoisDias, dias: [{ dia: "2026-09-27", qtd: 3 }] });

        await actions.init("correndo-com-elas", "");

        expect(state.diaAtivo).toBeNull();
        expect(vi.mocked(getGaleria)).toHaveBeenCalledWith({ slug: "correndo-com-elas", chaveAcesso: undefined }, 0, undefined);
    });

    test("trocar de dia zera a grade e recomeça do offset 0", async () => {
        vi.mocked(getEvento).mockResolvedValue(eventoDoisDias);
        await actions.init("correndo-com-elas", "");
        vi.mocked(getGaleria).mockClear();
        vi.mocked(getGaleria).mockResolvedValue({ fotos: fotos([9]) });

        await actions.trocarDia("2026-09-27");

        expect(state.fotos.map((f) => f.id_foto)).toEqual([9]);
        expect(vi.mocked(getGaleria)).toHaveBeenCalledWith(expect.anything(), 0, "2026-09-27");
    });

    test("'Ver mais' mantém o dia e soma o offset", async () => {
        vi.mocked(getEvento).mockResolvedValue(eventoDoisDias);
        await actions.init("correndo-com-elas", "");
        vi.mocked(getGaleria).mockClear();
        vi.mocked(getGaleria).mockResolvedValue({ fotos: fotos([3]) });

        await actions.carregarMais();

        expect(vi.mocked(getGaleria)).toHaveBeenCalledWith(expect.anything(), 2, "2026-09-26");
        expect(state.acabou).toBe(true); // 1 < 60: última página
    });

    test("evento sem foto nenhuma mostra o recado de 'ainda chegando'", async () => {
        vi.mocked(getEvento).mockResolvedValue({ ...eventoDoisDias, total_fotos: 0, dias: [] });
        vi.mocked(getGaleria).mockResolvedValue({ fotos: [] });

        await actions.init("correndo-com-elas", "");

        expect(state.fotos).toHaveLength(0);
        expect(state.acabou).toBe(true);
        expect(state.mensagem).toBe("");
    });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -w apps/web-participante -- galeria`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `pages/galeria/galeria.ts`**

```ts
import { reactive } from "vue";
import type { FotoNaGrade } from "../../componentes/interfaces";
import { baixarArquivo } from "../../ts/arquivos";
import { compartilharFoto, podeCompartilharArquivos } from "../../ts/compartilhar";
import type { DiaDoEvento, EntradaEvento, FotoPublica } from "../../ts/galeriaPublica";
import { getEvento, getGaleria } from "../../ts/galeriaPublica";

// A API devolve 60 por página: uma página menor que isso é a última.
const POR_PAGINA = 60;

export const state = reactive({
    entrada: {} as EntradaEvento,
    carregando: true,
    nomeEvento: "",
    dias: [] as DiaDoEvento[],
    diaAtivo: null as string | null,
    fotos: [] as FotoPublica[],
    offset: 0,
    acabou: false,
    mensagem: "",
    aberta: null as number | null,
    compartilharPronto: null as number | null,
});

// Arquivo do "toque de novo" do iPhone fora do state: File dentro do reactive vira Proxy,
// e o navigator.share não aceita Proxy.
let prontaParaEnvio: { indice: number; arquivo: File; url: string } | null = null;

export const actions = {
    async init(slug: string, chave: string): Promise<void> {
        state.entrada = { slug: slug || undefined, chaveAcesso: chave || undefined };
        state.carregando = true;
        state.nomeEvento = "";
        state.dias = [];
        state.diaAtivo = null;
        state.fotos = [];
        state.offset = 0;
        state.acabou = false;
        state.mensagem = "";
        state.aberta = null;
        state.compartilharPronto = null;
        prontaParaEnvio = null;
        try {
            const evento = await getEvento(state.entrada);
            state.nomeEvento = evento.nome;
            state.dias = evento.dias;
            // Um dia sempre ativo quando há escolha; com um dia só não há chip nem filtro.
            state.diaAtivo = evento.dias.length > 1 ? evento.dias[0].dia : null;
            await actions.carregarMais();
        } catch (erro) {
            state.mensagem = erro instanceof Error ? erro.message : "Não conseguimos abrir a galeria.";
            state.acabou = true;
            state.carregando = false;
        }
    },

    async trocarDia(dia: string): Promise<void> {
        if (dia === state.diaAtivo) return;
        state.diaAtivo = dia;
        state.fotos = [];
        state.offset = 0;
        state.acabou = false;
        state.aberta = null;
        await actions.carregarMais();
    },

    async carregarMais(): Promise<void> {
        state.carregando = true;
        state.mensagem = "";
        try {
            const pagina = await getGaleria(state.entrada, state.offset, state.diaAtivo ?? undefined);
            state.fotos = [...state.fotos, ...pagina.fotos];
            state.offset += pagina.fotos.length;
            state.acabou = pagina.fotos.length < POR_PAGINA;
        } catch (erro) {
            state.mensagem = erro instanceof Error ? erro.message : "Não conseguimos abrir a galeria.";
            state.acabou = true;
        } finally {
            state.carregando = false;
        }
    },

    abrir(indice: number): void {
        state.aberta = indice;
    },

    fechar(): void {
        state.aberta = null;
    },

    proxima(): void {
        if (state.aberta !== null) state.aberta = Math.min(state.aberta + 1, state.fotos.length - 1);
    },

    anterior(): void {
        if (state.aberta !== null) state.aberta = Math.max(state.aberta - 1, 0);
    },

    // A foto aberta mostra a versão web (2048 px), não o thumb da grade.
    fotoAberta(): FotoNaGrade | null {
        const foto = state.aberta === null ? undefined : state.fotos[state.aberta];
        return foto ? { id_foto: foto.id_foto, thumb: foto.web } : null;
    },

    podeCompartilhar(): boolean {
        return podeCompartilharArquivos();
    },

    prontaParaCompartilhar(): boolean {
        return state.compartilharPronto !== null && state.compartilharPronto === state.aberta;
    },

    // `dl=1` faz o nginx responder como anexo; fica fora da assinatura, que cobre só o caminho.
    salvar(): void {
        const foto = state.aberta === null ? undefined : state.fotos[state.aberta];
        if (foto) baixarArquivo(`${foto.web}&dl=1`);
    },

    async compartilhar(): Promise<void> {
        const indice = state.aberta;
        const foto = indice === null ? undefined : state.fotos[indice];
        if (indice === null || !foto || !podeCompartilharArquivos()) return;

        const pronta = prontaParaEnvio?.indice === indice ? prontaParaEnvio : null;
        prontaParaEnvio = null;
        state.compartilharPronto = null;

        try {
            const resultado = await compartilharFoto({
                url: foto.web,
                nomeArquivo: `foto-${foto.id_foto}.jpg`,
                titulo: state.nomeEvento,
                arquivoPronto: pronta?.arquivo,
            });
            if (resultado.situacao === "toqueDeNovo") {
                prontaParaEnvio = { indice, arquivo: resultado.arquivo, url: foto.web };
                state.compartilharPronto = indice;
            }
        } catch {
            // Qualquer outra recusa: a pessoa fica com a foto baixada em vez de um botão mudo.
            baixarArquivo(`${foto.web}&dl=1`);
        }
    },
};
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -w apps/web-participante -- galeria`
Expected: PASS.

- [ ] **Step 5: Implementar `pages/galeria/index.vue`**

```vue
<script setup lang="ts">
import { nextTick } from "vue";
import { useRoute } from "vue-router";
import BotaoPilula from "../../componentes/BotaoPilula.vue";
import FotoAberta from "../../componentes/FotoAberta.vue";
import GradeFotos from "../../componentes/GradeFotos.vue";
import { rotuloDoDia } from "../../ts/dias";
import { actions, state } from "./galeria";

const rota = useRoute();
nextTick(() => actions.init(String(rota.params.slug ?? ""), String(rota.params.chave ?? "")));
</script>

<template>
    <main class="tela-foto px-5 py-7">
        <p class="rotulo">Todas as fotos</p>
        <h1 class="titulo titulo-tela mt-1">{{ state.nomeEvento || "Abrindo…" }}</h1>

        <div v-if="state.dias.length > 1" class="mt-3 flex flex-wrap gap-2">
            <button
                v-for="d in state.dias"
                :key="d.dia"
                type="button"
                class="chip"
                :class="{ 'chip-ativo': d.dia === state.diaAtivo }"
                @click="actions.trocarDia(d.dia)"
            >
                {{ rotuloDoDia(d.dia) }} · {{ d.qtd }}
            </button>
        </div>

        <p v-if="state.mensagem && state.fotos.length === 0" class="titulo mt-8">{{ state.mensagem }}</p>

        <p v-else-if="!state.carregando && state.fotos.length === 0" class="mt-8 text-sm text-white/85">
            As fotos do evento ainda estão chegando. Volte mais tarde.
        </p>

        <template v-else>
            <GradeFotos class="mt-4" :fotos="state.fotos" @abrir="actions.abrir" />

            <p v-if="state.mensagem" class="mt-3 text-center text-xs text-white/85">{{ state.mensagem }}</p>

            <BotaoPilula v-if="!state.acabou" class="mt-4" variante="secundaria" :desabilitado="state.carregando" @click="actions.carregarMais()">
                {{ state.carregando ? "Carregando…" : "Ver mais fotos" }}
            </BotaoPilula>
        </template>

        <FotoAberta
            v-if="actions.fotoAberta()"
            :foto="actions.fotoAberta()!"
            :pode-compartilhar="actions.podeCompartilhar()"
            :pronta-para-compartilhar="actions.prontaParaCompartilhar()"
            @fechar="actions.fechar()"
            @salvar="actions.salvar()"
            @compartilhar="actions.compartilhar()"
            @proxima="actions.proxima()"
            @anterior="actions.anterior()"
        />
    </main>
</template>
```

- [ ] **Step 6: Rotas da galeria ativas** — garantir que `router.ts` tem as linhas `/e/:slug/fotos` e `/p/:chave/fotos` descomentadas.

- [ ] **Step 7: Verificar e commitar**

Run: `npm run test -w apps/web-participante` e `npm run typecheck -w apps/web-participante`
Expected: PASS.

```bash
git add apps/web-participante/src
git commit -m "feat(web-participante): galeria de todas as fotos com abas de dia

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Front — memória no fluxo de busca e rebusca sem câmera

**Files:**
- Modify: `apps/web-participante/src/pages/evento/evento.ts`
- Modify: `apps/web-participante/src/pages/evento/evento.test.ts`
- Modify: `apps/web-participante/src/pages/resultado/resultado.ts`
- Modify: `apps/web-participante/src/pages/resultado/resultado.test.ts`
- Modify: `apps/web-participante/src/pages/resultado/index.vue`
- Modify: `apps/web-participante/src/pages/privacidade/index.vue`

**Interfaces:**
- Consumes: `guardarMemoria`, `memoriaDoEvento`, `atualizarMemoria`, `limparMemoria` (`ts/memoria.ts`), `buscarPorSelfie`, `VERSAO_TERMO` (`ts/busca.ts`), `entradaDaBusca`/`guardarEntrada` (`ts/entrada.ts`).
- Produces: `resultado.actions.rebuscar(): Promise<void>` e `state.rebuscando: boolean`, usados só pelo próprio `index.vue`.

- [ ] **Step 1: Testes que falham — evento grava memória; resultado atualiza, limpa e rebusca**

Em `evento.test.ts`, acrescentar ao mock e aos testes (adapte ao estilo do arquivo, que já mocka `../../ts/busca` desde a Task 2):

```ts
vi.mock("../../ts/memoria", () => ({ guardarMemoria: vi.fn() }));
// ... no describe:
test("busca com fotos guarda a memória do aparelho", async () => {
    vi.mocked(buscarPorSelfie).mockResolvedValue({ token: "tok9", status: "liberada", qtd_fotos: 3, previas: [] });
    state.slug = "corrida-demo";
    state.chaveAcesso = "";
    state.consentiu = true;
    state.selfies = [new File(["selfie"], "selfie.jpg", { type: "image/jpeg" })];

    await actions.buscar();

    expect(guardarMemoria).toHaveBeenCalledWith(
        "/e/corrida-demo",
        expect.objectContaining({ token: "tok9", qtd_fotos: 3, validade_ate: null })
    );
});
```

Em `resultado.test.ts`, acrescentar mocks e testes:

```ts
vi.mock("../../ts/memoria", () => ({
    memoriaDoEvento: vi.fn(),
    atualizarMemoria: vi.fn(),
    limparMemoria: vi.fn(),
    guardarMemoria: vi.fn(),
}));
vi.mock("../../ts/busca", () => ({ buscarPorSelfie: vi.fn(), VERSAO_TERMO: "v1" }));
vi.mock("../../ts/entrada", () => ({ entradaDaBusca: vi.fn(), guardarEntrada: vi.fn() }));

const memoriaComSelfie = {
    token: "tok123",
    qtd_fotos: 2,
    validade_ate: null,
    selfie: new Blob(["selfie"], { type: "image/jpeg" }),
    criado_em: "2026-09-29T10:00:00.000Z",
};

// ... nos testes:
test("resultado carregado carimba a validade na memória do mesmo token", async () => {
    vi.mocked(getResultado).mockResolvedValue(resultadoCheio);
    vi.mocked(entradaDaBusca).mockReturnValue("/e/corrida-da-serra");
    vi.mocked(memoriaDoEvento).mockResolvedValue({ ...memoriaComSelfie, token: "tok123" });

    await actions.init("tok123");

    expect(atualizarMemoria).toHaveBeenCalledWith(
        "/e/corrida-da-serra",
        expect.objectContaining({ validade_ate: resultadoCheio.validade_ate, qtd_fotos: 2 })
    );
});

test("token recusado pela API limpa a memória daquele token", async () => {
    vi.mocked(getResultado).mockRejectedValue(new ErroDaApi("O prazo para baixar estas fotos venceu. Faça a busca de novo."));
    vi.mocked(entradaDaBusca).mockReturnValue("/e/corrida-da-serra");
    vi.mocked(memoriaDoEvento).mockResolvedValue({ ...memoriaComSelfie, token: "tok123" });

    await actions.init("tok123");

    expect(limparMemoria).toHaveBeenCalledWith("/e/corrida-da-serra");
});

test("rebuscar reenvia a selfie guardada sem abrir a câmera", async () => {
    vi.mocked(entradaDaBusca).mockReturnValue("/e/corrida-da-serra");
    vi.mocked(memoriaDoEvento).mockResolvedValue(memoriaComSelfie);
    vi.mocked(buscarPorSelfie).mockResolvedValue({ token: "tokNovo", status: "liberada", qtd_fotos: 5, previas: [] });
    vi.mocked(getResultado).mockResolvedValue(resultadoCheio);
    state.token = "tok123";

    await actions.rebuscar();

    expect(buscarPorSelfie).toHaveBeenCalledWith(
        expect.objectContaining({ slug: "corrida-da-serra", tokenOrigem: "tok123", selfies: [expect.any(File)] })
    );
    expect(roteador.replace).toHaveBeenCalledWith({ name: "resultado", params: { token: "tokNovo" } });
});

test("rebuscar sem selfie guardada cai na câmera", async () => {
    vi.mocked(entradaDaBusca).mockReturnValue("/e/corrida-da-serra");
    vi.mocked(memoriaDoEvento).mockResolvedValue(null);
    state.token = "tok123";

    await actions.rebuscar();

    expect(buscarPorSelfie).not.toHaveBeenCalled();
    expect(roteador.push).toHaveBeenCalledWith("/e/corrida-da-serra/selfie");
});
```

(Acrescente `replace: vi.fn()` ao mock hoisted do roteador que o arquivo já tem.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -w apps/web-participante -- "evento|resultado"`
Expected: FAIL — `guardarMemoria` não chamado, `rebuscar` não existe.

- [ ] **Step 3: Implementar no `evento.ts`**

No `buscar()`, logo após `actions.encerrarCamera();` e antes do `router.push`:

```ts
            const caminho = state.chaveAcesso ? `/p/${state.chaveAcesso}` : `/e/${state.slug}`;
            guardarEntrada(resposta.token, caminho);
            // A validade só vem no resultado: fica nula até a tela de resultado carimbá-la.
            await guardarMemoria(caminho, {
                token: resposta.token,
                qtd_fotos: resposta.qtd_fotos,
                validade_ate: null,
                selfie: state.selfies[0] ?? null,
                criado_em: new Date().toISOString(),
            });
```

(Substitui a linha atual do `guardarEntrada`; importar `guardarMemoria` de `../../ts/memoria`.)

- [ ] **Step 4: Implementar no `resultado.ts`**

Imports novos: `buscarPorSelfie`, `VERSAO_TERMO` de `../../ts/busca`; `atualizarMemoria`, `guardarMemoria`, `limparMemoria`, `memoriaDoEvento` de `../../ts/memoria`; `guardarEntrada` junto do `entradaDaBusca` já importado.

No `state`: acrescentar `rebuscando: false`.

Helper no módulo:

```ts
// O caminho de entrada é o elo com a memória: vem da busca guardada e, sem ela, do slug
// público que o resultado conhece.
function caminhoDoEvento(): string | null {
    return entradaDaBusca(state.token) ?? (state.slug ? `/e/${state.slug}` : null);
}
```

No fim do `try` do `init` (depois de `state.validadeAte = ...`):

```ts
            const caminho = caminhoDoEvento();
            if (caminho) {
                const memoria = await memoriaDoEvento(caminho);
                if (memoria?.token === token)
                    await atualizarMemoria(caminho, { validade_ate: resposta.validade_ate, qtd_fotos: resposta.fotos.length });
            }
```

No `catch` do `init` (depois de `state.mensagem = ...`):

```ts
            const caminho = caminhoDoEvento();
            if (caminho && erro instanceof ErroDaApi) {
                const memoria = await memoriaDoEvento(caminho);
                // Só a memória deste token: o servidor recusou, o atalho local morreu com ele.
                if (memoria?.token === token) await limparMemoria(caminho);
            }
```

(Importar `ErroDaApi` de `../../ts/api`.)

Ações novas / ajustadas:

```ts
    // "Buscar de novo" sem câmera: reenvia a selfie que ficou no aparelho. Sem selfie
    // guardada (aba anônima, memória limpa), o caminho antigo — a câmera — continua valendo.
    async rebuscar(): Promise<void> {
        const caminho = caminhoDoEvento();
        const memoria = caminho ? await memoriaDoEvento(caminho) : null;
        if (!caminho || !memoria?.selfie) {
            actions.voltarParaCamera();
            return;
        }

        state.rebuscando = true;
        state.mensagem = "";
        try {
            const resposta = await buscarPorSelfie({
                slug: caminho.startsWith("/e/") ? caminho.slice(3) : undefined,
                chaveAcesso: caminho.startsWith("/p/") ? caminho.slice(3) : undefined,
                versaoTermo: VERSAO_TERMO,
                selfies: [new File([memoria.selfie], "selfie.jpg", { type: "image/jpeg" })],
                tokenOrigem: state.token,
            });
            if (resposta.status === "aguardando") {
                state.mensagem = "Este evento pede uma confirmação que ainda não está disponível por aqui. Avise a organização.";
                return;
            }
            guardarEntrada(resposta.token, caminho);
            await guardarMemoria(caminho, {
                ...memoria,
                token: resposta.token,
                qtd_fotos: resposta.qtd_fotos,
                validade_ate: null,
                criado_em: new Date().toISOString(),
            });
            router.replace({ name: "resultado", params: { token: resposta.token } });
            await actions.init(resposta.token);
        } catch (erro) {
            state.mensagem = erro instanceof Error ? erro.message : "Não conseguimos buscar de novo. Tente outra selfie.";
        } finally {
            state.rebuscando = false;
        }
    },

    // A home agora ocupa /e/<slug>: a câmera é sempre <caminho>/selfie. O history.back
    // saiu porque o "voltar" pode ser a home, não a câmera.
    temCaminhoParaCamera(): boolean {
        return Boolean(caminhoDoEvento());
    },

    voltarParaCamera(): void {
        const caminho = caminhoDoEvento();
        if (caminho) router.push(`${caminho}/selfie`);
    },
```

- [ ] **Step 5: Ajustar `resultado/index.vue`**

O botão "Chegaram fotos novas? Buscar de novo" passa a rebuscar:

```vue
            <button
                v-if="actions.temCaminhoParaCamera()"
                type="button"
                class="mt-5 w-full text-center text-[11px] text-white/75"
                :disabled="state.rebuscando"
                @click="actions.rebuscar()"
            >
                {{ state.rebuscando ? "Buscando fotos novas…" : "Chegaram fotos novas? Buscar de novo" }}
            </button>

            <!-- Rebusca recusada (selfie guardada não serviu): a saída é a câmera (spec §7). -->
            <button
                v-if="state.mensagem && !state.rebuscando && actions.temCaminhoParaCamera()"
                type="button"
                class="mt-2 w-full text-center text-[11px] underline"
                @click="actions.voltarParaCamera()"
            >
                Tirar outra selfie
            </button>
```

Os botões "Tentar outra selfie" / "Fazer a busca de novo" (telas de zero fotos e de erro) continuam chamando `actions.voltarParaCamera()`.

- [ ] **Step 6: Frase na privacidade**

Em `pages/privacidade/index.vue`, junto do trecho que explica a selfie, acrescentar um parágrafo no mesmo estilo do texto existente:

> "Para você não precisar tirar outra selfie ao voltar, uma cópia reduzida dela pode ficar guardada **somente no seu aparelho**. Ela nunca volta para nossos servidores; tirar uma nova selfie substitui a anterior, e limpar os dados do navegador a apaga."

- [ ] **Step 7: Rodar e ver passar**

Run: `npm run test -w apps/web-participante`
Expected: PASS (incluindo os testes antigos do resultado — os que usavam `history.state.back` para `temCaminhoParaCamera` precisam ser ajustados para o critério novo).

- [ ] **Step 8: Commit**

```bash
git add apps/web-participante/src
git commit -m "feat(web-participante): selfie lembrada no aparelho e busca de novo sem câmera

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Front — botão único Salvar/Compartilhar e telas escuras

**Files:**
- Modify: `apps/web-participante/src/componentes/FotoAberta.vue`
- Modify: `apps/web-participante/src/componentes/FotoAberta.test.ts`
- Modify: `apps/web-participante/src/pages/resultado/resultado.ts`
- Modify: `apps/web-participante/src/pages/resultado/resultado.test.ts`
- Modify: `apps/web-participante/src/pages/resultado/index.vue`

**Interfaces:**
- Consumes: `compartilharFoto`, `podeCompartilharArquivos` (`ts/compartilhar.ts`). Props e emits de `FotoAberta` **não mudam** (`foto`, `podeCompartilhar`, `prontaParaCompartilhar`; emits `fechar/salvar/compartilhar/proxima/anterior`) — só o template.
- Produces: nada novo para outras tasks.

- [ ] **Step 1: Teste que falha — FotoAberta com um botão**

Em `FotoAberta.test.ts`, ajustar/acrescentar (no estilo do arquivo):

```ts
test("com suporte a compartilhar há um só botão: Salvar / Compartilhar", () => {
    const aberta = mount(FotoAberta, { props: { foto, podeCompartilhar: true } });
    const botoes = aberta.findAll("button").filter((b) => b.text() !== "×");
    expect(botoes).toHaveLength(1);
    expect(botoes[0].text()).toBe("Salvar / Compartilhar");
    botoes[0].trigger("click");
    expect(aberta.emitted("compartilhar")).toBeTruthy();
});

test("sem suporte o botão é Baixar e salva direto", () => {
    const aberta = mount(FotoAberta, { props: { foto, podeCompartilhar: false } });
    const botoes = aberta.findAll("button").filter((b) => b.text() !== "×");
    expect(botoes).toHaveLength(1);
    expect(botoes[0].text()).toBe("Baixar");
    botoes[0].trigger("click");
    expect(aberta.emitted("salvar")).toBeTruthy();
});

test("aguardando o segundo toque do iPhone, o rótulo avisa", () => {
    const aberta = mount(FotoAberta, { props: { foto, podeCompartilhar: true, prontaParaCompartilhar: true } });
    expect(aberta.text()).toContain("Toque de novo para compartilhar");
});
```

(Remova/ajuste os testes antigos que esperavam dois botões.)

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -w apps/web-participante -- FotoAberta`
Expected: FAIL — ainda há dois botões.

- [ ] **Step 3: Trocar o bloco de botões do `FotoAberta.vue`**

```vue
        <div class="flex gap-2 px-4 pb-6 pt-3">
            <!-- Um botão só: no celular o menu do sistema tem "Salvar imagem" (que é o salvar
                 de verdade no iPhone); sem suporte a anexo, sobra o download direto. -->
            <button v-if="podeCompartilhar" type="button" class="pilula" @click="$emit('compartilhar')">
                {{ prontaParaCompartilhar ? "Toque de novo para compartilhar" : "Salvar / Compartilhar" }}
            </button>
            <button v-else type="button" class="pilula" @click="$emit('salvar')">Baixar</button>
        </div>
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -w apps/web-participante -- FotoAberta`
Expected: PASS.

- [ ] **Step 5: Resultado usa o compartilhar comum**

Em `resultado.ts`:

- Importar `compartilharFoto` e `podeCompartilharArquivos` de `../../ts/compartilhar`; remover as funções locais `foiCancelado`/`recusadoPorFaltaDeToque`.
- `podeCompartilhar()` vira:

```ts
    podeCompartilhar(): boolean {
        return podeCompartilharArquivos();
    },
```

- `compartilhar(indice)` vira:

```ts
    async compartilhar(indice: number): Promise<void> {
        const foto = state.fotos[indice];
        if (!foto || !podeCompartilharArquivos()) return;

        const pronta = prontaParaEnvio?.indice === indice ? prontaParaEnvio : null;
        prontaParaEnvio = null;
        state.compartilharPronto = null;

        let url = pronta?.url ?? null;
        try {
            if (!url) url = await actions.linkDaFoto(indice);
            if (!url) return;

            const resultado = await compartilharFoto({
                url,
                nomeArquivo: `foto-${foto.id_foto}.jpg`,
                titulo: state.evento,
                arquivoPronto: pronta?.arquivo,
            });
            if (resultado.situacao === "toqueDeNovo") {
                prontaParaEnvio = { indice, arquivo: resultado.arquivo, url };
                state.compartilharPronto = indice;
            }
        } catch (erro) {
            // Qualquer outra recusa: a pessoa fica com a foto salva em vez de um botão mudo.
            if (url) baixarArquivo(url);
            else actions.mostrarFalha(erro);
        }
    },
```

Os testes existentes do resultado sobre compartilhar (se mockavam `navigator.share` direto) passam a mockar `../../ts/compartilhar` — mantendo os mesmos cenários: sucesso, "toque de novo" e fallback para download.

- [ ] **Step 6: Resultado escuro**

Em `resultado/index.vue`: `class="tela-largada px-5 py-7"` → `class="tela-foto px-5 py-7"`, e o `<h1 class="titulo mt-1">{{ titulo }}</h1>` ganha `titulo-tela`: `class="titulo titulo-tela mt-1"`.

- [ ] **Step 7: Rodar tudo e commitar**

Run: `npm run test -w apps/web-participante` e `npm run typecheck -w apps/web-participante`
Expected: PASS.

```bash
git add apps/web-participante/src
git commit -m "feat(web-participante): botão único Salvar/Compartilhar e telas de foto escuras

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Verificação de ponta a ponta e documentação

**Files:**
- Modify: `docs/desenvolvimento.md` (roteiro manual)
- Test: builds e suítes completas

**Interfaces:**
- Consumes: tudo acima.
- Produces: roteiro manual atualizado.

- [ ] **Step 1: Suítes e builds completos**

Run:
```bash
npm run test -w apps/api && npm run test -w apps/web-participante
npm run build -w apps/web-participante
```
Expected: tudo PASS; build sem erro de tipo (o `build` roda `vue-tsc`).

- [ ] **Step 2: Ponta a ponta manual com dois dias**

Subir o compose de dev e o evento demo (como `docs/desenvolvimento.md` já descreve), depois espalhar as fotos em dois dias:

```sql
-- No psql do compose: metade das fotos vai para a véspera.
UPDATE foto SET capturada_em = capturada_em - interval '1 day'
 WHERE id_foto IN (SELECT id_foto FROM foto WHERE id_evento = 1 ORDER BY id_foto LIMIT (SELECT count(*) / 2 FROM foto WHERE id_evento = 1));
```

Roteiro no navegador (e no celular na mesma rede):
1. Abrir `/#/e/<slug>` → home com nome, período e os botões.
2. "Ver todas as fotos" → dois chips com contagem; trocar de dia zera a grade; "Ver mais fotos" pagina; abrir foto → swipe, botão único.
3. Voltar à home → "Buscar minhas fotos" → selfie → resultado.
4. Fechar a aba, reabrir `/#/e/<slug>` → "Minhas fotos (N)" direto.
5. No resultado, "Buscar de novo" → busca sem câmera.
6. No iPhone (ou responsive + share simulado): "Salvar / Compartilhar" abre a folha do sistema.

- [ ] **Step 3: Atualizar `docs/desenvolvimento.md`**

Acrescentar ao roteiro manual existente os passos acima (dois dias via SQL, home, galeria, memória, botão único), no mesmo tom do documento.

- [ ] **Step 4: Commit final**

```bash
git add docs/desenvolvimento.md
git commit -m "docs(desenvolvimento): roteiro manual das melhorias do participante

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
