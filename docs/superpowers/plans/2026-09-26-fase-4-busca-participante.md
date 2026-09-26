# Fase 4, parte 1 — Busca e entrega ao participante: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O participante manda uma selfie e recebe as fotos dele do evento: busca por embedding no pgvector, agrupamento por limiar, página de resultados com links assinados, ZIP e galeria do anfitrião — tudo como API, sem nenhum frontend e sem WhatsApp.

**Architecture:** A VPS ganha a área `_PARTICIPANTE` (busca, resultado) e `_ANFITRIAO` (galeria), no mesmo padrão `route/ctrl/sql` das áreas `_ADMIN` e `_ESTACAO` já existentes. A selfie entra por multipart, vai para o tmpfs `/data/selfies`, vira embedding no `vision` (modo `selfie-cpu`, que já roda no compose da VPS) e é apagada no `finally`. A consulta usa o índice HNSW que já existe em `rosto.embedding`. Os arquivos não são servidos pelo Node: um nginx novo, atrás do Traefik, valida `secure_link` e entrega direto do disco. O processo `worker` passa a ter filas também no papel `vps` (hoje ele encerra dizendo que não tem nada a fazer), para montar os ZIPs.

**Tech Stack:** Node 22, TypeScript strict, Express 5, `pg` com pgvector, BullMQ + ioredis (já em uso desde a fase 3), `archiver` (novo, ZIP em modo store), nginx `secure_link` (imagem `nginx:alpine`, config por template com envsubst), `node:crypto` para as assinaturas.

**Spec:** [docs/superpowers/specs/2026-09-18-plataforma-fotos-design.md](../specs/2026-09-18-plataforma-fotos-design.md) — seção 8 inteira menos "Verificação pelo WhatsApp", "Calibração do limiar", "Patrocinadores" e "Moderação de fotos" (esses quatro são a parte 2); seção 10 (LGPD); seção 5.1 (tabelas). Leia o spec junto com este plano.

## Global Constraints

- Node 22, TypeScript `strict`, CommonJS, Express 5, imports relativos (sem alias). Um módulo por pasta: `route.<m>.ts` (Router fino, só dispatch), `ctrl.<m>.ts` (regra de negócio), `sql.<m>.ts` (só SQL), `i.<m>.ts` (interfaces, só quando a `ctrl` manipula o dado antes de devolver), `<m>.http` (exemplos REST Client).
- RPC: `POST /api/<area>/<modulo>` com `{ call, ... }` despachado por `per()`. Multipart usa `express-fileupload`, com `call` como campo do formulário.
- Banco: `ConexaoPostgres` (`open`, `openTransaction`, `queryParam`, `queryOneParam`, `executeParamCount`, `marcarErro`, `close`). Placeholders `?`. Embeddings entram e saem como texto: `?::vector` na escrita, `[0.1,0.2,...]` na leitura.
- Erros: campo obrigatório ausente → `{ msg, error: true }` devolvido pela Router; erro exibível → `ErroTratado` (o `per` responde 422); o resto vira 500. Mensagens em português, sempre voltadas ao participante ("Não conseguimos ler sua selfie"), nunca com detalhe técnico.
- Log: `console.log`/`console.error` com prefixo `[Componente]`, em português. **Nunca** logar embedding, telefone, token de busca, `chave_aparelho` nem caminho de selfie.
- LGPD (spec §10): a selfie existe só durante a requisição e é apagada no `finally`; o embedding da selfie **nunca** é gravado em banco nem em log.
- Testes: `node:test` + `node:assert` via `tsx --test`, ao lado do código (`<nome>.test.ts`) para o que é puro; o que precisa de Postgres/Redis/nginx fica em `apps/api/integracao/`.
- A suíte de integração roda com o `worker-estacao` parado (ver `docs/desenvolvimento.md`).
- Nos testes de integração, todo evento criado no banco da **estação** leva `id_evento` explícito; no banco da **VPS** o `serial` é usado normalmente.
- Comentários só para o porquê não óbvio.
- Nenhuma migration nova: `busca`, `busca_foto`, `participante`, `participante_evento`, `aparelho` e `arquivo_zip` já existem desde a fase 1. Não altere migrations aplicadas.
- Todo commit termina com `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## Fora desta parte

Verificação por WhatsApp (que no projeto passa pelo **Chatwoot**, não pela Cloud API da Meta — a §8 do spec está desatualizada nesse ponto), calibração do limiar, patrocinadores, moderação de fotos, expurgo e exclusão LGPD são a **parte 2** da fase 4. Qualquer frontend é fase 5 em diante.

Como o WhatsApp não existe ainda, o caminho completo do participante só fecha em evento com `config.exigir_whatsapp = false`. A busca já grava `status = 'aguardando'` com código de 5 dígitos quando o evento exige verificação — o que falta é quem entrega esse código e libera a busca, e isso é a parte 2.

## Review Focus

Entradas que o spec implica mas que nenhum teste de task exercita, da mais provável de machucar para a menos:

1. **Selfie sem rosto, com vários rostos ou ilegível** — o `vision` devolve 422 com um código (`sem_rosto`, `varios_rostos`, `arquivo_invalido`); o participante precisa ver a mensagem correspondente, não um 500. Pinado na Task 8.
2. **Link assinado adulterado ou vencido** — trocar um byte do `md5` ou passar um `expires` no passado não pode entregar a foto. Pinado na Task 2.
3. **Evento privado acessado pelo slug** — o spec diz "evento privado nunca é acessível pelo slug"; entrar por `slug` num evento `privado = 'S'` tem que ser recusado mesmo com o slug correto. Pinado na Task 8.
4. **Token de resultado de outra busca, expirado ou de busca `aguardando`** — não pode devolver foto de terceiro nem furar a verificação. Pinado na Task 9.
5. **Busca em evento sem nenhuma foto** — responde `liberada` com `qtd_fotos = 0`, sem código e sem pedir nada (spec §8); não pode virar erro nem pedir WhatsApp. Pinado na Task 8.

## Mapa de arquivos

```
apps/api/src/
├── services/
│   ├── linkArquivo.ts          # CRIAR: assinarUrlArquivo (formato do nginx secure_link)
│   ├── limiteTaxa.ts           # CRIAR: contarNaJanela (Redis INCR+EXPIRE), ipDoPedido
│   ├── vision.ts               # MODIFICAR: acrescenta embedSelfie
│   └── config.ts               # MODIFICAR: VISION_URL no papel vps, BUSCA_LIMITE_IP,
│                               #            CONFIAR_CLOUDFLARE, ARQUIVO_LINK_VALIDADE_S, RAIZ_SELFIES, RAIZ_ZIPS
├── _PARTICIPANTE/
│   ├── busca/                  route.busca.ts ctrl.busca.ts sql.busca.ts i.busca.ts busca.http
│   └── resultado/              route.resultado.ts ctrl.resultado.ts sql.resultado.ts i.resultado.ts resultado.http
├── _ANFITRIAO/
│   └── galeria/                route.galeria.ts ctrl.galeria.ts sql.galeria.ts galeria.http
├── jobs/
│   └── zip.ts                  # CRIAR: job que monta o ZIP com archiver
├── routes/participanteRoute.ts # MODIFICAR: monta busca e resultado
├── routes/anfitriaoRoute.ts    # MODIFICAR: monta galeria
└── worker.ts                   # MODIFICAR: no papel vps, sobe o worker da fila zip
infra/nginx/
├── Dockerfile                  # CRIAR: nginx:alpine + template
└── arquivos.conf.template      # CRIAR: secure_link em /arquivos
docker-compose.vps.yml          # MODIFICAR: serviço arquivos (nginx), volume zips
docker-compose.dev.yml          # MODIFICAR: serviço arquivos, volumes
.env.vps.example                # MODIFICAR: novas variáveis
```

---

### Task 1: Assinatura dos links de arquivo

**Files:**
- Create: `apps/api/src/services/linkArquivo.ts`
- Test: `apps/api/src/services/linkArquivo.test.ts`
- Modify: `apps/api/src/services/config.ts` (`ARQUIVO_LINK_VALIDADE_S`), `.env.vps.example`

**Interfaces:**
- Consumes: `config` (`apps/api/src/services/config.ts`)
- Produces:
  - `assinarUrlArquivo(uri: string, expiraEm: number, segredo: string): string` — devolve `<uri>?md5=<base64url>&expires=<epoch>`
  - `urlDaFoto(idEvento: number, hash: string, tipo: "web" | "thumb" | "previa", agora?: number): string`
  - `urlDoZip(idEvento: number, idArquivoZip: number, agora?: number): string`
  - `config.arquivoLinkValidadeS: number` (padrão `3600`)

O nginx calcula `md5("$secure_link_expires$uri <SEGREDO>")` e compara com o argumento `md5`, em base64 **url-safe sem padding** (`+`→`-`, `/`→`_`, sem `=`). A ordem e o espaço antes do segredo são exatamente os da diretiva — qualquer diferença faz o nginx responder 403.

- [ ] **Step 1: Escrever o teste**

`apps/api/src/services/linkArquivo.test.ts`:

```ts
import { test, describe } from "node:test";
import assert from "node:assert";
import { createHash } from "node:crypto";
import { assinarUrlArquivo } from "./linkArquivo";

// Reproduz o que o nginx faz, para o teste falhar se o formato sair do combinado.
function comoONginxCalcula(uri: string, expira: number, segredo: string): string {
    return createHash("md5")
        .update(`${expira}${uri} ${segredo}`)
        .digest("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
}

describe("assinarUrlArquivo", () => {
    test("monta a URL com md5 e expires", () => {
        const url = assinarUrlArquivo("/arquivos/7/abc_web.jpg", 1800000000, "segredo-de-teste");
        const esperado = comoONginxCalcula("/arquivos/7/abc_web.jpg", 1800000000, "segredo-de-teste");

        assert.strictEqual(url, `/arquivos/7/abc_web.jpg?md5=${esperado}&expires=1800000000`);
    });

    test("a assinatura é url-safe: sem +, / ou =", () => {
        // Varre várias entradas porque só algumas produzem os caracteres problemáticos.
        for (let i = 0; i < 200; i++) {
            const url = assinarUrlArquivo(`/arquivos/${i}/foto_web.jpg`, 1800000000 + i, "s");
            const md5 = new URLSearchParams(url.split("?")[1]).get("md5") as string;
            assert.ok(!/[+/=]/.test(md5), `assinatura não url-safe: ${md5}`);
        }
    });

    test("mudar qualquer parte muda a assinatura", () => {
        const base = assinarUrlArquivo("/arquivos/7/abc_web.jpg", 1800000000, "segredo");
        assert.notStrictEqual(base, assinarUrlArquivo("/arquivos/7/abc_thumb.jpg", 1800000000, "segredo"));
        assert.notStrictEqual(base, assinarUrlArquivo("/arquivos/7/abc_web.jpg", 1800000001, "segredo"));
        assert.notStrictEqual(base, assinarUrlArquivo("/arquivos/7/abc_web.jpg", 1800000000, "outro"));
    });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx --test apps/api/src/services/linkArquivo.test.ts`
Expected: FAIL — `Cannot find module './linkArquivo'`.

- [ ] **Step 3: Implementar**

`apps/api/src/services/linkArquivo.ts`:

```ts
import { createHash } from "node:crypto";
import { config } from "./config";

// Formato do `secure_link` do nginx: md5 de "$secure_link_expires$uri <SEGREDO>", em base64
// url-safe sem padding. O espaço antes do segredo faz parte da string assinada.
export function assinarUrlArquivo(uri: string, expiraEm: number, segredo: string): string {
    const assinatura = createHash("md5")
        .update(`${expiraEm}${uri} ${segredo}`)
        .digest("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=/g, "");
    return `${uri}?md5=${assinatura}&expires=${expiraEm}`;
}

function expiracao(agora: number): number {
    return Math.floor(agora / 1000) + config.arquivoLinkValidadeS;
}

export function urlDaFoto(idEvento: number, hash: string, tipo: "web" | "thumb" | "previa", agora = Date.now()): string {
    return assinarUrlArquivo(`/arquivos/${idEvento}/${hash}_${tipo}.jpg`, expiracao(agora), config.arquivoSegredo);
}

export function urlDoZip(idEvento: number, idArquivoZip: number, agora = Date.now()): string {
    return assinarUrlArquivo(`/arquivos/zips/${idEvento}/${idArquivoZip}.zip`, expiracao(agora), config.arquivoSegredo);
}
```

Em `apps/api/src/services/config.ts`, acrescente ao `iConfig`:

```ts
    arquivoLinkValidadeS: number;
```

E no retorno de `carregarConfig`:

```ts
        arquivoLinkValidadeS: helper.numero(env.ARQUIVO_LINK_VALIDADE_S, 3600, "ARQUIVO_LINK_VALIDADE_S"),
```

Em `.env.vps.example`, acrescente:

```
# Validade dos links assinados de foto e ZIP, em segundos.
ARQUIVO_LINK_VALIDADE_S=3600
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx --test apps/api/src/services/linkArquivo.test.ts`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/linkArquivo.ts apps/api/src/services/linkArquivo.test.ts \
        apps/api/src/services/config.ts .env.vps.example
git commit -m "feat(api): assinatura dos links de arquivo (secure_link)" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: nginx que serve os arquivos e valida a assinatura

**Files:**
- Create: `infra/nginx/Dockerfile`, `infra/nginx/arquivos.conf.template`
- Test: `apps/api/integracao/linkArquivoNginx.test.ts`
- Modify: `docker-compose.dev.yml`, `docker-compose.vps.yml`

**Interfaces:**
- Consumes: `assinarUrlArquivo` (Task 1)
- Produces: serviço `arquivos` servindo `/arquivos/<id_evento>/<hash>_<tipo>.jpg` e `/arquivos/zips/<id_evento>/<id>.zip`, em `127.0.0.1:8080` no dev

O spec manda servir os arquivos fora do Node. A VPS usa Traefik (não nginx) como borda, então o nginx entra como serviço interno atrás dele: o Traefik roteia `/arquivos` para o nginx, que valida o `secure_link` e entrega do disco.

- [ ] **Step 1: Escrever o teste**

`apps/api/integracao/linkArquivoNginx.test.ts`:

```ts
import { test, before, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import { iniciarConfig } from "../src/services/config";
import { assinarUrlArquivo } from "../src/services/linkArquivo";

// O nginx do compose de dev publica em 127.0.0.1:8080 e lê o volume fotos-vps.
const BASE = "http://127.0.0.1:8080";
const SEGREDO = "dev-somente-local";
const ID_EVENTO = 999001;
const HASH = "a".repeat(64);

before(async () => {
    iniciarConfig({
        PAPEL: "vps",
        POSTGRES_HOST: "127.0.0.1",
        POSTGRES_PORT: "5433",
        POSTGRES_USER: "fotos",
        POSTGRES_PASSWORD: "fotos",
        POSTGRES_DB: "fotos_vps",
        REDIS_URL: "redis://127.0.0.1:6380",
        ESTACAO_CHAVE: "a".repeat(32),
        ARQUIVO_SEGREDO: SEGREDO,
        OPERADOR_SEGREDO: "a".repeat(32),
    });

    // Grava o arquivo pelo container da api-vps, que monta o mesmo volume que o nginx lê.
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const executar = promisify(execFile);
    await executar("docker", [
        "compose", "-f", "docker-compose.dev.yml", "exec", "-T", "api-vps",
        "sh", "-lc", `mkdir -p /data/fotos/${ID_EVENTO} && printf 'conteudo-da-foto' > /data/fotos/${ID_EVENTO}/${HASH}_web.jpg`,
    ]);
    await fs.access("docker-compose.dev.yml"); // roda a partir da raiz do repositório
});

describe("nginx /arquivos", () => {
    test("link assinado válido entrega o arquivo", async () => {
        const expira = Math.floor(Date.now() / 1000) + 600;
        const url = assinarUrlArquivo(`/arquivos/${ID_EVENTO}/${HASH}_web.jpg`, expira, SEGREDO);
        const resposta = await fetch(BASE + url);

        assert.strictEqual(resposta.status, 200);
        assert.strictEqual(await resposta.text(), "conteudo-da-foto");
    });

    test("assinatura adulterada é recusada", async () => {
        const expira = Math.floor(Date.now() / 1000) + 600;
        const url = assinarUrlArquivo(`/arquivos/${ID_EVENTO}/${HASH}_web.jpg`, expira, SEGREDO);
        const adulterada = url.replace(/md5=./, "md5=Z");

        assert.strictEqual((await fetch(BASE + adulterada)).status, 403);
    });

    test("link vencido é recusado", async () => {
        const expira = Math.floor(Date.now() / 1000) - 10;
        const url = assinarUrlArquivo(`/arquivos/${ID_EVENTO}/${HASH}_web.jpg`, expira, SEGREDO);

        assert.strictEqual((await fetch(BASE + url)).status, 410);
    });

    test("sem assinatura nenhuma é recusado", async () => {
        assert.strictEqual((await fetch(`${BASE}/arquivos/${ID_EVENTO}/${HASH}_web.jpg`)).status, 403);
    });

    test("?dl=1 marca o download como anexo", async () => {
        const expira = Math.floor(Date.now() / 1000) + 600;
        const url = assinarUrlArquivo(`/arquivos/${ID_EVENTO}/${HASH}_web.jpg`, expira, SEGREDO);
        const resposta = await fetch(`${BASE}${url}&dl=1`);

        assert.match(resposta.headers.get("content-disposition") ?? "", /attachment/);
    });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx --test apps/api/integracao/linkArquivoNginx.test.ts`
Expected: FAIL — `fetch failed` (nada escutando na 8080).

- [ ] **Step 3: Implementar**

`infra/nginx/Dockerfile`:

```dockerfile
FROM nginx:1.27-alpine
# A imagem oficial roda envsubst nos arquivos de /etc/nginx/templates na subida,
# gravando o resultado em /etc/nginx/conf.d. É assim que o segredo entra sem ficar na imagem.
COPY arquivos.conf.template /etc/nginx/templates/arquivos.conf.template
```

`infra/nginx/arquivos.conf.template`:

```nginx
server {
    listen 80;
    server_name _;
    # Fotos e ZIPs são pesados e a resposta é um arquivo inteiro: sendfile evita copiar
    # para o espaço do usuário.
    sendfile on;
    tcp_nopush on;

    # Os ZIPs ficam em outro volume: precisa vir antes do /arquivos/ genérico.
    location /arquivos/zips/ {
        secure_link $arg_md5,$arg_expires;
        secure_link_md5 "$secure_link_expires$uri ${ARQUIVO_SEGREDO}";

        if ($secure_link = "") { return 403; }
        if ($secure_link = "0") { return 410; }

        add_header Content-Disposition "attachment" always;
        alias /data/zips/;
    }

    location /arquivos/ {
        secure_link $arg_md5,$arg_expires;
        secure_link_md5 "$secure_link_expires$uri ${ARQUIVO_SEGREDO}";

        # Vazio = assinatura não confere. "0" = assinatura certa, prazo vencido.
        if ($secure_link = "") { return 403; }
        if ($secure_link = "0") { return 410; }

        # Só com ?dl=1 o navegador baixa em vez de exibir.
        if ($arg_dl = "1") { add_header Content-Disposition "attachment" always; }

        alias /data/fotos/;
    }

    location = /health {
        access_log off;
        return 200 "ok\n";
    }
}
```

Em `docker-compose.dev.yml`, acrescente em `services:`:

```yaml
  arquivos:
    build: { context: ./infra/nginx }
    environment:
      ARQUIVO_SEGREDO: dev-somente-local
    volumes:
      - fotos-vps:/data/fotos:ro
      - zips-vps:/data/zips:ro
    ports:
      - "127.0.0.1:8080:80"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1/health"]
      interval: 10s
      retries: 5
```

E em `volumes:` (raiz do arquivo de dev), acrescente `zips-vps:`.

Em `docker-compose.vps.yml`, acrescente em `services:`:

```yaml
  arquivos:
    build: { context: ./infra/nginx }
    environment:
      ARQUIVO_SEGREDO: ${ARQUIVO_SEGREDO}
    volumes:
      - fotos:/data/fotos:ro
      - zips:/data/zips:ro
    labels:
      - traefik.enable=true
      - traefik.http.routers.arquivos.rule=Host(`${DOMINIO_PARTICIPANTE}`) && PathPrefix(`/arquivos`)
      - traefik.http.routers.arquivos.entrypoints=websecure
      - traefik.http.routers.arquivos.tls=true
      - traefik.http.services.arquivos.loadbalancer.server.port=80
    restart: unless-stopped
```

E em `volumes:` (raiz do arquivo da VPS), acrescente `zips:`.

- [ ] **Step 4: Subir e rodar**

Run:

```bash
docker compose -f docker-compose.dev.yml up -d --build arquivos
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/health
npx tsx --test apps/api/integracao/linkArquivoNginx.test.ts
```

Expected: `200` no health e os 5 testes passando. Se o `secure_link` recusar um link que deveria valer, confira se o `ARQUIVO_SEGREDO` do serviço `arquivos` é o mesmo que o teste usa — a string assinada inclui o segredo.

- [ ] **Step 5: Commit**

```bash
git add infra/nginx docker-compose.dev.yml docker-compose.vps.yml apps/api/integracao/linkArquivoNginx.test.ts
git commit -m "feat(infra): nginx servindo /arquivos com secure_link" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Limite de buscas por IP

**Files:**
- Create: `apps/api/src/services/limiteTaxa.ts`
- Test: `apps/api/src/services/limiteTaxa.test.ts` (pura), `apps/api/integracao/limiteTaxa.test.ts` (Redis real)
- Modify: `apps/api/src/services/config.ts` (`BUSCA_LIMITE_IP`, `CONFIAR_CLOUDFLARE`), `.env.vps.example`

**Interfaces:**
- Consumes: `criarFila`/`fecharFila` não; usa a conexão Redis direto por `obterRedis()` (novo export de `services/fila.ts`)
- Produces:
  - `ipDoPedido(headers: Record<string, unknown>, ipSocket: string | undefined, confiarCloudflare: boolean): string` — pura
  - `contarNaJanela(chave: string, janelaS: number): Promise<number>` — INCR com EXPIRE na primeira ocorrência
  - `config.buscaLimiteIp: number` (padrão 10), `config.confiarCloudflare: boolean` (padrão false)

`CF-Connecting-IP` só é confiado quando `CONFIAR_CLOUDFLARE=true`: sem isso, qualquer um manda o cabeçalho e escapa do limite.

- [ ] **Step 1: Escrever o teste puro**

`apps/api/src/services/limiteTaxa.test.ts`:

```ts
import { test, describe } from "node:test";
import assert from "node:assert";
import { ipDoPedido } from "./limiteTaxa";

describe("ipDoPedido", () => {
    test("usa CF-Connecting-IP quando a Cloudflare é confiável", () => {
        assert.strictEqual(ipDoPedido({ "cf-connecting-ip": "203.0.113.7" }, "10.0.0.1", true), "203.0.113.7");
    });

    test("ignora CF-Connecting-IP quando a Cloudflare não é confiável", () => {
        // Sem isso, qualquer um manda o cabeçalho e fura o limite de buscas.
        assert.strictEqual(ipDoPedido({ "cf-connecting-ip": "203.0.113.7" }, "10.0.0.1", false), "10.0.0.1");
    });

    test("cai no IP do socket quando o cabeçalho não veio", () => {
        assert.strictEqual(ipDoPedido({}, "10.0.0.1", true), "10.0.0.1");
    });

    test("sem IP nenhum devolve desconhecido, em vez de vazio", () => {
        // Chave vazia no Redis juntaria pedidos de origens diferentes no mesmo balde.
        assert.strictEqual(ipDoPedido({}, undefined, true), "desconhecido");
    });

    test("cabeçalho repetido (array) usa o primeiro valor", () => {
        assert.strictEqual(ipDoPedido({ "cf-connecting-ip": ["203.0.113.7", "1.2.3.4"] }, "10.0.0.1", true), "203.0.113.7");
    });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx --test apps/api/src/services/limiteTaxa.test.ts`
Expected: FAIL — `Cannot find module './limiteTaxa'`.

- [ ] **Step 3: Implementar**

Em `apps/api/src/services/fila.ts`, exporte a conexão (a função `obterConexao` já existe, hoje privada):

```ts
export function obterRedis(): Redis {
    return obterConexao();
}
```

`apps/api/src/services/limiteTaxa.ts`:

```ts
import { obterRedis } from "./fila";
import { config } from "./config";

export function ipDoPedido(headers: Record<string, unknown>, ipSocket: string | undefined, confiarCloudflare: boolean): string {
    if (confiarCloudflare) {
        const bruto = headers["cf-connecting-ip"];
        const valor = Array.isArray(bruto) ? bruto[0] : bruto;
        if (typeof valor === "string" && valor.length > 0) return valor;
    }
    return ipSocket && ipSocket.length > 0 ? ipSocket : "desconhecido";
}

// Devolve quantas vezes a chave foi usada na janela, contando esta. O EXPIRE só é aplicado
// na primeira, para a janela ser fixa e não andar para frente a cada pedido.
export async function contarNaJanela(chave: string, janelaS: number): Promise<number> {
    const redis = obterRedis();
    const completa = `${config.redis.prefixo}limite:${chave}`;
    const valor = await redis.incr(completa);
    if (valor === 1) await redis.expire(completa, janelaS);
    return valor;
}
```

Em `apps/api/src/services/config.ts`, acrescente ao `iConfig`:

```ts
    buscaLimiteIp: number;
    confiarCloudflare: boolean;
```

E no retorno de `carregarConfig`:

```ts
        buscaLimiteIp: helper.numero(env.BUSCA_LIMITE_IP, 10, "BUSCA_LIMITE_IP"),
        confiarCloudflare: env.CONFIAR_CLOUDFLARE === "true",
```

Em `.env.vps.example`, acrescente:

```
# Buscas por IP a cada 10 minutos.
BUSCA_LIMITE_IP=10
# Só ligue com a Cloudflare na frente: é ela quem preenche CF-Connecting-IP.
CONFIAR_CLOUDFLARE=false
```

- [ ] **Step 4: Escrever o teste de integração**

`apps/api/integracao/limiteTaxa.test.ts`:

```ts
import { test, before, after } from "node:test";
import assert from "node:assert";
import { iniciarConfig } from "../src/services/config";
import { contarNaJanela } from "../src/services/limiteTaxa";
import { fecharFila } from "../src/services/fila";

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

test("conta as chamadas da mesma chave e separa chaves diferentes", async () => {
    const chave = `teste-${Date.now()}`;
    assert.strictEqual(await contarNaJanela(chave, 60), 1);
    assert.strictEqual(await contarNaJanela(chave, 60), 2);
    assert.strictEqual(await contarNaJanela(chave, 60), 3);
    assert.strictEqual(await contarNaJanela(`${chave}-outro`, 60), 1);
});

test("a janela expira sozinha", async () => {
    const chave = `teste-expira-${Date.now()}`;
    await contarNaJanela(chave, 1);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.strictEqual(await contarNaJanela(chave, 1), 1);
});

after(async () => {
    await fecharFila();
});
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx tsx --test apps/api/src/services/limiteTaxa.test.ts apps/api/integracao/limiteTaxa.test.ts`
Expected: PASS nos dois arquivos (7 testes).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/limiteTaxa.ts apps/api/src/services/limiteTaxa.test.ts \
        apps/api/integracao/limiteTaxa.test.ts apps/api/src/services/fila.ts \
        apps/api/src/services/config.ts .env.vps.example
git commit -m "feat(api): limite de buscas por IP" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Agrupamento dos resultados

**Files:**
- Create: `apps/api/src/_PARTICIPANTE/busca/i.busca.ts`, `apps/api/src/_PARTICIPANTE/busca/agrupar.ts`
- Test: `apps/api/src/_PARTICIPANTE/busca/agrupar.test.ts`

**Interfaces:**
- Consumes: nada
- Produces:
  - `i.busca.ts`: `interface RostoParecido { id_foto: number; id_rosto: number; similaridade: number }`, `interface FotoEncontrada { id_foto: number; id_rosto: number; similaridade: number }`
  - `agruparResultados(listas: RostoParecido[][], limiar: number): FotoEncontrada[]`

Cada selfie devolve a sua lista. O participante manda até `max_selfies`, então a mesma foto aparece em mais de uma lista: fica a maior similaridade, guardando o `id_rosto` daquele melhor match (é ele que a exclusão LGPD apaga depois).

- [ ] **Step 1: Escrever o teste**

`apps/api/src/_PARTICIPANTE/busca/agrupar.test.ts`:

```ts
import { test, describe } from "node:test";
import assert from "node:assert";
import { agruparResultados } from "./agrupar";

describe("agruparResultados", () => {
    test("sem listas devolve vazio", () => {
        assert.deepStrictEqual(agruparResultados([], 0.42), []);
    });

    test("fica com a maior similaridade da foto e o id_rosto daquele match", () => {
        const resultado = agruparResultados(
            [
                [{ id_foto: 1, id_rosto: 10, similaridade: 0.5 }],
                [{ id_foto: 1, id_rosto: 11, similaridade: 0.8 }],
            ],
            0.42
        );

        assert.deepStrictEqual(resultado, [{ id_foto: 1, id_rosto: 11, similaridade: 0.8 }]);
    });

    test("corta o que está abaixo do limiar", () => {
        const resultado = agruparResultados(
            [
                [
                    { id_foto: 1, id_rosto: 10, similaridade: 0.9 },
                    { id_foto: 2, id_rosto: 20, similaridade: 0.41 },
                ],
            ],
            0.42
        );

        assert.deepStrictEqual(resultado.map((f) => f.id_foto), [1]);
    });

    test("o limiar é inclusivo: igual ao limiar entra", () => {
        const resultado = agruparResultados([[{ id_foto: 1, id_rosto: 10, similaridade: 0.42 }]], 0.42);
        assert.strictEqual(resultado.length, 1);
    });

    test("ordena por similaridade desc, desempatando por id_foto asc", () => {
        const resultado = agruparResultados(
            [
                [
                    { id_foto: 3, id_rosto: 30, similaridade: 0.7 },
                    { id_foto: 1, id_rosto: 10, similaridade: 0.9 },
                    { id_foto: 2, id_rosto: 20, similaridade: 0.7 },
                ],
            ],
            0.42
        );

        assert.deepStrictEqual(resultado.map((f) => f.id_foto), [1, 2, 3]);
    });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx --test apps/api/src/_PARTICIPANTE/busca/agrupar.test.ts`
Expected: FAIL — `Cannot find module './agrupar'`.

- [ ] **Step 3: Implementar**

`apps/api/src/_PARTICIPANTE/busca/i.busca.ts`:

```ts
export interface RostoParecido {
    id_foto: number;
    id_rosto: number;
    similaridade: number;
}

export type FotoEncontrada = RostoParecido;

export interface RespostaBusca {
    token: string;
    status: "aguardando" | "liberada";
    qtd_fotos: number;
    previas: string[];
    codigo?: string;
}
```

`apps/api/src/_PARTICIPANTE/busca/agrupar.ts`:

```ts
import { FotoEncontrada, RostoParecido } from "./i.busca";

// Cada selfie traz a sua lista. A mesma foto pode aparecer em várias: fica a maior
// similaridade, com o id_rosto daquele match (é esse rosto que a exclusão LGPD apaga).
export function agruparResultados(listas: RostoParecido[][], limiar: number): FotoEncontrada[] {
    const melhorPorFoto = new Map<number, FotoEncontrada>();

    for (const lista of listas) {
        for (const item of lista) {
            const atual = melhorPorFoto.get(item.id_foto);
            if (!atual || item.similaridade > atual.similaridade) melhorPorFoto.set(item.id_foto, { ...item });
        }
    }

    return [...melhorPorFoto.values()]
        .filter((foto) => foto.similaridade >= limiar)
        .sort((a, b) => b.similaridade - a.similaridade || a.id_foto - b.id_foto);
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx --test apps/api/src/_PARTICIPANTE/busca/agrupar.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/_PARTICIPANTE/busca/agrupar.ts apps/api/src/_PARTICIPANTE/busca/agrupar.test.ts \
        apps/api/src/_PARTICIPANTE/busca/i.busca.ts
git commit -m "feat(api): agrupamento dos resultados da busca" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Status inicial da busca

**Files:**
- Create: `apps/api/src/_PARTICIPANTE/busca/status.ts`
- Test: `apps/api/src/_PARTICIPANTE/busca/status.test.ts`

**Interfaces:**
- Consumes: nada
- Produces:
  - `interface EntradaStatus { qtdFotos: number; exigirWhatsapp: boolean; idParticipanteAparelho: number | null; origem: { status: string; id_evento: number; id_participante: number | null; dentroDaValidade: boolean } | null; idEvento: number }`
  - `decidirStatusBusca(entrada: EntradaStatus): { status: "aguardando" | "liberada"; idParticipante: number | null; precisaCodigo: boolean }`

A ordem das regras é a do spec §8 e importa: quem tem zero fotos não é convidado a se verificar, e uma busca de origem **sem participante** (a de zero fotos, por exemplo) não pode servir de atalho para pular a verificação.

- [ ] **Step 1: Escrever o teste**

`apps/api/src/_PARTICIPANTE/busca/status.test.ts`:

```ts
import { test, describe } from "node:test";
import assert from "node:assert";
import { decidirStatusBusca } from "./status";

const BASE = { qtdFotos: 3, exigirWhatsapp: true, idParticipanteAparelho: null, origem: null, idEvento: 7 };

describe("decidirStatusBusca", () => {
    test("zero fotos libera sem pedir nada", () => {
        const r = decidirStatusBusca({ ...BASE, qtdFotos: 0 });
        assert.deepStrictEqual(r, { status: "liberada", idParticipante: null, precisaCodigo: false });
    });

    test("evento que não exige WhatsApp libera", () => {
        const r = decidirStatusBusca({ ...BASE, exigirWhatsapp: false });
        assert.deepStrictEqual(r, { status: "liberada", idParticipante: null, precisaCodigo: false });
    });

    test("aparelho conhecido libera e reaproveita o participante", () => {
        const r = decidirStatusBusca({ ...BASE, idParticipanteAparelho: 42 });
        assert.deepStrictEqual(r, { status: "liberada", idParticipante: 42, precisaCodigo: false });
    });

    test("token de origem liberado e verificado libera", () => {
        const r = decidirStatusBusca({
            ...BASE,
            origem: { status: "liberada", id_evento: 7, id_participante: 42, dentroDaValidade: true },
        });
        assert.deepStrictEqual(r, { status: "liberada", idParticipante: 42, precisaCodigo: false });
    });

    test("origem sem participante não dispensa a verificação", () => {
        // Senão a busca de zero fotos viraria atalho para pular o WhatsApp.
        const r = decidirStatusBusca({
            ...BASE,
            origem: { status: "liberada", id_evento: 7, id_participante: null, dentroDaValidade: true },
        });
        assert.strictEqual(r.status, "aguardando");
    });

    test("origem de outro evento não vale", () => {
        const r = decidirStatusBusca({
            ...BASE,
            origem: { status: "liberada", id_evento: 8, id_participante: 42, dentroDaValidade: true },
        });
        assert.strictEqual(r.status, "aguardando");
    });

    test("origem fora da validade não vale", () => {
        const r = decidirStatusBusca({
            ...BASE,
            origem: { status: "liberada", id_evento: 7, id_participante: 42, dentroDaValidade: false },
        });
        assert.strictEqual(r.status, "aguardando");
    });

    test("origem ainda aguardando não vale", () => {
        const r = decidirStatusBusca({
            ...BASE,
            origem: { status: "aguardando", id_evento: 7, id_participante: 42, dentroDaValidade: true },
        });
        assert.strictEqual(r.status, "aguardando");
    });

    test("sem nada disso, aguarda com código", () => {
        const r = decidirStatusBusca(BASE);
        assert.deepStrictEqual(r, { status: "aguardando", idParticipante: null, precisaCodigo: true });
    });

    test("zero fotos ganha de tudo: nem aparelho nem origem mudam a resposta", () => {
        const r = decidirStatusBusca({
            ...BASE,
            qtdFotos: 0,
            idParticipanteAparelho: 42,
            origem: { status: "liberada", id_evento: 7, id_participante: 42, dentroDaValidade: true },
        });
        assert.deepStrictEqual(r, { status: "liberada", idParticipante: null, precisaCodigo: false });
    });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx --test apps/api/src/_PARTICIPANTE/busca/status.test.ts`
Expected: FAIL — `Cannot find module './status'`.

- [ ] **Step 3: Implementar**

`apps/api/src/_PARTICIPANTE/busca/status.ts`:

```ts
export interface BuscaDeOrigem {
    status: string;
    id_evento: number;
    id_participante: number | null;
    dentroDaValidade: boolean;
}

export interface EntradaStatus {
    idEvento: number;
    qtdFotos: number;
    exigirWhatsapp: boolean;
    idParticipanteAparelho: number | null;
    origem: BuscaDeOrigem | null;
}

export interface DecisaoStatus {
    status: "aguardando" | "liberada";
    idParticipante: number | null;
    precisaCodigo: boolean;
}

// A ordem é a do spec §8 e é o que impede dois furos: pedir verificação a quem não tem
// foto nenhuma, e usar uma busca vazia como atalho para pular a verificação.
export function decidirStatusBusca(entrada: EntradaStatus): DecisaoStatus {
    if (entrada.qtdFotos === 0) return { status: "liberada", idParticipante: null, precisaCodigo: false };
    if (!entrada.exigirWhatsapp) return { status: "liberada", idParticipante: null, precisaCodigo: false };
    if (entrada.idParticipanteAparelho !== null)
        return { status: "liberada", idParticipante: entrada.idParticipanteAparelho, precisaCodigo: false };

    const origem = entrada.origem;
    if (
        origem &&
        origem.status === "liberada" &&
        origem.id_evento === entrada.idEvento &&
        origem.dentroDaValidade &&
        origem.id_participante !== null
    )
        return { status: "liberada", idParticipante: origem.id_participante, precisaCodigo: false };

    return { status: "aguardando", idParticipante: null, precisaCodigo: true };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx --test apps/api/src/_PARTICIPANTE/busca/status.test.ts`
Expected: PASS (10 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/_PARTICIPANTE/busca/status.ts apps/api/src/_PARTICIPANTE/busca/status.test.ts
git commit -m "feat(api): decisão do status inicial da busca" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Embedding da selfie no vision

**Files:**
- Modify: `apps/api/src/services/vision.ts`, `apps/api/src/services/config.ts` (`VISION_URL` obrigatório também no papel `vps`, `RAIZ_SELFIES`), `apps/api/src/services/config.test.ts`, `.env.vps.example`
- Test: `apps/api/integracao/visionSelfie.test.ts`

**Interfaces:**
- Consumes: `config.visionUrl`
- Produces:
  - `interface SelfieEmbedding { embedding: number[]; det_score: number }`
  - `class ErroSelfie extends Error { codigo: string }`
  - `embedSelfie(caminho: string): Promise<SelfieEmbedding>` — lança `ErroSelfie` quando o vision responde 422
  - `config.raizSelfies: string` (padrão `/data/selfies`)

O `vision` em modo `selfie-cpu` responde 422 com `{ codigo, msg }` para selfie sem rosto, com vários rostos ou ilegível (ver `apps/vision-service/app/rostos.py`). O código precisa chegar à ctrl para virar mensagem ao participante.

- [ ] **Step 1: Escrever o teste**

`apps/api/integracao/visionSelfie.test.ts`:

```ts
import { test, before, describe } from "node:test";
import assert from "node:assert";
import express from "express";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import { iniciarConfig } from "../src/services/config";
import { ErroSelfie, embedSelfie } from "../src/services/vision";

let servidor: Server;

before(async () => {
    const app = express();
    app.use(express.json());
    app.post("/embed-selfie", (req, res) => {
        const caminho = String(req.body.caminho);
        if (caminho.includes("sem-rosto")) {
            res.status(422).json({ codigo: "sem_rosto", msg: "Não achamos um rosto nessa foto." });
            return;
        }
        if (caminho.includes("varios")) {
            res.status(422).json({ codigo: "varios_rostos", msg: "Tem mais de um rosto na foto." });
            return;
        }
        res.json({ embedding: new Array(512).fill(0.05), det_score: 0.9 });
    });
    servidor = app.listen(0);
    await new Promise((resolve) => servidor.once("listening", resolve));

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
        VISION_URL: `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`,
    });
});

describe("embedSelfie", () => {
    test("devolve o embedding de 512 posições", async () => {
        const r = await embedSelfie("/data/selfies/ok.jpg");
        assert.strictEqual(r.embedding.length, 512);
        assert.strictEqual(r.det_score, 0.9);
    });

    test("selfie sem rosto vira ErroSelfie com o código do vision", async () => {
        await assert.rejects(
            () => embedSelfie("/data/selfies/sem-rosto.jpg"),
            (erro: ErroSelfie) => {
                assert.strictEqual(erro.codigo, "sem_rosto");
                assert.match(erro.message, /rosto/i);
                return true;
            }
        );
    });

    test("selfie com vários rostos vira ErroSelfie", async () => {
        await assert.rejects(
            () => embedSelfie("/data/selfies/varios.jpg"),
            (erro: ErroSelfie) => erro.codigo === "varios_rostos"
        );
    });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx --test apps/api/integracao/visionSelfie.test.ts`
Expected: FAIL — `embedSelfie` não existe em `../src/services/vision`.

- [ ] **Step 3: Implementar**

Acrescente em `apps/api/src/services/vision.ts`:

```ts
export interface SelfieEmbedding {
    embedding: number[];
    det_score: number;
}

// Erro que a ctrl converte em mensagem ao participante. O `codigo` vem do vision
// (sem_rosto, varios_rostos, arquivo_invalido) e escolhe o texto.
export class ErroSelfie extends Error {
    constructor(
        public codigo: string,
        mensagem: string
    ) {
        super(mensagem);
        this.name = "ErroSelfie";
    }
}

export async function embedSelfie(caminho: string): Promise<SelfieEmbedding> {
    const controlador = new AbortController();
    // 20s: acima disso o participante desiste, e o spec manda responder "muita gente buscando".
    const temporizador = setTimeout(() => controlador.abort(), 20_000);
    try {
        const resposta = await fetch(`${config.visionUrl}/embed-selfie`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ caminho }),
            signal: controlador.signal,
        });
        const corpo = (await resposta.json()) as { codigo?: string; msg?: string; embedding?: number[]; det_score?: number };

        if (resposta.status === 422) throw new ErroSelfie(corpo.codigo ?? "arquivo_invalido", corpo.msg ?? "Não conseguimos ler sua selfie.");
        if (!resposta.ok) throw new Error(`[Vision] /embed-selfie respondeu ${resposta.status}`);

        return { embedding: corpo.embedding as number[], det_score: corpo.det_score ?? 0 };
    } finally {
        clearTimeout(temporizador);
    }
}
```

Em `apps/api/src/services/config.ts`, o papel `vps` passa a exigir `VISION_URL` (a VPS roda o `vision` em modo `selfie-cpu`):

```ts
    vps: ["ARQUIVO_SEGREDO", "OPERADOR_SEGREDO", "VISION_URL"],
```

E acrescente ao `iConfig` e ao retorno:

```ts
    raizSelfies: string;
```

```ts
        raizSelfies: env.RAIZ_SELFIES || "/data/selfies",
```

Isso muda a mensagem de variáveis faltando do papel `vps`, então em `apps/api/src/services/config.test.ts`:

1. No teste `"VPS exige ARQUIVO_SEGREDO e OPERADOR_SEGREDO"`, troque o regex para `/faltando para o papel vps: ARQUIVO_SEGREDO, OPERADOR_SEGREDO, VISION_URL/`.
2. Em **todas** as chamadas de `carregarConfig` com `PAPEL: "vps"` que hoje passam `ARQUIVO_SEGREDO` e `OPERADOR_SEGREDO`, acrescente `VISION_URL: "http://vision:8000"`.

Os arquivos de teste que montam config de VPS também precisam da variável — acrescente `VISION_URL: "http://127.0.0.1:1"` ao objeto de config em: `apps/api/src/services/server.test.ts`, `apps/api/integracao/ambiente.ts`, `apps/api/integracao/adminEvento.test.ts`, `apps/api/integracao/adminFotografo.test.ts`, `apps/api/integracao/adminLogin.test.ts`, `apps/api/integracao/criarOperador.test.ts`, `apps/api/integracao/estacaoSincronizacao.test.ts`, `apps/api/integracao/estacaoSinal.test.ts`, `apps/api/integracao/estacaoFoto.test.ts`, `apps/api/integracao/conexaoCommit.test.ts` e `apps/api/integracao/linkArquivoNginx.test.ts`. Rode `npm run test -w apps/api && npm run test:integracao -w apps/api` e corrija qualquer outro que apareça com a mesma mensagem.

Em `.env.vps.example`, acrescente:

```
# O vision da VPS roda em modo selfie-cpu (embedding da selfie).
VISION_URL=http://vision:8000
# Pasta tmpfs onde a selfie fica durante a busca, e só durante ela.
RAIZ_SELFIES=/data/selfies
```

No `docker-compose.dev.yml`, o serviço `api-vps` passa a precisar de `VISION_URL: http://vision-cpu:8000` no `environment`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx --test apps/api/integracao/visionSelfie.test.ts && npm run test -w apps/api && npm run test:integracao -w apps/api`
Expected: todos PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/vision.ts apps/api/src/services/config.ts apps/api/src/services/config.test.ts \
        apps/api/src/services/server.test.ts apps/api/integracao apps/api/src/services \
        .env.vps.example docker-compose.dev.yml
git commit -m "feat(api): embedding da selfie pelo vision (VPS)" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Consulta por embedding no pgvector

**Files:**
- Create: `apps/api/src/_PARTICIPANTE/busca/sql.busca.ts`
- Test: `apps/api/integracao/buscaSql.test.ts`

**Interfaces:**
- Consumes: `ConexaoPostgres`, `RostoParecido` (Task 4)
- Produces:
  - `buscarRostosParecidos(conexao, idEvento: number, embedding: number[]): Promise<RostoParecido[]>`
  - `eventoPorSlugOuChave(conexao, { slug?: string; chaveAcesso?: string }): Promise<LinhaEventoBusca | undefined>`
  - `gravarBusca(conexao, dados: DadosGravarBusca): Promise<number>`
  - `gravarBuscaFotos(conexao, idBusca: number, fotos: FotoEncontrada[]): Promise<void>`
  - `buscaPorToken(conexao, token: string): Promise<LinhaBuscaToken | undefined>`
  - `participantePorChaveAparelho(conexao, idEvento: number, chaveHash: string): Promise<number | undefined>`
  - `codigoEmUso(conexao, codigo: string): Promise<boolean>`

A consulta roda numa transação só para poder usar `SET LOCAL` nos parâmetros do HNSW: `ef_search = 100` melhora o recall, e `iterative_scan = relaxed_order` é o que mantém o recall quando o filtro por evento corta muito do índice (o índice é global, com todos os eventos).

- [ ] **Step 1: Escrever o teste**

`apps/api/integracao/buscaSql.test.ts`:

```ts
import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { iniciarConfig } from "../src/services/config";
import { buscarRostosParecidos, eventoPorSlugOuChave } from "../src/_PARTICIPANTE/busca/sql.busca";

let conexao: ConexaoPostgres;
let idEvento: number;
let slug: string;
let chaveAcesso: string;

// Dois vetores bem diferentes: o "alvo" bate com a busca, o "outro" não.
const ALVO = new Array(512).fill(0).map((_, i) => (i < 256 ? 0.06 : 0.01));
const OUTRO = new Array(512).fill(0).map((_, i) => (i < 256 ? -0.06 : 0.01));

function vetor(valores: number[]): string {
    return `[${valores.join(",")}]`;
}

before(async () => {
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
        VISION_URL: "http://127.0.0.1:1",
    });

    conexao = new ConexaoPostgres();
    await conexao.open();
    slug = `evento-busca-${Date.now()}`;
    chaveAcesso = `chave-${Date.now()}`;
    const [evento] = await conexao.queryParam<{ id_evento: number }>(
        `INSERT INTO evento (nome, slug, tipo, privado, chave_acesso, chave_anfitriao, data_fim, config)
         VALUES ('Busca', ?, 'esportivo', 'N', ?, ?, '2026-12-31', '{"limiar":0.42}') RETURNING id_evento`,
        [slug, chaveAcesso, `anfitriao-${Date.now()}`]
    );
    idEvento = evento.id_evento;

    // Três fotos: uma visível com o rosto alvo, uma oculta com o mesmo rosto, uma visível com outro rosto.
    for (const [sufixo, situacao, vec] of [
        ["visivel", "visivel", ALVO],
        ["oculta", "oculta", ALVO],
        ["outra", "visivel", OUTRO],
    ] as const) {
        const [foto] = await conexao.queryParam<{ id_foto: number }>(
            `INSERT INTO foto (id_evento, hash_arquivo, largura, altura, bytes_web, qtd_rostos, situacao)
             VALUES (?, ?, 100, 100, 10, 1, ?) RETURNING id_foto`,
            [idEvento, `${"b".repeat(60)}${sufixo.slice(0, 4)}`, situacao]
        );
        await conexao.executeParamCount(
            "INSERT INTO rosto (id_foto, id_evento, embedding, bbox, det_score, area_px) VALUES (?, ?, ?::vector, '[1,2,3,4]', 0.9, 100)",
            [foto.id_foto, idEvento, vetor(vec as number[])]
        );
    }
});

describe("buscarRostosParecidos", () => {
    test("acha o rosto parecido e ignora foto oculta", async () => {
        const encontrados = await buscarRostosParecidos(conexao, idEvento, ALVO);

        assert.ok(encontrados.length >= 1, "deveria achar ao menos a foto visível");
        const melhor = encontrados[0];
        assert.ok(melhor.similaridade > 0.9, `similaridade baixa demais: ${melhor.similaridade}`);

        // A foto oculta tem o mesmo embedding: se aparecesse, viria com similaridade igual.
        const iguaisAoMelhor = encontrados.filter((e) => Math.abs(e.similaridade - melhor.similaridade) < 1e-6);
        assert.strictEqual(iguaisAoMelhor.length, 1, "foto oculta não pode entrar no resultado");
    });

    test("não devolve rosto de outro evento", async () => {
        const [outroEvento] = await conexao.queryParam<{ id_evento: number }>(
            `INSERT INTO evento (nome, slug, tipo, privado, chave_anfitriao, data_fim, config)
             VALUES ('Outro', ?, 'esportivo', 'N', ?, '2026-12-31', '{}') RETURNING id_evento`,
            [`evento-outro-${Date.now()}`, `anfitriao-outro-${Date.now()}`]
        );
        const encontrados = await buscarRostosParecidos(conexao, outroEvento.id_evento, ALVO);
        assert.deepStrictEqual(encontrados, []);
    });

    test("devolve similaridade entre 0 e 1", async () => {
        const encontrados = await buscarRostosParecidos(conexao, idEvento, ALVO);
        for (const e of encontrados) assert.ok(e.similaridade >= -1 && e.similaridade <= 1, `fora da faixa: ${e.similaridade}`);
    });
});

describe("eventoPorSlugOuChave", () => {
    test("acha por slug quando o evento é público", async () => {
        const evento = await eventoPorSlugOuChave(conexao, { slug });
        assert.strictEqual(evento?.id_evento, idEvento);
    });

    test("acha por chave de acesso", async () => {
        const evento = await eventoPorSlugOuChave(conexao, { chaveAcesso });
        assert.strictEqual(evento?.id_evento, idEvento);
    });

    test("evento privado não é achado pelo slug", async () => {
        await conexao.executeParamCount("UPDATE evento SET privado = 'S' WHERE id_evento = ?", [idEvento]);
        try {
            assert.strictEqual(await eventoPorSlugOuChave(conexao, { slug }), undefined);
            // ... mas continua acessível pela chave.
            assert.strictEqual((await eventoPorSlugOuChave(conexao, { chaveAcesso }))?.id_evento, idEvento);
        } finally {
            await conexao.executeParamCount("UPDATE evento SET privado = 'N' WHERE id_evento = ?", [idEvento]);
        }
    });

    test("slug inexistente devolve undefined", async () => {
        assert.strictEqual(await eventoPorSlugOuChave(conexao, { slug: "nao-existe-mesmo" }), undefined);
    });
});

after(async () => {
    await conexao?.close();
    await fecharBanco();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx --test apps/api/integracao/buscaSql.test.ts`
Expected: FAIL — `Cannot find module '../src/_PARTICIPANTE/busca/sql.busca'`.

- [ ] **Step 3: Implementar**

`apps/api/src/_PARTICIPANTE/busca/sql.busca.ts`:

```ts
import ConexaoPostgres from "../../db/conexaoPostgres";
import { FotoEncontrada, RostoParecido } from "./i.busca";

export interface LinhaEventoBusca {
    id_evento: number;
    nome: string;
    slug: string;
    privado: "S" | "N";
    ativo: "S" | "N";
    data_fim: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: any;
}

export interface DadosGravarBusca {
    id_evento: number;
    token: string;
    codigo: string | null;
    status: "aguardando" | "liberada";
    qtd_fotos: number;
    versao_termo: string;
    aceita_marketing: "S" | "N";
    id_participante: number | null;
    id_busca_origem: number | null;
    codigo_expira_em: string | null;
}

export interface LinhaBuscaToken {
    id_busca: number;
    id_evento: number;
    status: string;
    qtd_fotos: number;
    id_participante: number | null;
    criado_em: string;
}

// O índice HNSW é global (todos os eventos). Com o filtro por evento, a varredura iterativa
// é o que mantém o recall: sem ela, o limite do índice se esgota antes de achar as fotos
// deste evento. `SET LOCAL` exige transação, por isso o BEGIN/COMMIT explícito.
export async function buscarRostosParecidos(conexao: ConexaoPostgres, idEvento: number, embedding: number[]): Promise<RostoParecido[]> {
    const vetor = `[${embedding.join(",")}]`;
    await conexao.executeParamCount("BEGIN");
    try {
        await conexao.executeParamCount("SET LOCAL hnsw.ef_search = 100");
        await conexao.executeParamCount("SET LOCAL hnsw.iterative_scan = relaxed_order");
        const linhas = await conexao.queryParam<{ id_foto: number; id_rosto: string; similaridade: number }>(
            `SELECT r.id_foto, r.id_rosto, 1 - (r.embedding <=> ?::vector) AS similaridade
               FROM rosto r
               JOIN foto f ON f.id_foto = r.id_foto AND f.situacao = 'visivel'
              WHERE r.id_evento = ?
              ORDER BY r.embedding <=> ?::vector
              LIMIT 400`,
            [vetor, idEvento, vetor]
        );
        await conexao.executeParamCount("COMMIT");
        return linhas.map((l) => ({ id_foto: l.id_foto, id_rosto: Number(l.id_rosto), similaridade: Number(l.similaridade) }));
    } catch (erro) {
        await conexao.executeParamCount("ROLLBACK").catch(() => {});
        throw erro;
    }
}

// Evento privado nunca abre pelo slug (spec §8): só pela chave de acesso.
export async function eventoPorSlugOuChave(
    conexao: ConexaoPostgres,
    entrada: { slug?: string; chaveAcesso?: string }
): Promise<LinhaEventoBusca | undefined> {
    if (entrada.chaveAcesso)
        return conexao.queryOneParam<LinhaEventoBusca>(
            "SELECT id_evento, nome, slug, privado, ativo, data_fim, config FROM evento WHERE chave_acesso = ? AND deletado = 'N'",
            [entrada.chaveAcesso]
        );
    if (entrada.slug)
        return conexao.queryOneParam<LinhaEventoBusca>(
            "SELECT id_evento, nome, slug, privado, ativo, data_fim, config FROM evento WHERE slug = ? AND privado = 'N' AND deletado = 'N'",
            [entrada.slug]
        );
    return undefined;
}

export async function participantePorChaveAparelho(conexao: ConexaoPostgres, idEvento: number, chaveHash: string): Promise<number | undefined> {
    const linha = await conexao.queryOneParam<{ id_participante: number }>(
        `SELECT pe.id_participante
           FROM aparelho a
           JOIN participante_evento pe ON pe.id_participante_evento = a.id_participante_evento
          WHERE a.chave_hash = ? AND pe.id_evento = ?`,
        [chaveHash, idEvento]
    );
    return linha?.id_participante;
}

export async function codigoEmUso(conexao: ConexaoPostgres, codigo: string): Promise<boolean> {
    const linha = await conexao.queryOneParam<{ existe: number }>(
        "SELECT 1 AS existe FROM busca WHERE codigo = ? AND status = 'aguardando' AND codigo_expira_em > now()",
        [codigo]
    );
    return Boolean(linha);
}

export async function gravarBusca(conexao: ConexaoPostgres, dados: DadosGravarBusca): Promise<number> {
    const [linha] = await conexao.queryParam<{ id_busca: number }>(
        `INSERT INTO busca (id_evento, token, codigo, status, qtd_fotos, consentimento_em, versao_termo,
                            aceita_marketing, id_participante, id_busca_origem, codigo_expira_em)
         VALUES (?, ?, ?, ?, ?, now(), ?, ?, ?, ?, ?) RETURNING id_busca`,
        [
            dados.id_evento,
            dados.token,
            dados.codigo,
            dados.status,
            dados.qtd_fotos,
            dados.versao_termo,
            dados.aceita_marketing,
            dados.id_participante,
            dados.id_busca_origem,
            dados.codigo_expira_em,
        ]
    );
    return linha.id_busca;
}

export async function gravarBuscaFotos(conexao: ConexaoPostgres, idBusca: number, fotos: FotoEncontrada[]): Promise<void> {
    for (const foto of fotos)
        await conexao.executeParamCount(
            "INSERT INTO busca_foto (id_busca, id_foto, id_rosto, similaridade) VALUES (?, ?, ?, ?) ON CONFLICT (id_busca, id_foto) DO NOTHING",
            [idBusca, foto.id_foto, foto.id_rosto, foto.similaridade]
        );
}

export async function buscaPorToken(conexao: ConexaoPostgres, token: string): Promise<LinhaBuscaToken | undefined> {
    return conexao.queryOneParam<LinhaBuscaToken>(
        "SELECT id_busca, id_evento, status, qtd_fotos, id_participante, criado_em FROM busca WHERE token = ?",
        [token]
    );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx --test apps/api/integracao/buscaSql.test.ts`
Expected: PASS (7 testes). Se `hnsw.iterative_scan` for recusado ("unrecognized configuration parameter"), a versão do pgvector é anterior à 0.8 — confira a imagem do compose (`pgvector/pgvector:0.8.1-pg16`) e registre no relatório se precisar remover a linha.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/_PARTICIPANTE/busca/sql.busca.ts apps/api/integracao/buscaSql.test.ts
git commit -m "feat(api): consulta de rostos parecidos no pgvector" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `_PARTICIPANTE/busca` — a rota da selfie

**Files:**
- Create: `apps/api/src/_PARTICIPANTE/busca/ctrl.busca.ts`, `apps/api/src/_PARTICIPANTE/busca/route.busca.ts`, `apps/api/src/_PARTICIPANTE/busca/busca.http`
- Test: `apps/api/integracao/buscar.test.ts`
- Modify: `apps/api/src/routes/participanteRoute.ts`

**Interfaces:**
- Consumes: `agruparResultados` (Task 4), `decidirStatusBusca` (Task 5), `embedSelfie`/`ErroSelfie` (Task 6), tudo de `sql.busca.ts` (Task 7), `urlDaFoto` (Task 1), `contarNaJanela`/`ipDoPedido` (Task 3), `gerarChave` (fase 3), `ErroTratado`
- Produces: classe `Busca implements iRota` com `buscar(req)` em `POST /api/participante/busca`, devolvendo `RespostaBusca`

Fluxo: limite por IP → grava as selfies no tmpfs → embedding de cada uma → consulta → agrupamento → grava `busca` e `busca_foto` → decide o status → devolve token e prévias. As selfies são apagadas no `finally`, em qualquer caminho.

- [ ] **Step 1: Escrever o teste**

`apps/api/integracao/buscar.test.ts`:

```ts
import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import express from "express";
import fileUpload from "express-fileupload";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { iniciarConfig, config } from "../src/services/config";
import { fecharFila } from "../src/services/fila";
import per from "../src/services/per";
import Busca from "../src/_PARTICIPANTE/busca/route.busca";

let servidorVision: Server;
let servidor: Server;
let base: string;
let conexao: ConexaoPostgres;
let raizSelfies: string;
let idEvento: number;
let slug: string;

const ALVO = new Array(512).fill(0).map((_, i) => (i < 256 ? 0.06 : 0.01));

before(async () => {
    raizSelfies = await fs.mkdtemp(path.join(os.tmpdir(), "selfies-teste-"));

    const appVision = express();
    appVision.use(express.json());
    appVision.post("/embed-selfie", (req, res) => {
        const caminho = String(req.body.caminho);
        // O teste controla a resposta pelo conteúdo do arquivo gravado pela rota.
        if (caminho.includes("x")) res.json({ embedding: ALVO, det_score: 0.9 });
        else res.status(422).json({ codigo: "sem_rosto", msg: "Não achamos um rosto nessa foto." });
    });
    servidorVision = appVision.listen(0);
    await new Promise((resolve) => servidorVision.once("listening", resolve));

    iniciarConfig({
        PAPEL: "vps",
        POSTGRES_HOST: "127.0.0.1",
        POSTGRES_PORT: "5433",
        POSTGRES_USER: "fotos",
        POSTGRES_PASSWORD: "fotos",
        POSTGRES_DB: "fotos_vps",
        REDIS_URL: "redis://127.0.0.1:6380",
        ESTACAO_CHAVE: "a".repeat(32),
        ARQUIVO_SEGREDO: "segredo-de-teste",
        OPERADOR_SEGREDO: "a".repeat(32),
        VISION_URL: `http://127.0.0.1:${(servidorVision.address() as AddressInfo).port}`,
        RAIZ_SELFIES: raizSelfies,
        BUSCA_LIMITE_IP: "3",
    });

    conexao = new ConexaoPostgres();
    await conexao.open();
    slug = `evento-buscar-${Date.now()}`;
    const [evento] = await conexao.queryParam<{ id_evento: number }>(
        `INSERT INTO evento (nome, slug, tipo, privado, chave_acesso, chave_anfitriao, data_fim, config)
         VALUES ('Buscar', ?, 'esportivo', 'N', ?, ?, '2026-12-31', '{"limiar":0.42,"exigir_whatsapp":false,"max_selfies":3}') RETURNING id_evento`,
        [slug, `chave-${Date.now()}`, `anfitriao-${Date.now()}`]
    );
    idEvento = evento.id_evento;

    const [foto] = await conexao.queryParam<{ id_foto: number }>(
        `INSERT INTO foto (id_evento, hash_arquivo, largura, altura, bytes_web, qtd_rostos, situacao)
         VALUES (?, ?, 100, 100, 10, 1, 'visivel') RETURNING id_foto`,
        [idEvento, "c".repeat(64)]
    );
    await conexao.executeParamCount(
        "INSERT INTO rosto (id_foto, id_evento, embedding, bbox, det_score, area_px) VALUES (?, ?, ?::vector, '[1,2,3,4]', 0.9, 100)",
        [foto.id_foto, idEvento, `[${ALVO.join(",")}]`]
    );

    const app = express();
    app.use(fileUpload({ limits: { fileSize: 25 * 1024 * 1024, files: 5 } }));
    app.post("/busca", (req, res, next) => per(req, res, next, Busca));
    servidor = app.listen(0);
    await new Promise((resolve) => servidor.once("listening", resolve));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

async function buscar(campos: Record<string, string>, conteudoSelfie = "x", ip = `1.2.3.${Math.floor(Math.random() * 250)}`) {
    const forma = new FormData();
    forma.append("call", "buscar");
    for (const [chave, valor] of Object.entries(campos)) forma.append(chave, valor);
    forma.append("selfies", new Blob([Buffer.from(conteudoSelfie)]), "selfie.jpg");
    const resposta = await fetch(`${base}/busca`, { method: "POST", headers: { "X-Forwarded-For": ip }, body: forma });
    return { status: resposta.status, corpo: (await resposta.json()) as Record<string, unknown> };
}

describe("buscar", () => {
    test("acha a foto e devolve token liberado com prévias assinadas", async () => {
        const r = await buscar({ slug, versao_termo: "v1", aceita_marketing: "N" });

        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.corpo.status, "liberada");
        assert.strictEqual(r.corpo.qtd_fotos, 1);
        assert.strictEqual((r.corpo.previas as string[]).length, 1);
        assert.match((r.corpo.previas as string[])[0], /^\/arquivos\/\d+\/[a-f0-9]{64}_previa\.jpg\?md5=.+&expires=\d+$/);

        const [gravada] = await conexao.queryParam<{ qtd_fotos: number; status: string }>(
            "SELECT qtd_fotos, status FROM busca WHERE token = ?",
            [r.corpo.token]
        );
        assert.strictEqual(gravada.qtd_fotos, 1);
        assert.strictEqual(gravada.status, "liberada");
    });

    test("a selfie não sobra em disco depois da busca", async () => {
        await buscar({ slug, versao_termo: "v1", aceita_marketing: "N" });
        assert.deepStrictEqual(await fs.readdir(config.raizSelfies), []);
    });

    test("selfie sem rosto responde 422 com a mensagem do vision, e não deixa arquivo", async () => {
        const r = await buscar({ slug, versao_termo: "v1", aceita_marketing: "N" }, "sem-rosto-aqui");

        assert.strictEqual(r.status, 422);
        assert.match(String(r.corpo.msg), /rosto/i);
        assert.deepStrictEqual(await fs.readdir(config.raizSelfies), []);
    });

    test("evento privado não abre pelo slug", async () => {
        await conexao.executeParamCount("UPDATE evento SET privado = 'S' WHERE id_evento = ?", [idEvento]);
        try {
            const r = await buscar({ slug, versao_termo: "v1", aceita_marketing: "N" });
            assert.strictEqual(r.status, 422);
            assert.match(String(r.corpo.msg), /evento/i);
        } finally {
            await conexao.executeParamCount("UPDATE evento SET privado = 'N' WHERE id_evento = ?", [idEvento]);
        }
    });

    test("evento sem nenhuma foto libera com zero e não pede código", async () => {
        const [vazio] = await conexao.queryParam<{ id_evento: number; slug: string }>(
            `INSERT INTO evento (nome, slug, tipo, privado, chave_anfitriao, data_fim, config)
             VALUES ('Vazio', ?, 'esportivo', 'N', ?, '2026-12-31', '{"exigir_whatsapp":true}') RETURNING id_evento, slug`,
            [`evento-vazio-${Date.now()}`, `anfitriao-vazio-${Date.now()}`]
        );

        const r = await buscar({ slug: vazio.slug, versao_termo: "v1", aceita_marketing: "N" });

        assert.strictEqual(r.corpo.status, "liberada");
        assert.strictEqual(r.corpo.qtd_fotos, 0);
        assert.strictEqual(r.corpo.codigo, undefined);
        assert.deepStrictEqual(r.corpo.previas, []);
    });

    test("evento que exige WhatsApp fica aguardando, com código e sem prévias", async () => {
        await conexao.executeParamCount(
            `UPDATE evento SET config = config || '{"exigir_whatsapp":true}'::jsonb WHERE id_evento = ?`,
            [idEvento]
        );
        try {
            const r = await buscar({ slug, versao_termo: "v1", aceita_marketing: "N" });

            assert.strictEqual(r.corpo.status, "aguardando");
            assert.match(String(r.corpo.codigo), /^\d{5}$/);
            assert.deepStrictEqual(r.corpo.previas, [], "aguardando não pode expor imagem nenhuma");
        } finally {
            await conexao.executeParamCount(
                `UPDATE evento SET config = config || '{"exigir_whatsapp":false}'::jsonb WHERE id_evento = ?`,
                [idEvento]
            );
        }
    });

    test("sem slug nem chave_acesso é erro de negócio", async () => {
        const r = await buscar({ versao_termo: "v1", aceita_marketing: "N" });
        assert.strictEqual(r.corpo.error, true);
    });

    test("sem versao_termo é erro de negócio: o consentimento é obrigatório", async () => {
        const r = await buscar({ slug, aceita_marketing: "N" });
        assert.strictEqual(r.corpo.error, true);
    });

    test("passa do limite de buscas do mesmo IP", async () => {
        const ip = `9.9.9.${Math.floor(Math.random() * 250)}`;
        for (let i = 0; i < 3; i++) {
            const ok = await buscar({ slug, versao_termo: "v1", aceita_marketing: "N" }, "x", ip);
            assert.strictEqual(ok.status, 200, `tentativa ${i + 1} deveria passar`);
        }
        const excedeu = await buscar({ slug, versao_termo: "v1", aceita_marketing: "N" }, "x", ip);
        assert.strictEqual(excedeu.status, 422);
        assert.match(String(excedeu.corpo.msg), /tente/i);
    });
});

after(async () => {
    servidor?.close();
    servidorVision?.close();
    await conexao?.close();
    await fs.rm(raizSelfies, { recursive: true, force: true });
    await fecharFila();
    await fecharBanco();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx --test apps/api/integracao/buscar.test.ts`
Expected: FAIL — `Cannot find module '../src/_PARTICIPANTE/busca/route.busca'`.

- [ ] **Step 3: Implementar**

`apps/api/src/_PARTICIPANTE/busca/ctrl.busca.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomInt } from "node:crypto";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { config } from "../../services/config";
import { ErroTratado } from "../../services/erro";
import { gerarChave } from "../../services/aleatorio";
import { urlDaFoto } from "../../services/linkArquivo";
import { contarNaJanela } from "../../services/limiteTaxa";
import { ErroSelfie, embedSelfie } from "../../services/vision";
import { agruparResultados } from "./agrupar";
import { decidirStatusBusca } from "./status";
import { FotoEncontrada, RespostaBusca, RostoParecido } from "./i.busca";
import {
    buscaPorToken,
    buscarRostosParecidos,
    codigoEmUso,
    eventoPorSlugOuChave,
    gravarBusca,
    gravarBuscaFotos,
    participantePorChaveAparelho,
} from "./sql.busca";

const JANELA_LIMITE_S = 600;
const VALIDADE_CODIGO_MIN = 30;

// Mensagens por código do vision: o participante precisa saber o que fazer, sem detalhe técnico.
const MENSAGEM_SELFIE: Record<string, string> = {
    sem_rosto: "Não achamos um rosto nessa foto. Tente uma selfie com o rosto mais perto e bem iluminado.",
    varios_rostos: "Achamos mais de um rosto na foto. Mande uma selfie só sua.",
    rosto_pequeno: "Seu rosto ficou pequeno demais na foto. Chegue mais perto da câmera.",
    arquivo_invalido: "Não conseguimos abrir a foto. Tente outra.",
};

export interface ArquivoSelfie {
    nome: string;
    dados: Buffer;
}

export interface EntradaBuscar {
    slug?: string;
    chaveAcesso?: string;
    versaoTermo: string;
    aceitaMarketing: boolean;
    chaveAparelho?: string;
    tokenOrigem?: string;
    ip: string;
    selfies: ArquivoSelfie[];
}

export default class BuscaCtrl {
    constructor(private conexao: ConexaoPostgres) {}

    async buscar(entrada: EntradaBuscar): Promise<RespostaBusca> {
        const usos = await contarNaJanela(`busca:${entrada.ip}`, JANELA_LIMITE_S);
        if (usos > config.buscaLimiteIp) throw new ErroTratado("Muitas buscas seguidas deste aparelho. Tente de novo em alguns minutos.");

        const evento = await eventoPorSlugOuChave(this.conexao, { slug: entrada.slug, chaveAcesso: entrada.chaveAcesso });
        if (!evento) throw new ErroTratado("Evento não encontrado. Confira o link.");
        if (evento.ativo !== "S") throw new ErroTratado("Este evento não está mais recebendo buscas.");

        const maxSelfies = Number(evento.config?.max_selfies ?? 3);
        const selfies = entrada.selfies.slice(0, maxSelfies);
        const limiar = Number(evento.config?.limiar ?? 0.42);

        const caminhos: string[] = [];
        try {
            const listas: RostoParecido[][] = [];
            for (const selfie of selfies) {
                const caminho = path.join(config.raizSelfies, `${gerarChave(16)}.jpg`);
                await fs.mkdir(config.raizSelfies, { recursive: true });
                await fs.writeFile(caminho, selfie.dados);
                caminhos.push(caminho);

                const { embedding } = await embedSelfie(caminho);
                listas.push(await buscarRostosParecidos(this.conexao, evento.id_evento, embedding));
            }

            const fotos = agruparResultados(listas, limiar);
            return await this.gravarEResponder(entrada, evento, fotos);
        } catch (erro) {
            if (erro instanceof ErroSelfie) throw new ErroTratado(MENSAGEM_SELFIE[erro.codigo] ?? MENSAGEM_SELFIE.arquivo_invalido);
            if (erro instanceof Error && erro.name === "AbortError")
                throw new ErroTratado("Muita gente buscando agora, tente em instantes.");
            throw erro;
        } finally {
            // Spec §10: a selfie existe só durante a busca. Vale para todo caminho, inclusive o de erro.
            await Promise.allSettled(caminhos.map((caminho) => fs.unlink(caminho)));
        }
    }

    private async gravarEResponder(
        entrada: EntradaBuscar,
        evento: { id_evento: number; config: { exigir_whatsapp?: boolean; validade_resultado_dias?: number | null } },
        fotos: FotoEncontrada[]
    ): Promise<RespostaBusca> {
        const idParticipanteAparelho = entrada.chaveAparelho
            ? ((await participantePorChaveAparelho(this.conexao, evento.id_evento, hashDaChave(entrada.chaveAparelho))) ?? null)
            : null;

        const origemLinha = entrada.tokenOrigem ? await buscaPorToken(this.conexao, entrada.tokenOrigem) : undefined;
        // `validade_resultado_dias` nulo significa "até o expurgo": aí não há corte por data.
        const diasValidade = evento.config?.validade_resultado_dias;
        const origemDentroDaValidade =
            !origemLinha || diasValidade === null || diasValidade === undefined
                ? true
                : new Date(origemLinha.criado_em).getTime() + Number(diasValidade) * 86_400_000 > Date.now();

        const decisao = decidirStatusBusca({
            idEvento: evento.id_evento,
            qtdFotos: fotos.length,
            exigirWhatsapp: evento.config?.exigir_whatsapp !== false,
            idParticipanteAparelho,
            origem: origemLinha
                ? {
                      status: origemLinha.status,
                      id_evento: origemLinha.id_evento,
                      id_participante: origemLinha.id_participante,
                      dentroDaValidade: origemDentroDaValidade,
                  }
                : null,
        });

        const token = gerarChave();
        const codigo = decisao.precisaCodigo ? await this.codigoInedito() : null;
        const idBusca = await gravarBusca(this.conexao, {
            id_evento: evento.id_evento,
            token,
            codigo,
            status: decisao.status,
            qtd_fotos: fotos.length,
            versao_termo: entrada.versaoTermo,
            aceita_marketing: entrada.aceitaMarketing ? "S" : "N",
            id_participante: decisao.idParticipante,
            id_busca_origem: origemLinha?.id_busca ?? null,
            codigo_expira_em: codigo ? new Date(Date.now() + VALIDADE_CODIGO_MIN * 60_000).toISOString() : null,
        });
        await gravarBuscaFotos(this.conexao, idBusca, fotos);

        // Com status aguardando nenhuma imagem é exposta, nem a prévia borrada.
        const previas =
            decisao.status === "liberada"
                ? await this.previasAssinadas(fotos.map((f) => f.id_foto), evento.id_evento)
                : [];

        return {
            token,
            status: decisao.status,
            qtd_fotos: fotos.length,
            previas,
            ...(codigo ? { codigo } : {}),
        };
    }

    private async previasAssinadas(idsFoto: number[], idEvento: number): Promise<string[]> {
        if (idsFoto.length === 0) return [];
        const linhas = await this.conexao.queryParam<{ hash_arquivo: string }>(
            "SELECT hash_arquivo FROM foto WHERE id_foto = ANY(?::int[]) ORDER BY id_foto",
            [`{${idsFoto.join(",")}}`]
        );
        return linhas.map((linha) => urlDaFoto(idEvento, linha.hash_arquivo, "previa"));
    }

    private async codigoInedito(): Promise<string> {
        for (let tentativa = 0; tentativa < 10; tentativa++) {
            const codigo = String(randomInt(0, 100_000)).padStart(5, "0");
            if (!(await codigoEmUso(this.conexao, codigo))) return codigo;
        }
        throw new Error("[Busca] não foi possível gerar um código livre");
    }
}

export function hashDaChave(chave: string): string {
    return createHash("sha256").update(chave).digest("hex");
}
```

`apps/api/src/_PARTICIPANTE/busca/route.busca.ts`:

```ts
import { Request } from "express";
import { UploadedFile } from "express-fileupload";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { config } from "../../services/config";
import { iContexto, iRota } from "../../services/per";
import { ipDoPedido } from "../../services/limiteTaxa";
import BuscaCtrl from "./ctrl.busca";

export default class Busca implements iRota {
    conexao = new ConexaoPostgres();
    private ctrl!: BuscaCtrl;

    // A busca é pública: sem autorização, só limite por IP.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(private contexto: iContexto) {}

    async init(): Promise<void> {
        await this.conexao.open();
        this.ctrl = new BuscaCtrl(this.conexao);
    }

    async buscar(req: Request) {
        const { slug, chave_acesso, versao_termo, aceita_marketing, chave_aparelho, token_origem } = req.body;
        if (!slug && !chave_acesso) return { msg: "Informe o evento (slug ou chave_acesso)", error: true };
        if (!versao_termo) return { msg: "É preciso aceitar o termo antes de buscar", error: true };

        const bruto = req.files?.selfies;
        const enviadas = (Array.isArray(bruto) ? bruto : bruto ? [bruto] : []) as UploadedFile[];
        if (enviadas.length === 0) return { msg: "Mande ao menos uma selfie", error: true };

        return this.ctrl.buscar({
            slug,
            chaveAcesso: chave_acesso,
            versaoTermo: String(versao_termo),
            aceitaMarketing: aceita_marketing === "S" || aceita_marketing === "true",
            chaveAparelho: chave_aparelho,
            tokenOrigem: token_origem,
            ip: ipDoPedido(req.headers as Record<string, unknown>, req.ip, config.confiarCloudflare),
            selfies: enviadas.map((arquivo) => ({ nome: arquivo.name, dados: arquivo.data })),
        });
    }
}
```

`apps/api/src/_PARTICIPANTE/busca/busca.http`:

```http
@vps = http://localhost:3002

### Buscar (REST Client: selecione uma selfie local)
POST {{vps}}/api/participante/busca
Content-Type: multipart/form-data; boundary=----limite

------limite
Content-Disposition: form-data; name="call"

buscar
------limite
Content-Disposition: form-data; name="slug"

corrida-da-serra-2026
------limite
Content-Disposition: form-data; name="versao_termo"

v1
------limite
Content-Disposition: form-data; name="aceita_marketing"

N
------limite
Content-Disposition: form-data; name="selfies"; filename="selfie.jpg"
Content-Type: image/jpeg

< ./selfie.jpg
------limite--
```

Em `apps/api/src/routes/participanteRoute.ts`:

```ts
import { Router } from "express";
import per from "../services/per";
import Busca from "../_PARTICIPANTE/busca/route.busca";

const router = Router();

router.post("/busca", (req, res, next) => per(req, res, next, Busca));

export default router;
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx --test apps/api/integracao/buscar.test.ts`
Expected: PASS (9 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/_PARTICIPANTE/busca apps/api/integracao/buscar.test.ts apps/api/src/routes/participanteRoute.ts
git commit -m "feat(api): _PARTICIPANTE/busca — selfie, consulta e agrupamento" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: `_PARTICIPANTE/resultado` — a página de fotos

**Files:**
- Create: `apps/api/src/_PARTICIPANTE/resultado/sql.resultado.ts`, `ctrl.resultado.ts`, `route.resultado.ts`, `i.resultado.ts`, `resultado.http`
- Test: `apps/api/integracao/resultado.test.ts`
- Modify: `apps/api/src/routes/participanteRoute.ts`

**Interfaces:**
- Consumes: `buscaPorToken` (Task 7), `urlDaFoto` (Task 1), `ErroTratado`
- Produces: classe `Resultado implements iRota` com:
  - `getResultado({ token })` → `{ evento: { nome, slug }, validade_ate: string | null, fotos: [{ id_foto, thumb, similaridade }] }`
  - `situacao({ token })` → `{ status, qtd_fotos }` (é o que a página consulta enquanto espera a verificação)
  - `gerarLinks({ token, ids })` → `{ links: [{ id_foto, url }] }`, somando em `busca.qtd_downloads`

Só busca `liberada` e dentro da validade entrega foto. `validade_resultado_dias` vem de `evento.config`; `null` significa "até o expurgo", e nesse caso não há corte por data.

- [ ] **Step 1: Escrever o teste**

`apps/api/integracao/resultado.test.ts`:

```ts
import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import express from "express";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { iniciarConfig } from "../src/services/config";
import per from "../src/services/per";
import Resultado from "../src/_PARTICIPANTE/resultado/route.resultado";

let servidor: Server;
let base: string;
let conexao: ConexaoPostgres;
let idEvento: number;
let tokenLiberado: string;
let tokenAguardando: string;
let idFoto: number;

before(async () => {
    iniciarConfig({
        PAPEL: "vps",
        POSTGRES_HOST: "127.0.0.1",
        POSTGRES_PORT: "5433",
        POSTGRES_USER: "fotos",
        POSTGRES_PASSWORD: "fotos",
        POSTGRES_DB: "fotos_vps",
        REDIS_URL: "redis://127.0.0.1:6380",
        ESTACAO_CHAVE: "a".repeat(32),
        ARQUIVO_SEGREDO: "segredo-de-teste",
        OPERADOR_SEGREDO: "a".repeat(32),
        VISION_URL: "http://127.0.0.1:1",
    });

    conexao = new ConexaoPostgres();
    await conexao.open();
    const [evento] = await conexao.queryParam<{ id_evento: number }>(
        `INSERT INTO evento (nome, slug, tipo, privado, chave_anfitriao, data_fim, config)
         VALUES ('Resultado', ?, 'esportivo', 'N', ?, '2026-12-31', '{"validade_resultado_dias":7}') RETURNING id_evento`,
        [`evento-resultado-${Date.now()}`, `anfitriao-res-${Date.now()}`]
    );
    idEvento = evento.id_evento;

    const [foto] = await conexao.queryParam<{ id_foto: number }>(
        `INSERT INTO foto (id_evento, hash_arquivo, largura, altura, bytes_web, qtd_rostos, situacao)
         VALUES (?, ?, 100, 100, 10, 1, 'visivel') RETURNING id_foto`,
        [idEvento, "d".repeat(64)]
    );
    idFoto = foto.id_foto;

    tokenLiberado = `tok-lib-${Date.now()}`;
    tokenAguardando = `tok-agu-${Date.now()}`;
    for (const [token, status] of [
        [tokenLiberado, "liberada"],
        [tokenAguardando, "aguardando"],
    ] as const) {
        const [busca] = await conexao.queryParam<{ id_busca: number }>(
            `INSERT INTO busca (id_evento, token, status, qtd_fotos, consentimento_em, versao_termo)
             VALUES (?, ?, ?, 1, now(), 'v1') RETURNING id_busca`,
            [idEvento, token, status]
        );
        await conexao.executeParamCount(
            "INSERT INTO busca_foto (id_busca, id_foto, id_rosto, similaridade) VALUES (?, ?, NULL, 0.8)",
            [busca.id_busca, idFoto]
        );
    }

    const app = express();
    app.use(express.json());
    app.post("/resultado", (req, res, next) => per(req, res, next, Resultado));
    servidor = app.listen(0);
    await new Promise((resolve) => servidor.once("listening", resolve));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

async function chamar(corpo: object) {
    const resposta = await fetch(`${base}/resultado`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
    });
    return { status: resposta.status, corpo: (await resposta.json()) as Record<string, unknown> };
}

describe("getResultado", () => {
    test("busca liberada devolve as fotos com thumb assinado", async () => {
        const r = await chamar({ call: "getResultado", token: tokenLiberado });

        assert.strictEqual(r.status, 200);
        const fotos = r.corpo.fotos as { id_foto: number; thumb: string }[];
        assert.strictEqual(fotos.length, 1);
        assert.match(fotos[0].thumb, /_thumb\.jpg\?md5=.+&expires=\d+$/);
    });

    test("busca aguardando não entrega foto nenhuma", async () => {
        const r = await chamar({ call: "getResultado", token: tokenAguardando });

        assert.strictEqual(r.status, 422);
        assert.ok(!JSON.stringify(r.corpo).includes("_thumb.jpg"));
    });

    test("token inexistente é recusado com a mesma mensagem", async () => {
        const r = await chamar({ call: "getResultado", token: "nao-existe" });
        assert.strictEqual(r.status, 422);
    });

    test("foto oculta depois da busca some do resultado", async () => {
        await conexao.executeParamCount("UPDATE foto SET situacao = 'oculta' WHERE id_foto = ?", [idFoto]);
        try {
            const r = await chamar({ call: "getResultado", token: tokenLiberado });
            assert.strictEqual((r.corpo.fotos as unknown[]).length, 0);
        } finally {
            await conexao.executeParamCount("UPDATE foto SET situacao = 'visivel' WHERE id_foto = ?", [idFoto]);
        }
    });

    test("resultado fora da validade é recusado", async () => {
        await conexao.executeParamCount("UPDATE busca SET criado_em = now() - interval '30 days' WHERE token = ?", [tokenLiberado]);
        try {
            const r = await chamar({ call: "getResultado", token: tokenLiberado });
            assert.strictEqual(r.status, 422);
            assert.match(String(r.corpo.msg), /expir|venc/i);
        } finally {
            await conexao.executeParamCount("UPDATE busca SET criado_em = now() WHERE token = ?", [tokenLiberado]);
        }
    });
});

describe("situacao", () => {
    test("devolve o status sem expor foto", async () => {
        const r = await chamar({ call: "situacao", token: tokenAguardando });

        assert.strictEqual(r.status, 200);
        assert.strictEqual(r.corpo.status, "aguardando");
        assert.ok(!JSON.stringify(r.corpo).includes("arquivos/"));
    });
});

describe("gerarLinks", () => {
    test("devolve link de download e soma no contador", async () => {
        const r = await chamar({ call: "gerarLinks", token: tokenLiberado, ids: [idFoto] });

        const links = r.corpo.links as { id_foto: number; url: string }[];
        assert.strictEqual(links.length, 1);
        assert.match(links[0].url, /_web\.jpg\?md5=.+&expires=\d+&dl=1$/);

        const [busca] = await conexao.queryParam<{ qtd_downloads: number }>("SELECT qtd_downloads FROM busca WHERE token = ?", [tokenLiberado]);
        assert.strictEqual(busca.qtd_downloads, 1);
    });

    test("não gera link para foto que não é da busca", async () => {
        const [outra] = await conexao.queryParam<{ id_foto: number }>(
            `INSERT INTO foto (id_evento, hash_arquivo, largura, altura, bytes_web, qtd_rostos, situacao)
             VALUES (?, ?, 100, 100, 10, 1, 'visivel') RETURNING id_foto`,
            [idEvento, "e".repeat(64)]
        );

        const r = await chamar({ call: "gerarLinks", token: tokenLiberado, ids: [outra.id_foto] });
        assert.deepStrictEqual(r.corpo.links, []);
    });
});

after(async () => {
    servidor?.close();
    await conexao?.close();
    await fecharBanco();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx --test apps/api/integracao/resultado.test.ts`
Expected: FAIL — `Cannot find module '../src/_PARTICIPANTE/resultado/route.resultado'`.

- [ ] **Step 3: Implementar**

`apps/api/src/_PARTICIPANTE/resultado/i.resultado.ts`:

```ts
export interface FotoDoResultado {
    id_foto: number;
    thumb: string;
    similaridade: number;
}

export interface RespostaResultado {
    evento: { nome: string; slug: string };
    validade_ate: string | null;
    fotos: FotoDoResultado[];
}
```

`apps/api/src/_PARTICIPANTE/resultado/sql.resultado.ts`:

```ts
import ConexaoPostgres from "../../db/conexaoPostgres";

export interface LinhaBuscaResultado {
    id_busca: number;
    id_evento: number;
    status: string;
    criado_em: string;
    nome: string;
    slug: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config: any;
}

export async function buscaComEvento(conexao: ConexaoPostgres, token: string): Promise<LinhaBuscaResultado | undefined> {
    return conexao.queryOneParam<LinhaBuscaResultado>(
        `SELECT b.id_busca, b.id_evento, b.status, b.criado_em, e.nome, e.slug, e.config
           FROM busca b JOIN evento e ON e.id_evento = b.id_evento
          WHERE b.token = ?`,
        [token]
    );
}

// Só fotos que continuam visíveis: a moderação pode ter ocultado alguma depois da busca.
export async function fotosDaBusca(conexao: ConexaoPostgres, idBusca: number): Promise<{ id_foto: number; hash_arquivo: string; similaridade: number }[]> {
    return conexao.queryParam(
        `SELECT f.id_foto, f.hash_arquivo, bf.similaridade
           FROM busca_foto bf JOIN foto f ON f.id_foto = bf.id_foto
          WHERE bf.id_busca = ? AND f.situacao = 'visivel'
          ORDER BY bf.similaridade DESC, f.id_foto ASC`,
        [idBusca]
    );
}

export async function fotosDaBuscaPorIds(
    conexao: ConexaoPostgres,
    idBusca: number,
    ids: number[]
): Promise<{ id_foto: number; hash_arquivo: string }[]> {
    if (ids.length === 0) return [];
    return conexao.queryParam(
        `SELECT f.id_foto, f.hash_arquivo
           FROM busca_foto bf JOIN foto f ON f.id_foto = bf.id_foto
          WHERE bf.id_busca = ? AND f.situacao = 'visivel' AND f.id_foto = ANY(?::int[])`,
        [idBusca, `{${ids.join(",")}}`]
    );
}

export async function somarDownloads(conexao: ConexaoPostgres, idBusca: number, quantos: number): Promise<void> {
    await conexao.executeParamCount("UPDATE busca SET qtd_downloads = qtd_downloads + ? WHERE id_busca = ?", [quantos, idBusca]);
}
```

`apps/api/src/_PARTICIPANTE/resultado/ctrl.resultado.ts`:

```ts
import ConexaoPostgres from "../../db/conexaoPostgres";
import { ErroTratado } from "../../services/erro";
import { urlDaFoto } from "../../services/linkArquivo";
import { RespostaResultado } from "./i.resultado";
import { buscaComEvento, fotosDaBusca, fotosDaBuscaPorIds, somarDownloads, LinhaBuscaResultado } from "./sql.resultado";

export default class ResultadoCtrl {
    constructor(private conexao: ConexaoPostgres) {}

    async situacao(token: string): Promise<{ status: string; qtd_fotos: number }> {
        const busca = await this.conexao.queryOneParam<{ status: string; qtd_fotos: number }>(
            "SELECT status, qtd_fotos FROM busca WHERE token = ?",
            [token]
        );
        if (!busca) throw new ErroTratado("Não encontramos esta busca.");
        return busca;
    }

    async getResultado(token: string): Promise<RespostaResultado> {
        const busca = await this.exigirLiberada(token);
        const fotos = await fotosDaBusca(this.conexao, busca.id_busca);

        return {
            evento: { nome: busca.nome, slug: busca.slug },
            validade_ate: this.validadeAte(busca),
            fotos: fotos.map((foto) => ({
                id_foto: foto.id_foto,
                thumb: urlDaFoto(busca.id_evento, foto.hash_arquivo, "thumb"),
                similaridade: Number(foto.similaridade),
            })),
        };
    }

    async gerarLinks(token: string, ids: number[]): Promise<{ links: { id_foto: number; url: string }[] }> {
        const busca = await this.exigirLiberada(token);
        const fotos = await fotosDaBuscaPorIds(this.conexao, busca.id_busca, ids);
        if (fotos.length > 0) await somarDownloads(this.conexao, busca.id_busca, fotos.length);

        return {
            links: fotos.map((foto) => ({
                id_foto: foto.id_foto,
                // `dl=1` faz o nginx mandar Content-Disposition: attachment.
                url: `${urlDaFoto(busca.id_evento, foto.hash_arquivo, "web")}&dl=1`,
            })),
        };
    }

    private async exigirLiberada(token: string): Promise<LinhaBuscaResultado> {
        const busca = await buscaComEvento(this.conexao, token);
        // Mesma mensagem para token inexistente e busca não liberada: não conta a quem pergunta
        // se aquele token existe.
        if (!busca || busca.status !== "liberada") throw new ErroTratado("Não encontramos suas fotos. Faça a busca de novo.");

        const validade = this.validadeAte(busca);
        if (validade && new Date(validade).getTime() < Date.now())
            throw new ErroTratado("O prazo para baixar estas fotos venceu. Faça a busca de novo.");

        return busca;
    }

    // `null` em validade_resultado_dias significa "até o expurgo": sem corte por data aqui.
    private validadeAte(busca: LinhaBuscaResultado): string | null {
        const dias = busca.config?.validade_resultado_dias;
        if (dias === null || dias === undefined) return null;
        return new Date(new Date(busca.criado_em).getTime() + Number(dias) * 86_400_000).toISOString();
    }
}
```

`apps/api/src/_PARTICIPANTE/resultado/route.resultado.ts`:

```ts
import { Request } from "express";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { iContexto, iRota } from "../../services/per";
import ResultadoCtrl from "./ctrl.resultado";

export default class Resultado implements iRota {
    conexao = new ConexaoPostgres();
    private ctrl!: ResultadoCtrl;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(private contexto: iContexto) {}

    async init(): Promise<void> {
        await this.conexao.open();
        this.ctrl = new ResultadoCtrl(this.conexao);
    }

    async getResultado(req: Request) {
        if (!req.body.token) return { msg: "Token obrigatório", error: true };
        return this.ctrl.getResultado(String(req.body.token));
    }

    async situacao(req: Request) {
        if (!req.body.token) return { msg: "Token obrigatório", error: true };
        return this.ctrl.situacao(String(req.body.token));
    }

    async gerarLinks(req: Request) {
        if (!req.body.token) return { msg: "Token obrigatório", error: true };
        const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
        if (ids.length === 0) return { msg: "Escolha ao menos uma foto", error: true };
        return this.ctrl.gerarLinks(String(req.body.token), ids);
    }
}
```

`apps/api/src/_PARTICIPANTE/resultado/resultado.http`:

```http
@vps = http://localhost:3002
@token = COLE_O_TOKEN_DA_BUSCA_AQUI

### Resultado
POST {{vps}}/api/participante/resultado
Content-Type: application/json

{ "call": "getResultado", "token": "{{token}}" }

### Situação (a página consulta a cada 3s enquanto aguarda)
POST {{vps}}/api/participante/resultado
Content-Type: application/json

{ "call": "situacao", "token": "{{token}}" }

### Links de download
POST {{vps}}/api/participante/resultado
Content-Type: application/json

{ "call": "gerarLinks", "token": "{{token}}", "ids": [1, 2] }
```

Em `apps/api/src/routes/participanteRoute.ts`, acrescente:

```ts
import Resultado from "../_PARTICIPANTE/resultado/route.resultado";
// ...
router.post("/resultado", (req, res, next) => per(req, res, next, Resultado));
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx --test apps/api/integracao/resultado.test.ts`
Expected: PASS (8 testes).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/_PARTICIPANTE/resultado apps/api/integracao/resultado.test.ts apps/api/src/routes/participanteRoute.ts
git commit -m "feat(api): _PARTICIPANTE/resultado — fotos, situação e links" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: ZIP das fotos

**Files:**
- Create: `apps/api/src/jobs/zip.ts`
- Test: `apps/api/integracao/jobZip.test.ts`
- Modify: `apps/api/src/_PARTICIPANTE/resultado/ctrl.resultado.ts`, `route.resultado.ts`, `sql.resultado.ts`, `apps/api/src/worker.ts`, `apps/api/src/services/config.ts` (`RAIZ_ZIPS`), `apps/api/package.json` (`archiver`), `.env.vps.example`, `docker-compose.dev.yml`, `docker-compose.vps.yml`

**Interfaces:**
- Consumes: `criarFila`/`criarWorker` (fase 3), `config.raizFotos`, `urlDoZip` (Task 1)
- Produces:
  - `NOME_FILA = "zip"`, `interface DadosZip { id_arquivo_zip: number }`, `processarZip(dados: DadosZip): Promise<void>`, `iniciarWorkerZip(concorrencia?: number): void`
  - `ResultadoCtrl.pedirZip(token)` → `{ id_arquivo_zip, status }`; `ResultadoCtrl.situacaoZip(token, id)` → `{ status, url? }`
  - `config.raizZips: string` (padrão `/data/zips`)

O ZIP entra em modo *store* (`zlib: { level: 0 }`): as fotos já são JPEG, recomprimir só gasta CPU. Partes de até 500 fotos, como o spec pede.

- [ ] **Step 1: Escrever o teste**

`apps/api/integracao/jobZip.test.ts`:

```ts
import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { iniciarConfig, config } from "../src/services/config";
import { fecharFila } from "../src/services/fila";
import { processarZip } from "../src/jobs/zip";

const executar = promisify(execFile);
let conexao: ConexaoPostgres;
let idEvento: number;
let idBusca: number;

before(async () => {
    const raizFotos = await fs.mkdtemp(path.join(os.tmpdir(), "zip-fotos-"));
    const raizZips = await fs.mkdtemp(path.join(os.tmpdir(), "zip-saida-"));

    iniciarConfig({
        PAPEL: "vps",
        POSTGRES_HOST: "127.0.0.1",
        POSTGRES_PORT: "5433",
        POSTGRES_USER: "fotos",
        POSTGRES_PASSWORD: "fotos",
        POSTGRES_DB: "fotos_vps",
        REDIS_URL: "redis://127.0.0.1:6380",
        ESTACAO_CHAVE: "a".repeat(32),
        ARQUIVO_SEGREDO: "segredo-de-teste",
        OPERADOR_SEGREDO: "a".repeat(32),
        VISION_URL: "http://127.0.0.1:1",
        RAIZ_FOTOS: raizFotos,
        RAIZ_ZIPS: raizZips,
    });

    conexao = new ConexaoPostgres();
    await conexao.open();
    const [evento] = await conexao.queryParam<{ id_evento: number }>(
        `INSERT INTO evento (nome, slug, tipo, privado, chave_anfitriao, data_fim, config)
         VALUES ('Zip', ?, 'esportivo', 'N', ?, '2026-12-31', '{}') RETURNING id_evento`,
        [`evento-zip-${Date.now()}`, `anfitriao-zip-${Date.now()}`]
    );
    idEvento = evento.id_evento;

    await fs.mkdir(path.join(config.raizFotos, String(idEvento)), { recursive: true });
    const [busca] = await conexao.queryParam<{ id_busca: number }>(
        `INSERT INTO busca (id_evento, token, status, qtd_fotos, consentimento_em, versao_termo)
         VALUES (?, ?, 'liberada', 2, now(), 'v1') RETURNING id_busca`,
        [idEvento, `tok-zip-${Date.now()}`]
    );
    idBusca = busca.id_busca;

    for (const letra of ["f", "0"]) {
        const hash = letra.repeat(64);
        await fs.writeFile(path.join(config.raizFotos, String(idEvento), `${hash}_web.jpg`), `foto-${letra}`);
        const [foto] = await conexao.queryParam<{ id_foto: number }>(
            `INSERT INTO foto (id_evento, hash_arquivo, largura, altura, bytes_web, qtd_rostos, situacao)
             VALUES (?, ?, 100, 100, 10, 1, 'visivel') RETURNING id_foto`,
            [idEvento, hash]
        );
        await conexao.executeParamCount(
            "INSERT INTO busca_foto (id_busca, id_foto, id_rosto, similaridade) VALUES (?, ?, NULL, 0.9)",
            [idBusca, foto.id_foto]
        );
    }
});

describe("processarZip", () => {
    test("monta o arquivo com as fotos da busca e marca pronto", async () => {
        const [zip] = await conexao.queryParam<{ id_arquivo_zip: number }>(
            `INSERT INTO arquivo_zip (id_evento, id_busca, parte, status, expira_em)
             VALUES (?, ?, 1, 'pendente', now() + interval '7 days') RETURNING id_arquivo_zip`,
            [idEvento, idBusca]
        );

        await processarZip({ id_arquivo_zip: zip.id_arquivo_zip });

        const [depois] = await conexao.queryParam<{ status: string; qtd_fotos: number; bytes: string }>(
            "SELECT status, qtd_fotos, bytes FROM arquivo_zip WHERE id_arquivo_zip = ?",
            [zip.id_arquivo_zip]
        );
        assert.strictEqual(depois.status, "pronto");
        assert.strictEqual(depois.qtd_fotos, 2);
        assert.ok(Number(depois.bytes) > 0);

        const caminho = path.join(config.raizZips, String(idEvento), `${zip.id_arquivo_zip}.zip`);
        const { stdout } = await executar("unzip", ["-l", caminho]);
        assert.match(stdout, /_web\.jpg/);
    });

    test("ZIP de busca sem foto visível fica pronto e vazio, sem quebrar", async () => {
        const [buscaVazia] = await conexao.queryParam<{ id_busca: number }>(
            `INSERT INTO busca (id_evento, token, status, qtd_fotos, consentimento_em, versao_termo)
             VALUES (?, ?, 'liberada', 0, now(), 'v1') RETURNING id_busca`,
            [idEvento, `tok-zip-vazio-${Date.now()}`]
        );
        const [zip] = await conexao.queryParam<{ id_arquivo_zip: number }>(
            `INSERT INTO arquivo_zip (id_evento, id_busca, parte, status, expira_em)
             VALUES (?, ?, 1, 'pendente', now() + interval '7 days') RETURNING id_arquivo_zip`,
            [idEvento, buscaVazia.id_busca]
        );

        await processarZip({ id_arquivo_zip: zip.id_arquivo_zip });

        const [depois] = await conexao.queryParam<{ status: string; qtd_fotos: number }>(
            "SELECT status, qtd_fotos FROM arquivo_zip WHERE id_arquivo_zip = ?",
            [zip.id_arquivo_zip]
        );
        assert.strictEqual(depois.status, "pronto");
        assert.strictEqual(depois.qtd_fotos, 0);
    });

    test("arquivo de foto sumido não derruba o ZIP: entra o que existe", async () => {
        const hashSumido = "9".repeat(64);
        const [foto] = await conexao.queryParam<{ id_foto: number }>(
            `INSERT INTO foto (id_evento, hash_arquivo, largura, altura, bytes_web, qtd_rostos, situacao)
             VALUES (?, ?, 100, 100, 10, 1, 'visivel') RETURNING id_foto`,
            [idEvento, hashSumido]
        );
        await conexao.executeParamCount(
            "INSERT INTO busca_foto (id_busca, id_foto, id_rosto, similaridade) VALUES (?, ?, NULL, 0.9)",
            [idBusca, foto.id_foto]
        );
        const [zip] = await conexao.queryParam<{ id_arquivo_zip: number }>(
            `INSERT INTO arquivo_zip (id_evento, id_busca, parte, status, expira_em)
             VALUES (?, ?, 1, 'pendente', now() + interval '7 days') RETURNING id_arquivo_zip`,
            [idEvento, idBusca]
        );

        await processarZip({ id_arquivo_zip: zip.id_arquivo_zip });

        const [depois] = await conexao.queryParam<{ status: string; qtd_fotos: number }>(
            "SELECT status, qtd_fotos FROM arquivo_zip WHERE id_arquivo_zip = ?",
            [zip.id_arquivo_zip]
        );
        assert.strictEqual(depois.status, "pronto");
        assert.strictEqual(depois.qtd_fotos, 2, "só as duas que existem em disco");
    });
});

after(async () => {
    await conexao?.close();
    await fecharFila();
    await fecharBanco();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx --test apps/api/integracao/jobZip.test.ts`
Expected: FAIL — `Cannot find module '../src/jobs/zip'`.

- [ ] **Step 3: Implementar**

Em `apps/api/package.json`, acrescente `"archiver": "^7.0.1"` em `dependencies` e `"@types/archiver": "^6.0.2"` em `devDependencies`; rode `npm install` na raiz.

`apps/api/src/jobs/zip.ts`:

```ts
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { Job } from "bullmq";
import archiver from "archiver";
import ConexaoPostgres from "../db/conexaoPostgres";
import { config } from "../services/config";
import { criarWorker } from "../services/fila";

export const NOME_FILA = "zip";
export const FOTOS_POR_PARTE = 500;

export interface DadosZip {
    id_arquivo_zip: number;
}

interface LinhaZip {
    id_arquivo_zip: number;
    id_evento: number;
    id_busca: number | null;
    parte: number;
}

export async function processarZip(dados: DadosZip): Promise<void> {
    const conexao = new ConexaoPostgres();
    await conexao.open();
    try {
        const zip = await conexao.queryOneParam<LinhaZip>(
            "SELECT id_arquivo_zip, id_evento, id_busca, parte FROM arquivo_zip WHERE id_arquivo_zip = ?",
            [dados.id_arquivo_zip]
        );
        if (!zip) throw new Error(`[Zip] arquivo_zip ${dados.id_arquivo_zip} não existe`);

        const fotos = await conexao.queryParam<{ hash_arquivo: string }>(
            `SELECT f.hash_arquivo
               FROM busca_foto bf JOIN foto f ON f.id_foto = bf.id_foto
              WHERE bf.id_busca = ? AND f.situacao = 'visivel'
              ORDER BY f.id_foto
              LIMIT ? OFFSET ?`,
            [zip.id_busca, FOTOS_POR_PARTE, (zip.parte - 1) * FOTOS_POR_PARTE]
        );

        const pasta = path.join(config.raizZips, String(zip.id_evento));
        await fsp.mkdir(pasta, { recursive: true });
        const destino = path.join(pasta, `${zip.id_arquivo_zip}.zip`);

        const incluidas = await montarZip(destino, zip.id_evento, fotos.map((f) => f.hash_arquivo));
        const info = await fsp.stat(destino);

        await conexao.executeParamCount("UPDATE arquivo_zip SET status = 'pronto', qtd_fotos = ?, bytes = ? WHERE id_arquivo_zip = ?", [
            incluidas,
            info.size,
            zip.id_arquivo_zip,
        ]);
    } catch (erro) {
        await conexao
            .executeParamCount("UPDATE arquivo_zip SET status = 'erro' WHERE id_arquivo_zip = ?", [dados.id_arquivo_zip])
            .catch(() => {});
        throw erro;
    } finally {
        await conexao.close();
    }
}

// Modo store (level 0): JPEG já está comprimido, recomprimir só gastaria CPU.
async function montarZip(destino: string, idEvento: number, hashes: string[]): Promise<number> {
    const saida = fs.createWriteStream(destino);
    const arquivo = archiver("zip", { zlib: { level: 0 } });
    let incluidas = 0;

    const terminou = new Promise<void>((resolve, reject) => {
        saida.on("close", () => resolve());
        arquivo.on("error", reject);
        saida.on("error", reject);
    });

    arquivo.pipe(saida);
    for (const hash of hashes) {
        const caminho = path.join(config.raizFotos, String(idEvento), `${hash}_web.jpg`);
        try {
            await fsp.access(caminho);
        } catch {
            // Foto excluída entre o pedido e a montagem: o ZIP leva o resto.
            console.error(`[Zip] arquivo ausente, pulando: ${hash}`);
            continue;
        }
        arquivo.file(caminho, { name: `${hash}_web.jpg` });
        incluidas++;
    }
    await arquivo.finalize();
    await terminou;
    return incluidas;
}

export function iniciarWorkerZip(concorrencia = 2): void {
    criarWorker<DadosZip>(NOME_FILA, (job: Job<DadosZip>) => processarZip(job.data), concorrencia);
}
```

Em `apps/api/src/services/config.ts`, acrescente `raizZips: string;` ao `iConfig` e `raizZips: env.RAIZ_ZIPS || "/data/zips",` ao retorno.

Em `apps/api/src/_PARTICIPANTE/resultado/sql.resultado.ts`, acrescente:

```ts
export async function criarArquivoZip(conexao: ConexaoPostgres, idEvento: number, idBusca: number): Promise<number> {
    const [linha] = await conexao.queryParam<{ id_arquivo_zip: number }>(
        `INSERT INTO arquivo_zip (id_evento, id_busca, parte, status, expira_em)
         VALUES (?, ?, 1, 'pendente', now() + interval '7 days') RETURNING id_arquivo_zip`,
        [idEvento, idBusca]
    );
    return linha.id_arquivo_zip;
}

export async function zipDaBusca(
    conexao: ConexaoPostgres,
    idBusca: number,
    idArquivoZip: number
): Promise<{ id_arquivo_zip: number; id_evento: number; status: string } | undefined> {
    return conexao.queryOneParam("SELECT id_arquivo_zip, id_evento, status FROM arquivo_zip WHERE id_arquivo_zip = ? AND id_busca = ?", [
        idArquivoZip,
        idBusca,
    ]);
}
```

Em `apps/api/src/_PARTICIPANTE/resultado/ctrl.resultado.ts`, acrescente os dois métodos (e os imports de `criarFila`, `urlDoZip`, `criarArquivoZip`, `zipDaBusca`, `NOME_FILA as FILA_ZIP`):

```ts
    async pedirZip(token: string): Promise<{ id_arquivo_zip: number; status: string }> {
        const busca = await this.exigirLiberada(token);
        const idArquivoZip = await criarArquivoZip(this.conexao, busca.id_evento, busca.id_busca);
        await criarFila<{ id_arquivo_zip: number }>(FILA_ZIP).add(FILA_ZIP, { id_arquivo_zip: idArquivoZip }, { attempts: 3 });
        return { id_arquivo_zip: idArquivoZip, status: "pendente" };
    }

    async situacaoZip(token: string, idArquivoZip: number): Promise<{ status: string; url?: string }> {
        const busca = await this.exigirLiberada(token);
        const zip = await zipDaBusca(this.conexao, busca.id_busca, idArquivoZip);
        if (!zip) throw new ErroTratado("Não encontramos este arquivo.");
        return zip.status === "pronto" ? { status: zip.status, url: urlDoZip(zip.id_evento, zip.id_arquivo_zip) } : { status: zip.status };
    }
```

E em `route.resultado.ts`:

```ts
    async pedirZip(req: Request) {
        if (!req.body.token) return { msg: "Token obrigatório", error: true };
        return this.ctrl.pedirZip(String(req.body.token));
    }

    async situacaoZip(req: Request) {
        if (!req.body.token || !req.body.id_arquivo_zip) return { msg: "Token e id_arquivo_zip obrigatórios", error: true };
        return this.ctrl.situacaoZip(String(req.body.token), Number(req.body.id_arquivo_zip));
    }
```

Em `apps/api/src/worker.ts`, o papel `vps` deixa de ser um beco sem saída:

```ts
    if (config.papel !== "estacao") {
        iniciarWorkerZip();
        console.log(`[Worker] papel vps | fila zip`);
        return;
    }
```

(importando `iniciarWorkerZip` de `./jobs/zip`; mantenha o resto do arquivo como está.)

Em `.env.vps.example`, acrescente `RAIZ_ZIPS=/data/zips`. No `docker-compose.vps.yml`, o serviço `api` e um novo serviço `worker` (mesma imagem, `command: ["node", "dist/worker.js"]`, `healthcheck: { disable: true }`) montam `zips:/data/zips`; o serviço `arquivos` já monta `zips:/data/zips:ro` (Task 2). No `docker-compose.dev.yml`, o `api-vps` ganha `zips-vps:/data/zips` e um serviço `worker-vps` análogo.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx --test apps/api/integracao/jobZip.test.ts`
Expected: PASS (3 testes). O teste usa o `unzip` da máquina para conferir o conteúdo; se não existir, instale (`apt-get install -y unzip`) ou troque por uma leitura do cabeçalho `PK`.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/jobs/zip.ts apps/api/integracao/jobZip.test.ts apps/api/src/_PARTICIPANTE/resultado \
        apps/api/src/worker.ts apps/api/src/services/config.ts apps/api/package.json package-lock.json \
        .env.vps.example docker-compose.dev.yml docker-compose.vps.yml
git commit -m "feat(api): ZIP das fotos da busca" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: `_ANFITRIAO/galeria`

**Files:**
- Create: `apps/api/src/_ANFITRIAO/galeria/sql.galeria.ts`, `ctrl.galeria.ts`, `route.galeria.ts`, `galeria.http`
- Test: `apps/api/integracao/galeria.test.ts`
- Modify: `apps/api/src/routes/anfitriaoRoute.ts`

**Interfaces:**
- Consumes: `urlDaFoto` (Task 1), `criarArquivoZip` (Task 10), `criarFila` + `NOME_FILA` do zip (Task 10), `ErroTratado`
- Produces: classe `Galeria implements iRota` com `getGaleria({ chave, offset, id_evento_fotografo? })` e `pedirZip({ chave, id_evento_fotografo? })`

A `chave_anfitriao` é a credencial: quem tem o link vê a galeria inteira do evento (fotos visíveis), sem selfie e sem verificação.

- [ ] **Step 1: Escrever o teste**

`apps/api/integracao/galeria.test.ts`:

```ts
import { test, before, after, describe } from "node:test";
import assert from "node:assert";
import express from "express";
import { Server } from "node:http";
import { AddressInfo } from "node:net";
import ConexaoPostgres, { fecharBanco } from "../src/db/conexaoPostgres";
import { iniciarConfig } from "../src/services/config";
import { fecharFila } from "../src/services/fila";
import per from "../src/services/per";
import Galeria from "../src/_ANFITRIAO/galeria/route.galeria";

let servidor: Server;
let base: string;
let conexao: ConexaoPostgres;
let chaveAnfitriao: string;
let idEvento: number;

before(async () => {
    iniciarConfig({
        PAPEL: "vps",
        POSTGRES_HOST: "127.0.0.1",
        POSTGRES_PORT: "5433",
        POSTGRES_USER: "fotos",
        POSTGRES_PASSWORD: "fotos",
        POSTGRES_DB: "fotos_vps",
        REDIS_URL: "redis://127.0.0.1:6380",
        ESTACAO_CHAVE: "a".repeat(32),
        ARQUIVO_SEGREDO: "segredo-de-teste",
        OPERADOR_SEGREDO: "a".repeat(32),
        VISION_URL: "http://127.0.0.1:1",
    });

    conexao = new ConexaoPostgres();
    await conexao.open();
    chaveAnfitriao = `anfitriao-gal-${Date.now()}`;
    const [evento] = await conexao.queryParam<{ id_evento: number }>(
        `INSERT INTO evento (nome, slug, tipo, privado, chave_anfitriao, data_fim, config)
         VALUES ('Galeria', ?, 'social', 'N', ?, '2026-12-31', '{}') RETURNING id_evento`,
        [`evento-galeria-${Date.now()}`, chaveAnfitriao]
    );
    idEvento = evento.id_evento;

    for (const [i, situacao] of [["1", "visivel"], ["2", "visivel"], ["3", "oculta"]] as const) {
        await conexao.executeParamCount(
            `INSERT INTO foto (id_evento, hash_arquivo, largura, altura, bytes_web, qtd_rostos, situacao, capturada_em)
             VALUES (?, ?, 100, 100, 10, 1, ?, now() - (? || ' minutes')::interval)`,
            [idEvento, `${i.repeat(63)}a`, situacao, i]
        );
    }

    const app = express();
    app.use(express.json());
    app.post("/galeria", (req, res, next) => per(req, res, next, Galeria));
    servidor = app.listen(0);
    await new Promise((resolve) => servidor.once("listening", resolve));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
});

async function chamar(corpo: object) {
    const resposta = await fetch(`${base}/galeria`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
    });
    return { status: resposta.status, corpo: (await resposta.json()) as Record<string, unknown> };
}

describe("getGaleria", () => {
    test("devolve as fotos visíveis com thumb assinado", async () => {
        const r = await chamar({ call: "getGaleria", chave: chaveAnfitriao, offset: 0 });

        const fotos = r.corpo.fotos as { thumb: string }[];
        assert.strictEqual(fotos.length, 2, "a foto oculta não entra");
        assert.match(fotos[0].thumb, /_thumb\.jpg\?md5=/);
        assert.strictEqual(r.corpo.evento, "Galeria");
    });

    test("chave errada não abre a galeria", async () => {
        const r = await chamar({ call: "getGaleria", chave: "chave-que-nao-existe", offset: 0 });
        assert.strictEqual(r.status, 422);
    });

    test("offset além do fim devolve lista vazia, não erro", async () => {
        const r = await chamar({ call: "getGaleria", chave: chaveAnfitriao, offset: 500 });
        assert.deepStrictEqual(r.corpo.fotos, []);
    });
});

describe("pedirZip", () => {
    test("cria o arquivo pendente para o evento inteiro", async () => {
        const r = await chamar({ call: "pedirZip", chave: chaveAnfitriao });

        assert.strictEqual(r.corpo.status, "pendente");
        const partes = r.corpo.partes as number[];
        assert.strictEqual(partes.length, 1, "2 fotos visíveis cabem numa parte só");

        const [zip] = await conexao.queryParam<{ id_evento: number; id_busca: number | null; parte: number }>(
            "SELECT id_evento, id_busca, parte FROM arquivo_zip WHERE id_arquivo_zip = ?",
            [partes[0]]
        );
        assert.strictEqual(zip.id_evento, idEvento);
        assert.strictEqual(zip.parte, 1);
        assert.strictEqual(zip.id_busca, null, "ZIP do anfitrião não pertence a uma busca");
    });

    test("evento com mais de 500 fotos vira várias partes", async () => {
        // Sem partes, tudo acima da 500ª foto ficaria de fora do ZIP e ninguém perceberia.
        const [grande] = await conexao.queryParam<{ id_evento: number; chave_anfitriao: string }>(
            `INSERT INTO evento (nome, slug, tipo, privado, chave_anfitriao, data_fim, config)
             VALUES ('Grande', ?, 'social', 'N', ?, '2026-12-31', '{}') RETURNING id_evento, chave_anfitriao`,
            [`evento-grande-${Date.now()}`, `anfitriao-grande-${Date.now()}`]
        );
        // 501 linhas de foto, sem arquivo em disco: aqui só interessa a contagem das partes.
        await conexao.executeParamCount(
            `INSERT INTO foto (id_evento, hash_arquivo, largura, altura, bytes_web, qtd_rostos, situacao)
             SELECT ?, lpad(g::text, 64, '0'), 100, 100, 10, 1, 'visivel' FROM generate_series(1, 501) g`,
            [grande.id_evento]
        );

        const r = await chamar({ call: "pedirZip", chave: grande.chave_anfitriao });
        assert.strictEqual((r.corpo.partes as number[]).length, 2);
    });
});

after(async () => {
    servidor?.close();
    await conexao?.close();
    await fecharFila();
    await fecharBanco();
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx tsx --test apps/api/integracao/galeria.test.ts`
Expected: FAIL — `Cannot find module '../src/_ANFITRIAO/galeria/route.galeria'`.

- [ ] **Step 3: Implementar**

`apps/api/src/_ANFITRIAO/galeria/sql.galeria.ts`:

```ts
import ConexaoPostgres from "../../db/conexaoPostgres";

export const FOTOS_POR_PAGINA = 60;

export interface LinhaEventoAnfitriao {
    id_evento: number;
    nome: string;
}

export async function eventoPorChaveAnfitriao(conexao: ConexaoPostgres, chave: string): Promise<LinhaEventoAnfitriao | undefined> {
    return conexao.queryOneParam<LinhaEventoAnfitriao>(
        "SELECT id_evento, nome FROM evento WHERE chave_anfitriao = ? AND deletado = 'N'",
        [chave]
    );
}

export async function fotosDoEvento(
    conexao: ConexaoPostgres,
    idEvento: number,
    offset: number,
    idEventoFotografo: number | null
): Promise<{ id_foto: number; hash_arquivo: string }[]> {
    if (idEventoFotografo !== null)
        return conexao.queryParam(
            `SELECT id_foto, hash_arquivo FROM foto
              WHERE id_evento = ? AND situacao = 'visivel' AND id_evento_fotografo = ?
              ORDER BY capturada_em ASC NULLS LAST, id_foto ASC LIMIT ? OFFSET ?`,
            [idEvento, idEventoFotografo, FOTOS_POR_PAGINA, offset]
        );
    return conexao.queryParam(
        `SELECT id_foto, hash_arquivo FROM foto
          WHERE id_evento = ? AND situacao = 'visivel'
          ORDER BY capturada_em ASC NULLS LAST, id_foto ASC LIMIT ? OFFSET ?`,
        [idEvento, FOTOS_POR_PAGINA, offset]
    );
}

export async function contarFotosVisiveis(conexao: ConexaoPostgres, idEvento: number): Promise<number> {
    const [linha] = await conexao.queryParam<{ total: number }>(
        "SELECT count(*)::int AS total FROM foto WHERE id_evento = ? AND situacao = 'visivel'",
        [idEvento]
    );
    return linha.total;
}

// Uma linha por parte: o spec limita o ZIP a 500 fotos, e um evento grande passa disso.
export async function criarZipsDoEvento(conexao: ConexaoPostgres, idEvento: number, partes: number): Promise<number[]> {
    const ids: number[] = [];
    for (let parte = 1; parte <= partes; parte++) {
        const [linha] = await conexao.queryParam<{ id_arquivo_zip: number }>(
            `INSERT INTO arquivo_zip (id_evento, id_busca, parte, status, expira_em)
             VALUES (?, NULL, ?, 'pendente', now() + interval '7 days') RETURNING id_arquivo_zip`,
            [idEvento, parte]
        );
        ids.push(linha.id_arquivo_zip);
    }
    return ids;
}
```

`apps/api/src/_ANFITRIAO/galeria/ctrl.galeria.ts`:

```ts
import ConexaoPostgres from "../../db/conexaoPostgres";
import { ErroTratado } from "../../services/erro";
import { urlDaFoto } from "../../services/linkArquivo";
import { criarFila } from "../../services/fila";
import { NOME_FILA as FILA_ZIP } from "../../jobs/zip";
import { contarFotosVisiveis, criarZipsDoEvento, eventoPorChaveAnfitriao, fotosDoEvento } from "./sql.galeria";
import { FOTOS_POR_PARTE } from "../../jobs/zip";

export default class GaleriaCtrl {
    constructor(private conexao: ConexaoPostgres) {}

    async getGaleria(chave: string, offset: number, idEventoFotografo: number | null) {
        const evento = await this.exigirEvento(chave);
        const fotos = await fotosDoEvento(this.conexao, evento.id_evento, offset, idEventoFotografo);

        return {
            evento: evento.nome,
            fotos: fotos.map((foto) => ({
                id_foto: foto.id_foto,
                thumb: urlDaFoto(evento.id_evento, foto.hash_arquivo, "thumb"),
                web: urlDaFoto(evento.id_evento, foto.hash_arquivo, "web"),
            })),
        };
    }

    async pedirZip(chave: string): Promise<{ partes: number[]; status: string }> {
        const evento = await this.exigirEvento(chave);
        const total = await contarFotosVisiveis(this.conexao, evento.id_evento);
        const partes = Math.max(1, Math.ceil(total / FOTOS_POR_PARTE));
        const ids = await criarZipsDoEvento(this.conexao, evento.id_evento, partes);

        const fila = criarFila<{ id_arquivo_zip: number }>(FILA_ZIP);
        for (const id of ids) await fila.add(FILA_ZIP, { id_arquivo_zip: id }, { attempts: 3 });

        return { partes: ids, status: "pendente" };
    }

    private async exigirEvento(chave: string) {
        const evento = await eventoPorChaveAnfitriao(this.conexao, chave);
        if (!evento) throw new ErroTratado("Galeria não encontrada. Confira o link.");
        return evento;
    }
}
```

`apps/api/src/_ANFITRIAO/galeria/route.galeria.ts`:

```ts
import { Request } from "express";
import ConexaoPostgres from "../../db/conexaoPostgres";
import { iContexto, iRota } from "../../services/per";
import GaleriaCtrl from "./ctrl.galeria";

export default class Galeria implements iRota {
    conexao = new ConexaoPostgres();
    private ctrl!: GaleriaCtrl;

    // A chave do anfitrião vai no corpo, como o link /#/a/<chave> entrega.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(private contexto: iContexto) {}

    async init(): Promise<void> {
        await this.conexao.open();
        this.ctrl = new GaleriaCtrl(this.conexao);
    }

    async getGaleria(req: Request) {
        if (!req.body.chave) return { msg: "Chave obrigatória", error: true };
        const offset = Number.isInteger(Number(req.body.offset)) ? Math.max(0, Number(req.body.offset)) : 0;
        const idEventoFotografo = req.body.id_evento_fotografo ? Number(req.body.id_evento_fotografo) : null;
        return this.ctrl.getGaleria(String(req.body.chave), offset, idEventoFotografo);
    }

    async pedirZip(req: Request) {
        if (!req.body.chave) return { msg: "Chave obrigatória", error: true };
        return this.ctrl.pedirZip(String(req.body.chave));
    }
}
```

`apps/api/src/_ANFITRIAO/galeria/galeria.http`:

```http
@vps = http://localhost:3002
@chave = COLE_A_CHAVE_DO_ANFITRIAO

### Galeria
POST {{vps}}/api/anfitriao/galeria
Content-Type: application/json

{ "call": "getGaleria", "chave": "{{chave}}", "offset": 0 }

### Pedir o ZIP do evento
POST {{vps}}/api/anfitriao/galeria
Content-Type: application/json

{ "call": "pedirZip", "chave": "{{chave}}" }
```

Em `apps/api/src/routes/anfitriaoRoute.ts`:

```ts
import { Router } from "express";
import per from "../services/per";
import Galeria from "../_ANFITRIAO/galeria/route.galeria";

const router = Router();

router.post("/galeria", (req, res, next) => per(req, res, next, Galeria));

export default router;
```

Nota: o `processarZip` da Task 10 monta o ZIP a partir de `busca_foto`. Para o ZIP do anfitrião (`id_busca` nulo), acrescente o caso em `apps/api/src/jobs/zip.ts` — quando `zip.id_busca` for `null`, as fotos vêm do evento:

```ts
        const fotos = zip.id_busca
            ? await conexao.queryParam<{ hash_arquivo: string }>(
                  `SELECT f.hash_arquivo
                     FROM busca_foto bf JOIN foto f ON f.id_foto = bf.id_foto
                    WHERE bf.id_busca = ? AND f.situacao = 'visivel'
                    ORDER BY f.id_foto
                    LIMIT ? OFFSET ?`,
                  [zip.id_busca, FOTOS_POR_PARTE, (zip.parte - 1) * FOTOS_POR_PARTE]
              )
            : await conexao.queryParam<{ hash_arquivo: string }>(
                  `SELECT hash_arquivo FROM foto
                    WHERE id_evento = ? AND situacao = 'visivel'
                    ORDER BY id_foto
                    LIMIT ? OFFSET ?`,
                  [zip.id_evento, FOTOS_POR_PARTE, (zip.parte - 1) * FOTOS_POR_PARTE]
              );
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx tsx --test apps/api/integracao/galeria.test.ts apps/api/integracao/jobZip.test.ts`
Expected: PASS nos dois arquivos.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/_ANFITRIAO apps/api/integracao/galeria.test.ts apps/api/src/routes/anfitriaoRoute.ts apps/api/src/jobs/zip.ts
git commit -m "feat(api): _ANFITRIAO/galeria" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Verificação ponta a ponta

**Files:**
- Create: `scripts/demo-busca.ts`
- Modify: `docs/desenvolvimento.md`

**Interfaces:**
- Consumes: tudo das tasks anteriores
- Produces: `npm run demo-busca -- --evento <slug> --selfie <arquivo>` — faz a busca de verdade contra a API que está no ar e imprime o que o participante veria

Sem teste automatizado: é a ferramenta que prova o caminho inteiro com a API, o vision e o nginx rodando, como o `benchmark-pipeline.ts` faz para a ingestão.

- [ ] **Step 1: Escrever o script**

`scripts/demo-busca.ts`:

```ts
import fs from "node:fs/promises";
import path from "node:path";

function argumento(nome: string, padrao?: string): string | undefined {
    const idx = process.argv.indexOf(`--${nome}`);
    return idx >= 0 ? process.argv[idx + 1] : padrao;
}

async function main(): Promise<void> {
    const slug = argumento("evento");
    const selfie = argumento("selfie");
    const base = argumento("api", "http://127.0.0.1:3002") as string;
    const arquivos = argumento("arquivos", "http://127.0.0.1:8080") as string;
    if (!slug || !selfie) throw new Error("Uso: npm run demo-busca -- --evento <slug> --selfie <arquivo.jpg>");

    const forma = new FormData();
    forma.append("call", "buscar");
    forma.append("slug", slug);
    forma.append("versao_termo", "v1");
    forma.append("aceita_marketing", "N");
    forma.append("selfies", new Blob([await fs.readFile(selfie)]), path.basename(selfie));

    const resposta = await fetch(`${base}/api/participante/busca`, { method: "POST", body: forma });
    const busca = (await resposta.json()) as { token?: string; status?: string; qtd_fotos?: number; msg?: string };
    if (!resposta.ok) throw new Error(`busca falhou (${resposta.status}): ${busca.msg}`);

    console.log(`Busca ${busca.status} — ${busca.qtd_fotos} foto(s) encontradas.`);
    if (busca.status !== "liberada") {
        console.log("Evento exige verificação: o código sai pelo WhatsApp (parte 2 da fase 4).");
        return;
    }

    const rResultado = await fetch(`${base}/api/participante/resultado`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ call: "getResultado", token: busca.token }),
    });
    const resultado = (await rResultado.json()) as { fotos: { id_foto: number; thumb: string; similaridade: number }[] };
    console.log(`Resultado: ${resultado.fotos.length} foto(s).`);

    // Baixa o primeiro thumb pelo nginx: prova que o link assinado vale de verdade.
    if (resultado.fotos.length > 0) {
        const thumb = await fetch(arquivos + resultado.fotos[0].thumb);
        console.log(`Primeiro thumb: HTTP ${thumb.status}, ${(await thumb.arrayBuffer()).byteLength} bytes, similaridade ${resultado.fotos[0].similaridade.toFixed(3)}`);

        const rLinks = await fetch(`${base}/api/participante/resultado`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ call: "gerarLinks", token: busca.token, ids: [resultado.fotos[0].id_foto] }),
        });
        const links = (await rLinks.json()) as { links: { url: string }[] };
        const download = await fetch(arquivos + links.links[0].url);
        console.log(`Download: HTTP ${download.status}, Content-Disposition: ${download.headers.get("content-disposition")}`);
    }
}

main().catch((erro) => {
    console.error("[DemoBusca] Falhou:", erro instanceof Error ? erro.message : erro);
    process.exit(1);
});
```

Em `package.json` (raiz), acrescente em `scripts`: `"demo-busca": "tsx scripts/demo-busca.ts"`.

- [ ] **Step 2: Rodar de verdade**

Com o compose de dev no ar (`docker compose -f docker-compose.dev.yml --profile gpu up -d --build`), um evento publicado com fotos (use o `benchmark-pipeline` da fase 3 para ingerir) e `exigir_whatsapp` desligado nesse evento:

```bash
npm run demo-busca -- --evento <slug> --selfie dados/t1-rosto.jpg
```

Expected: `Busca liberada — N foto(s) encontradas.`, depois `Resultado: N foto(s).`, o thumb com `HTTP 200` e mais de 0 bytes, e o download com `Content-Disposition: attachment`. Se o thumb vier `403`, o `ARQUIVO_SEGREDO` da API e o do serviço `arquivos` estão diferentes.

- [ ] **Step 3: Atualizar a documentação**

Em `docs/desenvolvimento.md`, acrescente ao fim:

```markdown
## Busca do participante (fase 4)

Com o compose de dev no ar e um evento já ingerido pela estação:

```bash
npm run demo-busca -- --evento <slug> --selfie <arquivo.jpg>
```

O script faz a busca real, lê o resultado e baixa um thumb pelo nginx (`127.0.0.1:8080`), que é quem valida o link assinado. O evento precisa estar com `exigir_whatsapp: false` enquanto a verificação (parte 2) não existir.
```

- [ ] **Step 4: Verificação final da fase**

Run:

```bash
npm run test -w apps/api
npm run test:integracao -w apps/api
npm run typecheck
git status --short
```

Expected: tudo PASS e `git status` sem sobras além do que foi commitado.

- [ ] **Step 5: Commit**

```bash
git add scripts/demo-busca.ts package.json docs/desenvolvimento.md
git commit -m "feat(api): demo da busca ponta a ponta e documentação" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Cobertura do spec (fase 4, parte 1)

| Item do spec (seção 8) | Task |
|---|---|
| Limite de taxa por IP, com `CF-Connecting-IP` só sob `CONFIAR_CLOUDFLARE` | 3 |
| Selfie no tmpfs, embedding pelo vision, descarte no `finally` | 6, 8 |
| Consulta por embedding com `ef_search` e varredura iterativa, ignorando foto oculta | 7 |
| `agruparResultados` (maior similaridade por foto, limiar, ordenação) | 4 |
| `decidirStatusBusca` na ordem do spec, incluindo zero fotos e o furo do `token_origem` sem participante | 5 |
| Gravação de `busca` e `busca_foto`, embedding só em memória | 7, 8 |
| Resposta com token, status, prévias assinadas e código; nada de imagem quando `aguardando` | 8 |
| Evento privado inacessível pelo slug | 7, 8 |
| `getResultado`, `situacao`, `gerarLinks` com `?dl=1` e contador de downloads | 9 |
| "Buscar de novo" via `token_origem` | 5, 8 |
| Links assinados no formato do `secure_link`, com validade | 1, 2 |
| ZIP em modo store, em partes, expirando em 7 dias | 10 |
| Galeria do anfitrião paginada, com filtro por fotógrafo, e ZIP do evento em partes de 500 | 11 |
| LGPD: selfie apagada em todo caminho, embedding nunca persistido, nada sensível em log | 6, 8 |

**Fora desta parte (vai para a parte 2):** verificação por WhatsApp (via Chatwoot), calibração do limiar, patrocinadores, moderação de fotos, expurgo e exclusão por telefone.
