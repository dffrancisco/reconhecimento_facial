# web-participante — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A tela que o participante abre no celular: câmera com consentimento, busca por selfie, grade com as fotos dele, download individual e ZIP — mais a galeria do anfitrião e o termo de privacidade.

**Architecture:** App Vue novo em `apps/web-participante`, workspace npm do monorepo. Sete rotas em `createWebHashHistory`, uma pasta por tela no padrão `index.vue` + `<tela>.ts` (`state` reativo + `actions`) + `services/`. Toda a API já existe e está testada (fase 4, parte 1): o app só consome `POST /api/participante/busca`, `/api/participante/resultado` e `/api/anfitriao/galeria`. As imagens não passam pela API — as URLs vêm assinadas na resposta e o navegador busca direto no nginx que já serve `/arquivos`.

**Tech Stack:** Vue 3.5.43, Vite 8, TypeScript 5.9 `strict`, vue-router 5 (hash), Tailwind 4.3 + daisyUI 5.7 via `@tailwindcss/vite`, axios 1.20, Vitest 5 + @vue/test-utils 2.5 + jsdom 30.

**Spec:** [docs/superpowers/specs/2026-09-26-web-participante-design.md](../specs/2026-09-26-web-participante-design.md) — leia junto com este plano. Ela detalha a seção 9 do [design da plataforma](../specs/2026-09-18-plataforma-fotos-design.md), que continua valendo no que ela não contradiz.

## Global Constraints

- **Tudo em português**: nomes de arquivo, variáveis, funções, componentes, comentários e texto de tela. Comentários só para o porquê não óbvio.
- **TypeScript `strict`**, `<script setup lang="ts">` em todo componente.
- **Uma pasta por tela**: `pages/<tela>/index.vue` (template; chama `actions.init()` dentro de `nextTick`), `<tela>.ts` (`export const state = reactive({...})` e `export const actions = {...}`), `interfaces.ts` quando a tela tiver tipos próprios, `services/<tela>.service.ts` para as chamadas. Componentes locais importam o `state` do pai.
- **Corpo das chamadas é sempre `{ call, ... }`** — é o padrão RPC de toda a API do projeto.
- **Mensagem de erro vem da API.** A API já responde em português voltado ao participante (`msg`); a tela mostra essa mensagem. Texto inventado no front só onde a API não responde (falha de rede, câmera negada).
- **Paleta Largada** (spec §2): gradiente `168deg, #ff6b35 0%, #f7414f 52%, #c81d5a 100%`; ação principal em pílula branca com texto `#c81d5a`; ação secundária `rgba(255,255,255,.16)` com texto branco; caixas `rgba(255,255,255,.14)` com cantos 13px; título 800 com `letter-spacing: -.02em`; rótulo 10px maiúsculo com `letter-spacing: .12em`; foto aberta sobre `#0e0e12`. Fonte do sistema (`system-ui`). Sem modo escuro.
- **Nada de selfie ou embedding em log.** O app não loga o conteúdo da imagem nem o token da busca.
- **Testes**: Vitest para funções puras e Vue Test Utils para telas, sempre em `<arquivo>.test.ts` ao lado do código. Nenhum teste depende de API no ar: as chamadas são dubladas.
- Todo commit termina com `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

## Decisões deste plano (onde ele se afasta da spec da plataforma)

- **Rotas declaradas à mão em `router.ts`**, e não por plugin de pastas. A spec §4 da plataforma pede `vite-plugin-pages` (ou `unplugin-vue-router` como alternativa); com sete rotas fixas, o plugin acrescenta dependência e risco de compatibilidade com o Vite 8 sem economizar nada. A convenção de pastas (`pages/<tela>/`) continua igual.
- **Sem SweetAlert2.** A spec o reserva para confirmação destrutiva, e a tela do participante não tem nenhuma ação destrutiva. Erro aparece na própria tela (spec do app, §5).
- **Sem store global** (spec do app, §5).

## Review Focus

Entradas que o spec implica mas que nenhum teste de task exercita, da mais provável de machucar para a menos:

1. **Navegador sem `navigator.share`** (desktop, navegador antigo) — o botão "Compartilhar" tem que sumir e sobrar "Salvar", em vez de dar erro no clique. Pinado na Task 6.
2. **Selfie acima de 8 MB ou que não é imagem** — a API recusa com erro de negócio; a tela mostra a mensagem sem sair da câmera e sem perder o consentimento já marcado. Pinado na Task 5.
3. **Token de resultado vencido ou de outra busca** — a tela não pode mostrar grade vazia silenciosa; mostra a mensagem da API e o caminho de volta para a câmera. Pinado na Task 7.
4. **Evento privado acessado pelo slug** — a API recusa; a tela mostra "Evento não encontrado. Confira o link." e não abre a câmera. Pinado na Task 4.
5. **Internet cai no meio da busca** — sem resposta da API, a tela mostra "Perdemos a conexão. Tente de novo." e mantém a selfie já tirada, sem obrigar a tirar outra. Pinado na Task 5.

## Mapa de arquivos

```
apps/web-participante/
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts                  # plugin vue + tailwind; proxy de /api e /arquivos
├── vitest.config.ts
└── src/
    ├── main.ts                     # cria o app, monta o router
    ├── App.vue                     # só <router-view>
    ├── router.ts                   # as 7 rotas, hash history
    ├── estilo.css                  # @import tailwind + daisyUI + tema Largada
    ├── ts/
    │   ├── api.ts                  # axios: chamar() e chamarMultipart()
    │   ├── erros.ts                # mensagemDeErro(erro) -> texto para a tela
    │   ├── imagem.ts               # dimensoesReduzidas() e reduzirSelfie()
    │   └── arquivos.ts             # urlDeArquivo(caminhoAssinado)
    ├── componentes/
    │   ├── BotaoPilula.vue         # ação principal e secundária
    │   ├── GradeFotos.vue          # grade de 2 colunas com selo de semelhança
    │   ├── FotoAberta.vue          # tela cheia, salvar e compartilhar
    │   └── FaixaPatrocinadores.vue # espaço reservado; não renderiza lista vazia
    └── pages/
        ├── evento/                 # /#/e/:slug e /#/p/:chave
        │   ├── index.vue
        │   ├── evento.ts
        │   ├── interfaces.ts
        │   └── services/evento.service.ts
        ├── resultado/              # /#/r/:token
        │   ├── index.vue
        │   ├── resultado.ts
        │   ├── interfaces.ts
        │   └── services/resultado.service.ts
        ├── anfitriao/              # /#/a/:chave
        │   ├── index.vue
        │   ├── anfitriao.ts
        │   └── services/anfitriao.service.ts
        └── privacidade/
            └── index.vue
package.json                        # MODIFICAR: workspace novo
docs/desenvolvimento.md             # MODIFICAR: como rodar e testar a tela
infra/nginx/arquivos.conf.template  # MODIFICAR: servir o app estático
docker-compose.dev.yml              # MODIFICAR: publicar a tela em dev
```

---

### Task 1: Esqueleto do app com o tema Largada

**Files:**
- Create: `apps/web-participante/package.json`, `index.html`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `src/main.ts`, `src/App.vue`, `src/router.ts`, `src/estilo.css`, `src/ts/imagem.ts`, `src/ts/imagem.test.ts`, `src/pages/privacidade/index.vue`
- Modify: `package.json` (raiz: workspace novo), `.gitignore`

**Interfaces:**
- Consumes: nada
- Produces:
  - `dimensoesReduzidas(largura: number, altura: number, maior: number): { largura: number; altura: number }`
  - rotas nomeadas: `evento` (`/e/:slug`), `eventoPrivado` (`/p/:chave`), `resultado` (`/r/:token`), `anfitriao` (`/a/:chave`), `privacidade` (`/privacidade`)
  - classes utilitárias do tema: `.tela-largada`, `.pilula`, `.pilula-vazada`, `.caixa`, `.rotulo`, `.titulo`

O app nasce com uma tela que dá para abrir (privacidade) e um teste que roda. As telas de verdade entram nas tasks seguintes.

- [ ] **Step 1: Escrever o teste**

`apps/web-participante/src/ts/imagem.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { dimensoesReduzidas } from "./imagem";

describe("dimensoesReduzidas", () => {
    test("reduz o lado maior até o limite, mantendo a proporção", () => {
        // Selfie de celular em pé: 3024x4032 vira 960x1280.
        expect(dimensoesReduzidas(3024, 4032, 1280)).toEqual({ largura: 960, altura: 1280 });
    });

    test("reduz pelo lado maior quando a foto é deitada", () => {
        expect(dimensoesReduzidas(4032, 3024, 1280)).toEqual({ largura: 1280, altura: 960 });
    });

    test("não amplia foto menor que o limite", () => {
        expect(dimensoesReduzidas(640, 480, 1280)).toEqual({ largura: 640, altura: 480 });
    });

    test("arredonda para inteiro, porque canvas não aceita fração", () => {
        const r = dimensoesReduzidas(1000, 333, 500);
        expect(Number.isInteger(r.largura)).toBe(true);
        expect(Number.isInteger(r.altura)).toBe(true);
    });

    test("imagem quadrada continua quadrada", () => {
        expect(dimensoesReduzidas(2000, 2000, 1280)).toEqual({ largura: 1280, altura: 1280 });
    });
});
```

- [ ] **Step 2: Criar o app e rodar o teste, vendo falhar**

```bash
mkdir -p apps/web-participante/src/{ts,componentes,pages/privacidade}
```

`apps/web-participante/package.json`:

```json
{
    "name": "@fotos/web-participante",
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
        "vue": "^3.5.43",
        "vue-router": "^5.3.1"
    },
    "devDependencies": {
        "@tailwindcss/vite": "^4.3.3",
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

Em `package.json` da raiz, acrescente `"apps/web-participante"` ao array `workspaces` (depois de `apps/api`). Rode `npm install` na raiz.

Run: `npm run test -w apps/web-participante`
Expected: FAIL — `Failed to resolve import "./imagem"`.

- [ ] **Step 3: Implementar o utilitário e o esqueleto**

`apps/web-participante/src/ts/imagem.ts`:

```ts
export interface Dimensoes {
    largura: number;
    altura: number;
}

// A selfie sai do celular com 12 megapixels e vai por rede móvel: reduzir antes de enviar
// é o que faz a busca começar em segundos (spec da plataforma §8).
export function dimensoesReduzidas(largura: number, altura: number, maior: number): Dimensoes {
    const ladoMaior = Math.max(largura, altura);
    if (ladoMaior <= maior) return { largura, altura };

    const escala = maior / ladoMaior;
    return { largura: Math.round(largura * escala), altura: Math.round(altura * escala) };
}
```

`apps/web-participante/vite.config.ts`:

```ts
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwind from "@tailwindcss/vite";

// O proxy põe API e arquivos na mesma origem do app: sem isso a câmera (que exige
// contexto seguro) e os links assinados ficariam em origens diferentes no desenvolvimento.
export default defineConfig({
    plugins: [vue(), tailwind()],
    server: {
        host: true, // abre para a rede local: é assim que se testa no celular de verdade
        port: 5173,
        proxy: {
            "/api": { target: "http://127.0.0.1:3002", changeOrigin: true },
            "/arquivos": { target: "http://127.0.0.1:8080", changeOrigin: true },
        },
    },
});
```

`apps/web-participante/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
    plugins: [vue()],
    test: { environment: "jsdom", globals: false },
});
```

`apps/web-participante/tsconfig.json` (não estende o `tsconfig.base.json`: aquele é CommonJS, para o Node):

```json
{
    "compilerOptions": {
        "target": "ES2023",
        "module": "ESNext",
        "moduleResolution": "bundler",
        "strict": true,
        "jsx": "preserve",
        "resolveJsonModule": true,
        "esModuleInterop": true,
        "skipLibCheck": true,
        "forceConsistentCasingInFileNames": true,
        "noEmit": true,
        "lib": ["ES2023", "DOM", "DOM.Iterable"],
        "types": ["vite/client"]
    },
    "include": ["src/**/*.ts", "src/**/*.vue", "*.config.ts"]
}
```

`apps/web-participante/index.html`:

```html
<!doctype html>
<html lang="pt-BR">
    <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#f7414f" />
        <title>Suas fotos do evento</title>
    </head>
    <body>
        <div id="app"></div>
        <script type="module" src="/src/main.ts"></script>
    </body>
</html>
```

`apps/web-participante/src/estilo.css`:

```css
@import "tailwindcss";
@plugin "daisyui";

/* Tema Largada (spec do app, §2). Fica em variáveis para o gradiente e os botões
   não repetirem o mesmo hex em cada tela. */
:root {
    --largada-inicio: #ff6b35;
    --largada-meio: #f7414f;
    --largada-fim: #c81d5a;
    --largada-foto: #0e0e12;
}

/* Fundo de todas as telas do participante, com a área segura do iPhone respeitada. */
.tela-largada {
    background: linear-gradient(168deg, var(--largada-inicio) 0%, var(--largada-meio) 52%, var(--largada-fim) 100%);
    color: #fff;
    min-height: 100dvh;
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
}

.rotulo {
    font-size: 0.625rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    font-weight: 700;
    color: rgb(255 255 255 / 0.82);
}

.titulo {
    font-size: 1.375rem;
    font-weight: 800;
    line-height: 1.12;
    letter-spacing: -0.02em;
}

.caixa {
    background: rgb(255 255 255 / 0.14);
    border-radius: 13px;
}

.pilula {
    border-radius: 999px;
    padding: 0.85rem 1rem;
    font-weight: 800;
    font-size: 0.9rem;
    background: #fff;
    color: var(--largada-fim);
    width: 100%;
}

.pilula:disabled {
    background: rgb(255 255 255 / 0.3);
    color: rgb(255 255 255 / 0.65);
}

.pilula-vazada {
    border-radius: 999px;
    padding: 0.85rem 1rem;
    font-weight: 800;
    font-size: 0.9rem;
    background: rgb(255 255 255 / 0.16);
    color: #fff;
    width: 100%;
}
```

`apps/web-participante/src/App.vue`:

```vue
<script setup lang="ts"></script>

<template>
    <router-view />
</template>
```

`apps/web-participante/src/router.ts`:

```ts
import { createRouter, createWebHashHistory } from "vue-router";

// Rotas declaradas à mão: são sete e fixas. A convenção de pastas (pages/<tela>/) continua.
export const router = createRouter({
    history: createWebHashHistory(),
    routes: [
        { path: "/e/:slug", name: "evento", component: () => import("./pages/evento/index.vue") },
        { path: "/p/:chave", name: "eventoPrivado", component: () => import("./pages/evento/index.vue") },
        { path: "/r/:token", name: "resultado", component: () => import("./pages/resultado/index.vue") },
        { path: "/a/:chave", name: "anfitriao", component: () => import("./pages/anfitriao/index.vue") },
        { path: "/privacidade", name: "privacidade", component: () => import("./pages/privacidade/index.vue") },
        { path: "/:qualquer(.*)*", redirect: "/privacidade" },
    ],
});
```

`apps/web-participante/src/main.ts`:

```ts
import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import "./estilo.css";

createApp(App).use(router).mount("#app");
```

`apps/web-participante/src/pages/privacidade/index.vue` (texto inicial; a spec §10 da plataforma diz que ele precisa de revisão jurídica antes do primeiro evento):

```vue
<script setup lang="ts">
// Termo versionado: a versão exibida aqui é a que a busca grava em `versao_termo`.
const VERSAO = "v1";
</script>

<template>
    <main class="tela-largada px-5 py-8">
        <p class="rotulo">Privacidade · {{ VERSAO }}</p>
        <h1 class="titulo mt-2">Como cuidamos da sua selfie</h1>

        <section class="caixa mt-5 p-4 text-sm leading-relaxed">
            <p><b>Para que serve.</b> Sua selfie é usada só para encontrar as fotos em que você aparece neste evento.</p>
            <p class="mt-3"><b>Quanto tempo fica.</b> A selfie é apagada assim que a busca termina. Não guardamos o seu rosto.</p>
            <p class="mt-3"><b>O que guardamos.</b> Guardamos quais fotos foram encontradas para você, para poder mostrar de novo quando você voltar pelo link.</p>
            <p class="mt-3"><b>Como apagar.</b> Você pode pedir a exclusão dos seus dados a qualquer momento pelo contato do organizador do evento.</p>
        </section>

        <router-link to="/" class="pilula-vazada mt-6 block text-center">Voltar</router-link>
    </main>
</template>
```

Em `.gitignore`, acrescente `apps/web-participante/dist/` (o build não vai para o git).

- [ ] **Step 4: Rodar e ver passar**

Run: `npm install && npm run test -w apps/web-participante`
Expected: PASS (5 testes).

- [ ] **Step 5: Ver a tela de pé**

Run: `npm run dev -w apps/web-participante` e abra `http://localhost:5173/#/privacidade`
Expected: fundo em gradiente laranja→magenta, título "Como cuidamos da sua selfie", botão vazado "Voltar". Encerre com Ctrl-C.

Se o Tailwind não aplicar nada, confira se `@tailwindcss/vite` está em `plugins` do `vite.config.ts` — na versão 4 o Tailwind entra como plugin do Vite, não como PostCSS.

- [ ] **Step 6: Commit**

```bash
git add apps/web-participante package.json package-lock.json .gitignore
git commit -m "feat(web): esqueleto do app do participante com o tema Largada" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Camada de API e mensagens de erro

**Files:**
- Create: `apps/web-participante/src/ts/api.ts`, `src/ts/erros.ts`, `src/ts/erros.test.ts`, `src/ts/arquivos.ts`, `src/ts/arquivos.test.ts`

**Interfaces:**
- Consumes: nada
- Produces:
  - `chamar<T>(area: string, modulo: string, corpo: Record<string, unknown>): Promise<T>`
  - `chamarMultipart<T>(area: string, modulo: string, forma: FormData): Promise<T>`
  - `mensagemDeErro(erro: unknown): string`
  - `urlDeArquivo(caminhoAssinado: string): string`

A API responde erro de negócio com `{ msg, error: true }` e HTTP 200, e erro exibível com HTTP 422 `{ msg }`. Os dois precisam virar a mesma coisa para a tela: uma mensagem em português. Falha de rede e 500 não têm `msg` — aí o texto é nosso.

- [ ] **Step 1: Escrever o teste**

`apps/web-participante/src/ts/erros.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { mensagemDeErro } from "./erros";

describe("mensagemDeErro", () => {
    test("usa a mensagem da API no 422", () => {
        const erro = { response: { status: 422, data: { msg: "Não encontramos um rosto na foto." } } };
        expect(mensagemDeErro(erro)).toBe("Não encontramos um rosto na foto.");
    });

    test("usa a mensagem do erro de negócio", () => {
        const erro = { response: { status: 200, data: { msg: "Mande ao menos uma selfie", error: true } } };
        expect(mensagemDeErro(erro)).toBe("Mande ao menos uma selfie");
    });

    test("falha de rede vira mensagem própria, sem jargão", () => {
        // A pessoa está no meio da rua com sinal ruim: precisa saber que pode tentar de novo.
        const erro = { request: {}, message: "Network Error" };
        expect(mensagemDeErro(erro)).toBe("Perdemos a conexão. Tente de novo.");
    });

    test("erro 500 não expõe detalhe técnico", () => {
        const erro = { response: { status: 500, data: { msg: "Erro ao processar sua solicitação" } } };
        expect(mensagemDeErro(erro)).toBe("Erro ao processar sua solicitação");
    });

    test("erro sem forma conhecida ainda devolve algo utilizável", () => {
        expect(mensagemDeErro(new Error("boom"))).toBe("Não conseguimos completar. Tente de novo.");
    });
});
```

`apps/web-participante/src/ts/arquivos.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { urlDeArquivo } from "./arquivos";

describe("urlDeArquivo", () => {
    test("mantém o caminho assinado como veio da API", () => {
        // A assinatura cobre o caminho exato: mexer nela invalida o link no nginx.
        const assinado = "/arquivos/7/abc_thumb.jpg?md5=aBc-_123&expires=1800000000";
        expect(urlDeArquivo(assinado)).toBe(assinado);
    });

    test("não duplica barra quando a base termina em barra", () => {
        expect(urlDeArquivo("/arquivos/7/abc_web.jpg?md5=x&expires=1")).toMatch(/^\/arquivos\//);
    });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -w apps/web-participante`
Expected: FAIL — `Failed to resolve import "./erros"`.

- [ ] **Step 3: Implementar**

`apps/web-participante/src/ts/erros.ts`:

```ts
interface RespostaComMensagem {
    response?: { status?: number; data?: { msg?: string; error?: boolean } };
    request?: unknown;
}

// A API já escreve as mensagens para o participante, em português (por exemplo, os textos
// de selfie recusada vêm do próprio vision). Inventar texto aqui criaria duas versões da
// mesma frase; só cobrimos o que a API não tem como responder.
export function mensagemDeErro(erro: unknown): string {
    const bruto = erro as RespostaComMensagem;

    const daApi = bruto?.response?.data?.msg;
    if (typeof daApi === "string" && daApi.length > 0) return daApi;

    if (bruto?.request) return "Perdemos a conexão. Tente de novo.";

    return "Não conseguimos completar. Tente de novo.";
}
```

`apps/web-participante/src/ts/api.ts`:

```ts
import axios from "axios";
import { mensagemDeErro } from "./erros";

export class ErroDaApi extends Error {
    constructor(mensagem: string) {
        super(mensagem);
        this.name = "ErroDaApi";
    }
}

const http = axios.create({ baseURL: "/api", timeout: 30_000 });

// O erro de negócio da API chega com HTTP 200 e `{ error: true }`: sem este tratamento,
// a tela seguiria como se tivesse dado certo.
function conferir<T>(dados: unknown): T {
    const corpo = dados as { error?: boolean; msg?: string };
    if (corpo?.error) throw new ErroDaApi(corpo.msg ?? "Não conseguimos completar. Tente de novo.");
    return dados as T;
}

export async function chamar<T>(area: string, modulo: string, corpo: Record<string, unknown>): Promise<T> {
    try {
        const { data } = await http.post(`/${area}/${modulo}`, corpo);
        return conferir<T>(data);
    } catch (erro) {
        if (erro instanceof ErroDaApi) throw erro;
        throw new ErroDaApi(mensagemDeErro(erro));
    }
}

export async function chamarMultipart<T>(area: string, modulo: string, forma: FormData): Promise<T> {
    try {
        // Sem Content-Type manual: o axios precisa pôr o boundary do multipart.
        const { data } = await http.post(`/${area}/${modulo}`, forma, { timeout: 60_000 });
        return conferir<T>(data);
    } catch (erro) {
        if (erro instanceof ErroDaApi) throw erro;
        throw new ErroDaApi(mensagemDeErro(erro));
    }
}
```

`apps/web-participante/src/ts/arquivos.ts`:

```ts
// As URLs de foto e ZIP já vêm assinadas da API e são servidas pelo nginx na mesma origem
// (em desenvolvimento, pelo proxy do Vite). Mexer no caminho invalida a assinatura.
export function urlDeArquivo(caminhoAssinado: string): string {
    return caminhoAssinado;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -w apps/web-participante`
Expected: PASS (12 testes no total).

- [ ] **Step 5: Commit**

```bash
git add apps/web-participante/src/ts
git commit -m "feat(web): camada de API e mensagens de erro" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Componentes do tema

**Files:**
- Create: `apps/web-participante/src/componentes/interfaces.ts`, `BotaoPilula.vue`, `GradeFotos.vue`, `FaixaPatrocinadores.vue`, `GradeFotos.test.ts`, `FaixaPatrocinadores.test.ts`

**Interfaces:**
- Consumes: `urlDeArquivo` (Task 2)
- Produces:
  - `<BotaoPilula variante="principal|secundaria" :desabilitado="boolean">` — emite `click`
  - `componentes/interfaces.ts`: `interface FotoNaGrade { id_foto: number; thumb: string; similaridade?: number }` e `interface Patrocinador { nome: string; logo: string; site?: string }` — em arquivo `.ts` porque `<script setup>` não aceita `export`
  - `<GradeFotos :fotos="FotoNaGrade[]" :mostrarSelo="boolean">` — emite `abrir(indice: number)`
  - `<FaixaPatrocinadores :patrocinadores="Patrocinador[]">` — não renderiza nada com lista vazia

O selo de semelhança aparece só na primeira foto (spec do app, §3.3): na segunda em diante vira ruído.

- [ ] **Step 1: Escrever o teste**

`apps/web-participante/src/componentes/GradeFotos.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import GradeFotos from "./GradeFotos.vue";

const fotos = [
    { id_foto: 1, thumb: "/arquivos/7/a_thumb.jpg?md5=x&expires=1", similaridade: 0.9712 },
    { id_foto: 2, thumb: "/arquivos/7/b_thumb.jpg?md5=y&expires=1", similaridade: 0.8 },
    { id_foto: 3, thumb: "/arquivos/7/c_thumb.jpg?md5=z&expires=1", similaridade: 0.7 },
];

describe("GradeFotos", () => {
    test("mostra uma imagem por foto, com o thumb assinado", () => {
        const tela = mount(GradeFotos, { props: { fotos } });
        const imagens = tela.findAll("img");

        expect(imagens).toHaveLength(3);
        expect(imagens[0].attributes("src")).toBe(fotos[0].thumb);
    });

    test("o selo de semelhança aparece só na primeira foto", () => {
        const tela = mount(GradeFotos, { props: { fotos, mostrarSelo: true } });
        expect(tela.text()).toContain("97%");
        expect(tela.text()).not.toContain("80%");
    });

    test("sem mostrarSelo, nenhuma porcentagem aparece", () => {
        const tela = mount(GradeFotos, { props: { fotos } });
        expect(tela.text()).not.toContain("97%");
    });

    test("clicar numa foto emite o índice dela", async () => {
        const tela = mount(GradeFotos, { props: { fotos } });
        await tela.findAll("button")[1].trigger("click");

        expect(tela.emitted("abrir")?.[0]).toEqual([1]);
    });

    test("lista vazia não quebra e não mostra imagem", () => {
        const tela = mount(GradeFotos, { props: { fotos: [] } });
        expect(tela.findAll("img")).toHaveLength(0);
    });

    test("as fotos têm texto alternativo, para leitor de tela", () => {
        const tela = mount(GradeFotos, { props: { fotos } });
        expect(tela.find("img").attributes("alt")).toBeTruthy();
    });
});
```

`apps/web-participante/src/componentes/FaixaPatrocinadores.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import FaixaPatrocinadores from "./FaixaPatrocinadores.vue";

describe("FaixaPatrocinadores", () => {
    test("com lista vazia não renderiza nada", () => {
        // A API de patrocinadores é da parte 2: até lá a lista vem vazia e a faixa
        // não pode ocupar espaço nem desenhar uma barra branca solta na tela.
        const tela = mount(FaixaPatrocinadores, { props: { patrocinadores: [] } });
        expect(tela.html()).toBe("<!--v-if-->");
    });

    test("mostra o logo de cada patrocinador", () => {
        const tela = mount(FaixaPatrocinadores, {
            props: { patrocinadores: [{ nome: "Loja X", logo: "/patrocinadores/1.png" }] },
        });
        expect(tela.find("img").attributes("src")).toBe("/patrocinadores/1.png");
        expect(tela.find("img").attributes("alt")).toBe("Loja X");
    });

    test("com site, o logo vira link que abre fora", () => {
        const tela = mount(FaixaPatrocinadores, {
            props: { patrocinadores: [{ nome: "Loja X", logo: "/p/1.png", site: "https://loja.com.br" }] },
        });
        const link = tela.find("a");
        expect(link.attributes("href")).toBe("https://loja.com.br");
        expect(link.attributes("rel")).toContain("noopener");
    });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -w apps/web-participante`
Expected: FAIL — `Failed to resolve import "./GradeFotos.vue"`.

- [ ] **Step 3: Implementar**

`apps/web-participante/src/componentes/interfaces.ts` (os tipos ficam aqui: `<script setup>` não permite `export`):

```ts
export interface FotoNaGrade {
    id_foto: number;
    thumb: string;
    similaridade?: number;
}

export interface Patrocinador {
    nome: string;
    logo: string;
    site?: string;
}
```

`apps/web-participante/src/componentes/BotaoPilula.vue`:

```vue
<script setup lang="ts">
withDefaults(defineProps<{ variante?: "principal" | "secundaria"; desabilitado?: boolean }>(), {
    variante: "principal",
    desabilitado: false,
});
defineEmits<{ click: [] }>();
</script>

<template>
    <button
        type="button"
        :class="variante === 'principal' ? 'pilula' : 'pilula-vazada'"
        :disabled="desabilitado"
        @click="$emit('click')"
    >
        <slot />
    </button>
</template>
```

`apps/web-participante/src/componentes/GradeFotos.vue`:

```vue
<script setup lang="ts">
import type { FotoNaGrade } from "./interfaces";

withDefaults(defineProps<{ fotos: FotoNaGrade[]; mostrarSelo?: boolean }>(), { mostrarSelo: false });
defineEmits<{ abrir: [indice: number] }>();

function porcentagem(valor: number | undefined): string {
    return `${Math.round((valor ?? 0) * 100)}%`;
}
</script>

<template>
    <div class="grid grid-cols-2 gap-1.5">
        <button
            v-for="(foto, indice) in fotos"
            :key="foto.id_foto"
            type="button"
            class="relative aspect-square overflow-hidden rounded-[13px] bg-white/15"
            @click="$emit('abrir', indice)"
        >
            <img :src="foto.thumb" :alt="`Foto ${indice + 1} sua no evento`" class="h-full w-full object-cover" loading="lazy" />
            <!-- Selo só na primeira: repetir em todas transformaria a grade numa planilha. -->
            <span
                v-if="mostrarSelo && indice === 0 && foto.similaridade !== undefined"
                class="absolute right-1.5 top-1.5 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-bold"
            >
                {{ porcentagem(foto.similaridade) }}
            </span>
        </button>
    </div>
</template>
```

`apps/web-participante/src/componentes/FaixaPatrocinadores.vue`:

```vue
<script setup lang="ts">
import type { Patrocinador } from "./interfaces";

defineProps<{ patrocinadores: Patrocinador[] }>();
</script>

<template>
    <!-- Fundo branco: logo colorido sobre o gradiente fica ilegível (spec do app, §2). -->
    <div v-if="patrocinadores.length > 0" class="mt-6 flex flex-wrap items-center justify-center gap-4 rounded-xl bg-white px-4 py-3">
        <component
            :is="p.site ? 'a' : 'span'"
            v-for="p in patrocinadores"
            :key="p.nome"
            :href="p.site"
            target="_blank"
            rel="noopener noreferrer"
        >
            <img :src="p.logo" :alt="p.nome" class="h-7 w-auto object-contain" />
        </component>
    </div>
</template>
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -w apps/web-participante`
Expected: PASS (21 testes no total).

- [ ] **Step 5: Commit**

```bash
git add apps/web-participante/src/componentes
git commit -m "feat(web): componentes do tema (botão, grade, patrocinadores)" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Tela do evento — câmera e consentimento

**Files:**
- Create: `apps/web-participante/src/pages/evento/index.vue`, `evento.ts`, `interfaces.ts`, `services/evento.service.ts`, `evento.test.ts`

**Interfaces:**
- Consumes: `chamarMultipart` (Task 2), `dimensoesReduzidas` (Task 1), `BotaoPilula` (Task 3)
- Produces:
  - `state`: `{ etapa: "camera" | "semCamera" | "buscando" | "erro"; consentiu: boolean; selfies: File[]; mensagem: string; nomeEvento: string; totalFotos: number }`
  - `actions`: `init()`, `pedirCamera()`, `disparar()`, `escolherDaGaleria(File[])`, `buscar()`, `tentarDeNovo()`
  - `services/evento.service.ts`: `buscarPorSelfie(entrada: EntradaBusca): Promise<RespostaBusca>`

Esta task entrega a câmera, o consentimento e os caminhos que não dependem da API: permissão negada, navegador sem câmera e evento que não abre. O envio da selfie é a Task 5.

- [ ] **Step 1: Escrever o teste**

`apps/web-participante/src/pages/evento/evento.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";
import { actions, state } from "./evento";

describe("tela do evento", () => {
    beforeEach(() => {
        state.etapa = "camera";
        state.consentiu = false;
        state.selfies = [];
        state.mensagem = "";
    });

    test("começa sem consentimento: o disparo não pode funcionar", () => {
        expect(state.consentiu).toBe(false);
        expect(actions.podeDisparar()).toBe(false);
    });

    test("com o visto marcado, o disparo libera", () => {
        state.consentiu = true;
        expect(actions.podeDisparar()).toBe(true);
    });

    test("permissão de câmera negada leva ao caminho da galeria, não a uma tela morta", async () => {
        // É o risco conhecido de abrir direto na câmera: parte das pessoas nega por reflexo.
        vi.stubGlobal("navigator", {
            mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(new Error("NotAllowedError")) },
        });

        await actions.pedirCamera();

        expect(state.etapa).toBe("semCamera");
        expect(state.mensagem).toContain("galeria");
    });

    test("navegador sem suporte a câmera cai no mesmo caminho", async () => {
        vi.stubGlobal("navigator", {});

        await actions.pedirCamera();

        expect(state.etapa).toBe("semCamera");
    });

    test("escolher da galeria guarda o arquivo e sai do estado sem câmera", () => {
        const arquivo = new File([new Uint8Array([1, 2, 3])], "selfie.jpg", { type: "image/jpeg" });
        state.etapa = "semCamera";

        actions.escolherDaGaleria([arquivo]);

        expect(state.selfies).toHaveLength(1);
        expect(state.selfies[0].type).toBe("image/jpeg");
    });

    test("respeita o limite de selfies do evento", () => {
        const arquivo = () => new File([new Uint8Array([1])], "s.jpg", { type: "image/jpeg" });
        state.maxSelfies = 2;

        actions.escolherDaGaleria([arquivo(), arquivo(), arquivo()]);

        expect(state.selfies).toHaveLength(2);
    });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -w apps/web-participante`
Expected: FAIL — `Failed to resolve import "./evento"`.

- [ ] **Step 3: Implementar**

`apps/web-participante/src/pages/evento/interfaces.ts`:

```ts
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
```

`apps/web-participante/src/pages/evento/services/evento.service.ts`:

```ts
import { chamarMultipart } from "../../../ts/api";
import type { EntradaBusca, RespostaBusca } from "../interfaces";

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
    for (const selfie of entrada.selfies) forma.append("selfies", selfie, selfie.name);

    return chamarMultipart<RespostaBusca>("participante", "busca", forma);
}
```

`apps/web-participante/src/pages/evento/evento.ts`:

```ts
import { reactive } from "vue";
import { dimensoesReduzidas } from "../../ts/imagem";

export const VERSAO_TERMO = "v1";
const LADO_MAIOR_ENVIO = 1280;

export const state = reactive({
    etapa: "camera" as "camera" | "semCamera" | "buscando" | "erro",
    consentiu: false,
    selfies: [] as File[],
    mensagem: "",
    nomeEvento: "",
    totalFotos: 0,
    maxSelfies: 3,
    fluxo: null as MediaStream | null,
});

export const actions = {
    async init(): Promise<void> {
        await actions.pedirCamera();
    },

    podeDisparar(): boolean {
        return state.consentiu;
    },

    // Abrir direto na câmera é o caminho mais rápido, mas parte das pessoas nega a permissão
    // por reflexo: quem negar precisa cair num lugar com saída, nunca numa tela preta.
    async pedirCamera(): Promise<void> {
        const midia = (globalThis.navigator as Navigator | undefined)?.mediaDevices;
        if (!midia?.getUserMedia) {
            state.etapa = "semCamera";
            state.mensagem = "Seu navegador não abre a câmera aqui. Escolha uma selfie da galeria.";
            return;
        }

        try {
            state.fluxo = await midia.getUserMedia({ video: { facingMode: "user" }, audio: false });
            state.etapa = "camera";
        } catch {
            state.etapa = "semCamera";
            state.mensagem = "Precisamos de uma selfie para achar suas fotos. Escolha uma da galeria.";
        }
    },

    escolherDaGaleria(arquivos: File[]): void {
        state.selfies = arquivos.slice(0, state.maxSelfies);
        state.mensagem = "";
    },

    async disparar(video: HTMLVideoElement): Promise<void> {
        if (!actions.podeDisparar()) return;

        const { largura, altura } = dimensoesReduzidas(video.videoWidth, video.videoHeight, LADO_MAIOR_ENVIO);
        const tela = document.createElement("canvas");
        tela.width = largura;
        tela.height = altura;
        tela.getContext("2d")?.drawImage(video, 0, 0, largura, altura);

        const pedaco = await new Promise<Blob | null>((resolve) => tela.toBlob(resolve, "image/jpeg", 0.88));
        if (!pedaco) {
            state.mensagem = "Não conseguimos usar essa foto. Tente de novo.";
            return;
        }

        state.selfies = [...state.selfies, new File([pedaco], "selfie.jpg", { type: "image/jpeg" })].slice(0, state.maxSelfies);
    },

    encerrarCamera(): void {
        for (const trilha of state.fluxo?.getTracks() ?? []) trilha.stop();
        state.fluxo = null;
    },

    tentarDeNovo(): void {
        state.selfies = [];
        state.mensagem = "";
        state.etapa = "camera";
    },
};
```

`apps/web-participante/src/pages/evento/index.vue`:

```vue
<script setup lang="ts">
import { nextTick, onUnmounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import BotaoPilula from "../../componentes/BotaoPilula.vue";
import { actions, state } from "./evento";

const rota = useRoute();
const video = ref<HTMLVideoElement | null>(null);
const entradaArquivo = ref<HTMLInputElement | null>(null);

nextTick(() => actions.init());

// O fluxo da câmera chega depois do primeiro render: ligar no elemento quando existir.
watch([() => state.fluxo, video], () => {
    if (video.value && state.fluxo) video.value.srcObject = state.fluxo;
});

onUnmounted(() => actions.encerrarCamera());

function aoEscolher(evento: Event): void {
    const arquivos = Array.from((evento.target as HTMLInputElement).files ?? []);
    if (arquivos.length > 0) actions.escolherDaGaleria(arquivos);
}
</script>

<template>
    <main class="tela-largada flex flex-col">
        <template v-if="state.etapa === 'camera'">
            <div class="relative flex-1 overflow-hidden bg-[#17171c]">
                <video ref="video" autoplay playsinline muted class="h-full w-full object-cover opacity-80"></video>
                <div
                    class="pointer-events-none absolute left-1/2 top-1/2 h-[54%] w-[62%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border-[3px] border-dashed border-white/90"
                ></div>

                <div class="absolute inset-x-3 bottom-4 rounded-[15px] bg-black/80 p-3 backdrop-blur">
                    <p class="text-sm font-extrabold">Encaixe seu rosto e toque</p>
                    <label class="mt-2 flex items-start gap-2 text-[10px] leading-snug">
                        <input v-model="state.consentiu" type="checkbox" class="mt-0.5 size-4 shrink-0 accent-white" />
                        <span>
                            Autorizo o uso da selfie para achar minhas fotos. Ela é apagada depois.
                            <router-link to="/privacidade" class="underline">Termo</router-link>
                        </span>
                    </label>
                </div>
            </div>

            <div class="flex items-center justify-between px-6 py-4">
                <button type="button" class="text-xs" @click="entradaArquivo?.click()">Galeria</button>
                <button
                    type="button"
                    class="size-14 rounded-full border-4 border-white/40 bg-white disabled:opacity-40"
                    :disabled="!actions.podeDisparar()"
                    @click="video && actions.disparar(video)"
                ></button>
                <span class="w-12"></span>
            </div>
        </template>

        <section v-else-if="state.etapa === 'semCamera'" class="flex flex-1 flex-col justify-center px-6 py-10">
            <p class="rotulo">Achar minhas fotos</p>
            <h1 class="titulo mt-2">{{ state.mensagem }}</h1>
            <label class="mt-3 flex items-start gap-2 text-xs leading-snug">
                <input v-model="state.consentiu" type="checkbox" class="mt-0.5 size-4 shrink-0 accent-white" />
                <span>
                    Autorizo o uso da selfie para achar minhas fotos. Ela é apagada depois.
                    <router-link to="/privacidade" class="underline">Termo</router-link>
                </span>
            </label>
            <BotaoPilula class="mt-6" :desabilitado="!state.consentiu" @click="entradaArquivo?.click()">
                Escolher da galeria
            </BotaoPilula>
        </section>

        <input
            ref="entradaArquivo"
            type="file"
            accept="image/*"
            capture="user"
            multiple
            class="hidden"
            @change="aoEscolher"
        />
    </main>
</template>
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -w apps/web-participante`
Expected: PASS (27 testes no total).

- [ ] **Step 5: Commit**

```bash
git add apps/web-participante/src/pages/evento
git commit -m "feat(web): tela do evento com câmera e consentimento" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Enviar a selfie e mostrar a busca

**Files:**
- Modify: `apps/web-participante/src/pages/evento/evento.ts`, `index.vue`, `evento.test.ts`

**Interfaces:**
- Consumes: `buscarPorSelfie` (Task 4), `ErroDaApi` (Task 2), `router` (Task 1)
- Produces: `actions.buscar(): Promise<void>` — navega para `/r/<token>` quando a busca libera; `state.etapa` ganha o estado `"buscando"`

Cobre dois itens do Review Focus: selfie recusada pela API (tamanho, tipo, sem rosto) sem perder o consentimento, e queda de rede sem perder a selfie já tirada.

- [ ] **Step 1: Escrever o teste**

Acrescente em `apps/web-participante/src/pages/evento/evento.test.ts`:

```ts
import { buscarPorSelfie } from "./services/evento.service";
import { ErroDaApi } from "../../ts/api";

vi.mock("./services/evento.service", () => ({ buscarPorSelfie: vi.fn() }));

const irPara = vi.fn();
vi.mock("../../router", () => ({ router: { push: (destino: unknown) => irPara(destino) } }));

describe("envio da selfie", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.etapa = "camera";
        state.consentiu = true;
        state.mensagem = "";
        state.selfies = [new File([new Uint8Array([1])], "selfie.jpg", { type: "image/jpeg" })];
        state.slug = "corrida-da-serra";
    });

    test("busca liberada leva para a tela de resultado", async () => {
        vi.mocked(buscarPorSelfie).mockResolvedValue({ token: "tok123", status: "liberada", qtd_fotos: 12, previas: [] });

        await actions.buscar();

        expect(irPara).toHaveBeenCalledWith({ name: "resultado", params: { token: "tok123" } });
    });

    test("mostra a busca em curso enquanto espera", async () => {
        let liberar: (valor: unknown) => void = () => {};
        vi.mocked(buscarPorSelfie).mockReturnValue(new Promise((resolve) => (liberar = resolve)) as never);

        const emCurso = actions.buscar();
        expect(state.etapa).toBe("buscando");

        liberar({ token: "t", status: "liberada", qtd_fotos: 0, previas: [] });
        await emCurso;
    });

    test("selfie recusada mostra a mensagem da API e mantém o consentimento", async () => {
        // A pessoa não pode ter que marcar o visto de novo por causa de uma foto tremida.
        vi.mocked(buscarPorSelfie).mockRejectedValue(new ErroDaApi("A foto ficou tremida. Segure o celular firme."));

        await actions.buscar();

        expect(state.etapa).toBe("erro");
        expect(state.mensagem).toContain("tremida");
        expect(state.consentiu).toBe(true);
    });

    test("queda de rede não descarta a selfie já tirada", async () => {
        vi.mocked(buscarPorSelfie).mockRejectedValue(new ErroDaApi("Perdemos a conexão. Tente de novo."));

        await actions.buscar();

        expect(state.mensagem).toContain("conexão");
        expect(state.selfies).toHaveLength(1);
    });

    test("o buscar de novo manda o token da busca anterior", async () => {
        // Sem isso, quem já se verificou teria que se verificar de novo a cada busca.
        sessionStorage.setItem("busca_anterior", "tok-anterior");
        vi.mocked(buscarPorSelfie).mockResolvedValue({ token: "tok2", status: "liberada", qtd_fotos: 3, previas: [] });

        await actions.buscar();

        expect(vi.mocked(buscarPorSelfie).mock.calls[0][0].tokenOrigem).toBe("tok-anterior");
        sessionStorage.clear();
    });

    test("não envia sem selfie nenhuma", async () => {
        state.selfies = [];

        await actions.buscar();

        expect(buscarPorSelfie).not.toHaveBeenCalled();
    });

    test("evento privado aberto pelo slug mostra o recado da API e não abre a câmera", async () => {
        vi.mocked(buscarPorSelfie).mockRejectedValue(new ErroDaApi("Evento não encontrado. Confira o link."));

        await actions.buscar();

        expect(state.etapa).toBe("erro");
        expect(state.mensagem).toContain("Evento não encontrado");
    });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -w apps/web-participante`
Expected: FAIL — `actions.buscar is not a function`.

- [ ] **Step 3: Implementar**

Em `apps/web-participante/src/pages/evento/evento.ts`, acrescente ao `state` os campos da rota e a busca:

```ts
    slug: "",
    chaveAcesso: "",
```

e ao `actions`:

```ts
    async buscar(): Promise<void> {
        if (state.selfies.length === 0) return;

        state.etapa = "buscando";
        state.mensagem = "";
        try {
            const resposta = await buscarPorSelfie({
                slug: state.slug || undefined,
                chaveAcesso: state.chaveAcesso || undefined,
                versaoTermo: VERSAO_TERMO,
                selfies: state.selfies,
                tokenOrigem: sessionStorage.getItem("busca_anterior") ?? undefined,
            });

            actions.encerrarCamera();
            // Mesmo com zero fotos a busca é `liberada`: a tela de resultado é que mostra
            // o "ainda não achamos você" (spec da plataforma §8).
            router.push({ name: "resultado", params: { token: resposta.token } });
        } catch (erro) {
            // A selfie e o consentimento continuam de pé: a pessoa só toca em "tentar de novo".
            state.etapa = "erro";
            state.mensagem = erro instanceof Error ? erro.message : "Não conseguimos completar. Tente de novo.";
        }
    },
```

com os imports `import { router } from "../../router";` e `import { buscarPorSelfie } from "./services/evento.service";`.

Em `index.vue`, leia a rota no `init` e acrescente os dois estados novos ao template:

```ts
nextTick(() => {
    state.slug = String(rota.params.slug ?? "");
    state.chaveAcesso = String(rota.params.chave ?? "");
    actions.init();
});
```

```vue
        <section v-else-if="state.etapa === 'buscando'" class="flex flex-1 flex-col items-center justify-center px-6 text-center">
            <img
                v-if="state.selfies[0]"
                :src="URL.createObjectURL(state.selfies[0])"
                alt="Selfie que você enviou"
                class="size-20 rounded-2xl border-[3px] border-white/45 object-cover"
            />
            <h1 class="titulo mt-4">Procurando você</h1>
            <p class="mt-1 text-xs text-white/85">
                {{ state.totalFotos > 0 ? `Olhando ${state.totalFotos} fotos da prova` : "Olhando as fotos da prova" }}
            </p>
            <div class="mt-4 flex gap-1.5">
                <span class="size-[7px] animate-pulse rounded-full bg-white"></span>
                <span class="size-[7px] animate-pulse rounded-full bg-white/60 [animation-delay:150ms]"></span>
                <span class="size-[7px] animate-pulse rounded-full bg-white/40 [animation-delay:300ms]"></span>
            </div>
        </section>

        <section v-else-if="state.etapa === 'erro'" class="flex flex-1 flex-col justify-center px-6 py-10">
            <h1 class="titulo">{{ state.mensagem }}</h1>
            <BotaoPilula class="mt-6" @click="actions.tentarDeNovo()">Tentar outra selfie</BotaoPilula>
        </section>
```

E no estado `camera`, depois de tirar a selfie, mostre o botão de buscar:

```vue
                <BotaoPilula v-if="state.selfies.length > 0" class="mt-3" @click="actions.buscar()">
                    Buscar minhas fotos ({{ state.selfies.length }})
                </BotaoPilula>
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -w apps/web-participante`
Expected: PASS (34 testes no total).

- [ ] **Step 5: Commit**

```bash
git add apps/web-participante/src/pages/evento
git commit -m "feat(web): envio da selfie e tela de busca em curso" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Tela de resultado e foto aberta

**Files:**
- Create: `apps/web-participante/src/pages/resultado/index.vue`, `resultado.ts`, `interfaces.ts`, `services/resultado.service.ts`, `resultado.test.ts`, `apps/web-participante/src/componentes/FotoAberta.vue`, `FotoAberta.test.ts`

**Interfaces:**
- Consumes: `chamar` (Task 2), `GradeFotos`/`BotaoPilula`/`FaixaPatrocinadores` (Task 3), `urlDeArquivo` (Task 2)
- Produces:
  - `state`: `{ carregando: boolean; evento: string; fotos: FotoDoResultado[]; validadeAte: string | null; mensagem: string; aberta: number | null; zip: "nenhum" | "montando" | "pronto"; urlZip: string }`
  - `actions`: `init(token)`, `abrir(indice)`, `fechar()`, `salvar(indice)`, `compartilhar(indice)`, `pedirZip()`
  - `<FotoAberta :foto="FotoDoResultado" :podeCompartilhar="boolean">` — emite `fechar`, `salvar`, `compartilhar`

Cobre um item do Review Focus: navegador sem `navigator.share` esconde o botão "Compartilhar" em vez de dar erro.

- [ ] **Step 1: Escrever o teste**

`apps/web-participante/src/componentes/FotoAberta.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { mount } from "@vue/test-utils";
import FotoAberta from "./FotoAberta.vue";

const foto = { id_foto: 1, thumb: "/arquivos/7/a_thumb.jpg?md5=x&expires=1", similaridade: 0.9 };

describe("FotoAberta", () => {
    test("mostra a foto em tela cheia", () => {
        const tela = mount(FotoAberta, { props: { foto, podeCompartilhar: true } });
        expect(tela.find("img").attributes("src")).toBe(foto.thumb);
    });

    test("com suporte a compartilhar, mostra os dois botões", () => {
        const tela = mount(FotoAberta, { props: { foto, podeCompartilhar: true } });
        expect(tela.text()).toContain("Salvar");
        expect(tela.text()).toContain("Compartilhar");
    });

    test("sem suporte a compartilhar, sobra só Salvar", () => {
        // No computador o navigator.share não existe: o botão não pode ficar lá dando erro.
        const tela = mount(FotoAberta, { props: { foto, podeCompartilhar: false } });
        expect(tela.text()).toContain("Salvar");
        expect(tela.text()).not.toContain("Compartilhar");
    });

    test("fechar emite o evento", async () => {
        const tela = mount(FotoAberta, { props: { foto, podeCompartilhar: false } });
        await tela.find("[aria-label='Fechar']").trigger("click");
        expect(tela.emitted("fechar")).toBeTruthy();
    });
});
```

`apps/web-participante/src/pages/resultado/resultado.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";
import { actions, state } from "./resultado";
import { getResultado, gerarLinks, pedirZip, situacaoZip } from "./services/resultado.service";
import { ErroDaApi } from "../../ts/api";

vi.mock("./services/resultado.service", () => ({
    getResultado: vi.fn(),
    gerarLinks: vi.fn(),
    pedirZip: vi.fn(),
    situacaoZip: vi.fn(),
}));

const resultadoCheio = {
    evento: { nome: "Corrida da Serra", slug: "corrida-da-serra" },
    validade_ate: "2026-12-31T00:00:00.000Z",
    fotos: [
        { id_foto: 1, thumb: "/arquivos/7/a_thumb.jpg?md5=x&expires=1", similaridade: 0.97 },
        { id_foto: 2, thumb: "/arquivos/7/b_thumb.jpg?md5=y&expires=1", similaridade: 0.8 },
    ],
};

describe("tela de resultado", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.fotos = [];
        state.mensagem = "";
        state.zip = "nenhum";
    });

    test("carrega as fotos da busca", async () => {
        vi.mocked(getResultado).mockResolvedValue(resultadoCheio);

        await actions.init("tok123");

        expect(state.evento).toBe("Corrida da Serra");
        expect(state.fotos).toHaveLength(2);
        expect(state.carregando).toBe(false);
    });

    test("zero fotos não é erro: é a tela de 'ainda não achamos'", async () => {
        vi.mocked(getResultado).mockResolvedValue({ ...resultadoCheio, fotos: [] });

        await actions.init("tok123");

        expect(state.fotos).toHaveLength(0);
        expect(state.mensagem).toBe("");
    });

    test("token vencido mostra a mensagem da API", async () => {
        vi.mocked(getResultado).mockRejectedValue(new ErroDaApi("O prazo para baixar estas fotos venceu. Faça a busca de novo."));

        await actions.init("tok123");

        expect(state.mensagem).toContain("prazo");
        expect(state.fotos).toHaveLength(0);
    });

    test("pedir o ZIP marca como montando e depois pronto", async () => {
        vi.mocked(pedirZip).mockResolvedValue({ partes: [7], status: "pendente" });
        vi.mocked(situacaoZip).mockResolvedValue({ status: "pronto", url: "/arquivos/zips/7/7.zip?md5=x&expires=1" });
        state.token = "tok123";

        await actions.pedirZip();

        expect(state.zip).toBe("pronto");
        expect(state.urlZip).toContain("/arquivos/zips/");
    });

    test("ZIP que falha volta ao estado inicial com recado", async () => {
        vi.mocked(pedirZip).mockResolvedValue({ partes: [7], status: "pendente" });
        vi.mocked(situacaoZip).mockResolvedValue({ status: "erro" });
        state.token = "tok123";

        await actions.pedirZip();

        expect(state.zip).toBe("nenhum");
        expect(state.mensagem).toContain("ZIP");
    });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -w apps/web-participante`
Expected: FAIL — `Failed to resolve import "./resultado"`.

- [ ] **Step 3: Implementar**

`apps/web-participante/src/pages/resultado/interfaces.ts`:

```ts
import type { FotoNaGrade } from "../../componentes/interfaces";

// O resultado sempre traz a semelhança; a grade aceita sem.
export type FotoDoResultado = FotoNaGrade & { similaridade: number };

export interface RespostaResultado {
    evento: { nome: string; slug: string };
    validade_ate: string | null;
    fotos: FotoDoResultado[];
}
```

`apps/web-participante/src/pages/resultado/services/resultado.service.ts`:

```ts
import { chamar } from "../../../ts/api";
import type { RespostaResultado } from "../interfaces";

export function getResultado(token: string): Promise<RespostaResultado> {
    return chamar<RespostaResultado>("participante", "resultado", { call: "getResultado", token });
}

export function gerarLinks(token: string, ids: number[]): Promise<{ links: { id_foto: number; url: string }[] }> {
    return chamar("participante", "resultado", { call: "gerarLinks", token, ids });
}

export function pedirZip(token: string): Promise<{ partes: number[]; status: string }> {
    return chamar("participante", "resultado", { call: "pedirZip", token });
}

export function situacaoZip(token: string, idArquivoZip: number): Promise<{ status: string; url?: string }> {
    return chamar("participante", "resultado", { call: "situacaoZip", token, id_arquivo_zip: idArquivoZip });
}
```

`apps/web-participante/src/pages/resultado/resultado.ts`:

```ts
import { reactive } from "vue";
import type { FotoDoResultado } from "./interfaces";
import { getResultado, gerarLinks, pedirZip, situacaoZip } from "./services/resultado.service";

const TENTATIVAS_ZIP = 60;
const ESPERA_ZIP_MS = 1000;

export const state = reactive({
    token: "",
    carregando: true,
    evento: "",
    fotos: [] as FotoDoResultado[],
    validadeAte: null as string | null,
    mensagem: "",
    aberta: null as number | null,
    zip: "nenhum" as "nenhum" | "montando" | "pronto",
    urlZip: "",
});

export const actions = {
    async init(token: string): Promise<void> {
        state.token = token;
        state.carregando = true;
        state.mensagem = "";
        // Guardado para o "buscar de novo" mandar como token_origem — é o que dispensa
        // refazer a verificação quando ela existir.
        sessionStorage.setItem("busca_anterior", token);
        try {
            const resposta = await getResultado(token);
            state.evento = resposta.evento.nome;
            state.fotos = resposta.fotos;
            state.validadeAte = resposta.validade_ate;
        } catch (erro) {
            state.mensagem = erro instanceof Error ? erro.message : "Não conseguimos abrir suas fotos.";
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

    podeCompartilhar(): boolean {
        return typeof navigator !== "undefined" && typeof navigator.share === "function";
    },

    async salvar(indice: number): Promise<void> {
        const foto = state.fotos[indice];
        if (!foto) return;

        const { links } = await gerarLinks(state.token, [foto.id_foto]);
        if (links[0]) globalThis.location.assign(links[0].url);
    },

    async compartilhar(indice: number): Promise<void> {
        const foto = state.fotos[indice];
        if (!foto || !actions.podeCompartilhar()) return;

        const { links } = await gerarLinks(state.token, [foto.id_foto]);
        if (!links[0]) return;

        // Baixa o arquivo para poder anexar: compartilhar só o link faria a pessoa mandar
        // uma URL que vence em uma hora.
        const resposta = await fetch(links[0].url);
        const arquivo = new File([await resposta.blob()], `foto-${foto.id_foto}.jpg`, { type: "image/jpeg" });
        await navigator.share({ files: [arquivo], title: state.evento });
    },

    async pedirZip(): Promise<void> {
        state.zip = "montando";
        state.mensagem = "";
        try {
            const { partes } = await pedirZip(state.token);
            for (let tentativa = 0; tentativa < TENTATIVAS_ZIP; tentativa++) {
                const situacao = await situacaoZip(state.token, partes[0]);
                if (situacao.status === "pronto" && situacao.url) {
                    state.urlZip = situacao.url;
                    state.zip = "pronto";
                    return;
                }
                if (situacao.status === "erro") break;
                await new Promise((resolve) => setTimeout(resolve, ESPERA_ZIP_MS));
            }
            state.zip = "nenhum";
            state.mensagem = "Não conseguimos montar o ZIP agora. Baixe as fotos uma a uma ou tente mais tarde.";
        } catch (erro) {
            state.zip = "nenhum";
            state.mensagem = erro instanceof Error ? erro.message : "Não conseguimos montar o ZIP.";
        }
    },
};
```

`apps/web-participante/src/componentes/FotoAberta.vue`:

```vue
<script setup lang="ts">
import type { FotoNaGrade } from "./interfaces";

defineProps<{ foto: FotoNaGrade; podeCompartilhar: boolean }>();
defineEmits<{ fechar: []; salvar: []; compartilhar: [] }>();
</script>

<template>
    <div class="fixed inset-0 z-50 flex flex-col bg-[#0e0e12]">
        <button type="button" aria-label="Fechar" class="absolute right-4 top-4 z-10 text-2xl text-white" @click="$emit('fechar')">
            ×
        </button>
        <div class="flex flex-1 items-center justify-center">
            <img :src="foto.thumb" alt="Sua foto no evento" class="max-h-full max-w-full object-contain" />
        </div>
        <div class="flex gap-2 px-4 pb-6 pt-3">
            <button type="button" class="pilula" @click="$emit('salvar')">Salvar</button>
            <button v-if="podeCompartilhar" type="button" class="pilula-vazada" @click="$emit('compartilhar')">
                Compartilhar
            </button>
        </div>
    </div>
</template>
```

`apps/web-participante/src/pages/resultado/index.vue`:

```vue
<script setup lang="ts">
import { computed, nextTick } from "vue";
import { useRoute } from "vue-router";
import BotaoPilula from "../../componentes/BotaoPilula.vue";
import FaixaPatrocinadores from "../../componentes/FaixaPatrocinadores.vue";
import FotoAberta from "../../componentes/FotoAberta.vue";
import GradeFotos from "../../componentes/GradeFotos.vue";
import { actions, state } from "./resultado";

const rota = useRoute();
nextTick(() => actions.init(String(rota.params.token ?? "")));

const validade = computed(() =>
    state.validadeAte ? new Date(state.validadeAte).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : ""
);
</script>

<template>
    <main class="tela-largada px-5 py-7">
        <p v-if="state.carregando" class="titulo">Abrindo suas fotos…</p>

        <section v-else-if="state.mensagem && state.fotos.length === 0" class="flex min-h-[70dvh] flex-col justify-center">
            <h1 class="titulo">{{ state.mensagem }}</h1>
            <router-link to="/privacidade" class="mt-2 text-xs underline">Dúvidas sobre seus dados</router-link>
        </section>

        <section v-else-if="state.fotos.length === 0" class="flex min-h-[70dvh] flex-col items-center justify-center text-center">
            <div class="mb-3 flex size-14 items-center justify-center rounded-full bg-white/20 text-2xl">🔍</div>
            <h1 class="titulo">Ainda não achamos você</h1>
            <p class="mt-2 text-xs text-white/85">
                Os fotógrafos ainda estão mandando fotos da prova. Volte mais tarde e tente de novo.
            </p>
            <BotaoPilula class="mt-6" @click="$router.back()">Tentar outra selfie</BotaoPilula>
        </section>

        <template v-else>
            <p class="rotulo">{{ state.evento }}</p>
            <h1 class="titulo mt-1">{{ state.fotos.length }} fotos suas</h1>
            <p v-if="validade" class="mt-1 text-[11px] text-white/75">Disponível até {{ validade }}</p>

            <GradeFotos class="mt-4" :fotos="state.fotos" mostrar-selo @abrir="actions.abrir" />

            <BotaoPilula class="mt-4" :desabilitado="state.zip === 'montando'" @click="actions.pedirZip()">
                {{ state.zip === "montando" ? "Preparando…" : "Baixar todas (ZIP)" }}
            </BotaoPilula>
            <a v-if="state.zip === 'pronto'" :href="state.urlZip" class="pilula-vazada mt-2 block text-center">Baixar o ZIP</a>

            <p v-if="state.mensagem" class="mt-3 text-center text-xs text-white/85">{{ state.mensagem }}</p>

            <button type="button" class="mt-5 w-full text-center text-[11px] text-white/75" @click="$router.back()">
                Chegaram fotos novas? Buscar de novo
            </button>

            <FaixaPatrocinadores :patrocinadores="[]" />
        </template>

        <FotoAberta
            v-if="state.aberta !== null"
            :foto="state.fotos[state.aberta]"
            :pode-compartilhar="actions.podeCompartilhar()"
            @fechar="actions.fechar()"
            @salvar="actions.salvar(state.aberta!)"
            @compartilhar="actions.compartilhar(state.aberta!)"
        />
    </main>
</template>
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -w apps/web-participante`
Expected: PASS (44 testes no total).

- [ ] **Step 5: Commit**

```bash
git add apps/web-participante/src/pages/resultado apps/web-participante/src/componentes
git commit -m "feat(web): tela de resultado, foto aberta e ZIP" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Galeria do anfitrião

**Files:**
- Create: `apps/web-participante/src/pages/anfitriao/index.vue`, `anfitriao.ts`, `services/anfitriao.service.ts`, `anfitriao.test.ts`

**Interfaces:**
- Consumes: `chamar` (Task 2), `GradeFotos`/`BotaoPilula` (Task 3)
- Produces:
  - `state`: `{ carregando: boolean; evento: string; fotos: FotoNaGrade[]; offset: number; acabou: boolean; mensagem: string }`
  - `actions`: `init(chave)`, `carregarMais()`, `pedirZip()`

Quem tem a chave vê o evento inteiro, sem selfie e sem verificação. Páginas de 60, como a API devolve.

- [ ] **Step 1: Escrever o teste**

`apps/web-participante/src/pages/anfitriao/anfitriao.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";
import { actions, state } from "./anfitriao";
import { getGaleria, pedirZipDoEvento } from "./services/anfitriao.service";
import { ErroDaApi } from "../../ts/api";

vi.mock("./services/anfitriao.service", () => ({ getGaleria: vi.fn(), pedirZipDoEvento: vi.fn() }));

function fotos(quantas: number) {
    return Array.from({ length: quantas }, (_, i) => ({
        id_foto: i + 1,
        thumb: `/arquivos/7/${i}_thumb.jpg?md5=x&expires=1`,
        web: `/arquivos/7/${i}_web.jpg?md5=x&expires=1`,
    }));
}

describe("galeria do anfitrião", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        state.fotos = [];
        state.offset = 0;
        state.acabou = false;
        state.mensagem = "";
    });

    test("carrega a primeira página", async () => {
        vi.mocked(getGaleria).mockResolvedValue({ evento: "Corrida da Serra", fotos: fotos(60) });

        await actions.init("chave-abc");

        expect(state.evento).toBe("Corrida da Serra");
        expect(state.fotos).toHaveLength(60);
        expect(state.acabou).toBe(false);
    });

    test("página incompleta significa que acabou", async () => {
        vi.mocked(getGaleria).mockResolvedValue({ evento: "Corrida", fotos: fotos(12) });

        await actions.init("chave-abc");

        expect(state.acabou).toBe(true);
    });

    test("carregar mais acumula em vez de substituir", async () => {
        vi.mocked(getGaleria).mockResolvedValueOnce({ evento: "Corrida", fotos: fotos(60) });
        await actions.init("chave-abc");

        vi.mocked(getGaleria).mockResolvedValueOnce({ evento: "Corrida", fotos: fotos(5) });
        await actions.carregarMais();

        expect(state.fotos).toHaveLength(65);
        expect(state.acabou).toBe(true);
    });

    test("chave errada mostra o recado da API", async () => {
        vi.mocked(getGaleria).mockRejectedValue(new ErroDaApi("Galeria não encontrada. Confira o link."));

        await actions.init("chave-errada");

        expect(state.mensagem).toContain("não encontrada");
        expect(state.fotos).toHaveLength(0);
    });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -w apps/web-participante`
Expected: FAIL — `Failed to resolve import "./anfitriao"`.

- [ ] **Step 3: Implementar**

`apps/web-participante/src/pages/anfitriao/services/anfitriao.service.ts`:

```ts
import { chamar } from "../../../ts/api";
import type { FotoNaGrade } from "../../../componentes/interfaces";

export function getGaleria(chave: string, offset: number): Promise<{ evento: string; fotos: FotoNaGrade[] }> {
    return chamar("anfitriao", "galeria", { call: "getGaleria", chave, offset });
}

export function pedirZipDoEvento(chave: string): Promise<{ partes: number[]; status: string }> {
    return chamar("anfitriao", "galeria", { call: "pedirZip", chave });
}
```

`apps/web-participante/src/pages/anfitriao/anfitriao.ts`:

```ts
import { reactive } from "vue";
import type { FotoNaGrade } from "../../componentes/interfaces";
import { getGaleria, pedirZipDoEvento } from "./services/anfitriao.service";

// A API devolve 60 por página: uma página menor que isso é a última.
const POR_PAGINA = 60;

export const state = reactive({
    chave: "",
    carregando: true,
    evento: "",
    fotos: [] as FotoNaGrade[],
    offset: 0,
    acabou: false,
    mensagem: "",
    zipPedido: false,
});

export const actions = {
    async init(chave: string): Promise<void> {
        state.chave = chave;
        state.fotos = [];
        state.offset = 0;
        state.acabou = false;
        await actions.carregarMais();
    },

    async carregarMais(): Promise<void> {
        state.carregando = true;
        state.mensagem = "";
        try {
            const pagina = await getGaleria(state.chave, state.offset);
            state.evento = pagina.evento;
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

    async pedirZip(): Promise<void> {
        try {
            const { partes } = await pedirZipDoEvento(state.chave);
            state.zipPedido = true;
            state.mensagem = `Estamos montando ${partes.length} arquivo(s). Volte aqui em alguns minutos.`;
        } catch (erro) {
            state.mensagem = erro instanceof Error ? erro.message : "Não conseguimos pedir o ZIP.";
        }
    },
};
```

`apps/web-participante/src/pages/anfitriao/index.vue`:

```vue
<script setup lang="ts">
import { nextTick } from "vue";
import { useRoute } from "vue-router";
import BotaoPilula from "../../componentes/BotaoPilula.vue";
import GradeFotos from "../../componentes/GradeFotos.vue";
import { actions, state } from "./anfitriao";

const rota = useRoute();
nextTick(() => actions.init(String(rota.params.chave ?? "")));
</script>

<template>
    <main class="tela-largada px-5 py-7">
        <p class="rotulo">Galeria do evento</p>
        <h1 class="titulo mt-1">{{ state.evento || "Abrindo…" }}</h1>
        <p v-if="state.fotos.length > 0" class="mt-1 text-[11px] text-white/75">{{ state.fotos.length }} fotos</p>

        <p v-if="state.mensagem && state.fotos.length === 0" class="titulo mt-8">{{ state.mensagem }}</p>

        <template v-else>
            <GradeFotos class="mt-4" :fotos="state.fotos" />

            <BotaoPilula v-if="!state.acabou" class="mt-4" :desabilitado="state.carregando" @click="actions.carregarMais()">
                {{ state.carregando ? "Carregando…" : "Ver mais fotos" }}
            </BotaoPilula>

            <BotaoPilula v-if="state.fotos.length > 0" class="mt-2" variante="secundaria" @click="actions.pedirZip()">
                Baixar tudo
            </BotaoPilula>

            <p v-if="state.mensagem" class="mt-3 text-center text-xs text-white/85">{{ state.mensagem }}</p>
        </template>
    </main>
</template>
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -w apps/web-participante`
Expected: PASS (48 testes no total).

- [ ] **Step 5: Commit**

```bash
git add apps/web-participante/src/pages/anfitriao
git commit -m "feat(web): galeria do anfitrião" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Servir a tela e provar no navegador

**Files:**
- Modify: `infra/nginx/arquivos.conf.template`, `infra/nginx/Dockerfile`, `docker-compose.dev.yml`, `docker-compose.vps.yml`, `docs/desenvolvimento.md`
- Create: `apps/web-participante/.dockerignore`

**Interfaces:**
- Consumes: o app inteiro (Tasks 1–7)
- Produces: a tela servida pelo mesmo nginx que já entrega `/arquivos`, em `127.0.0.1:8080` no desenvolvimento

O app é estático: o mesmo nginx que valida os links assinados serve os arquivos do build. Uma origem só, sem CORS e sem container novo.

- [ ] **Step 1: Servir o app no nginx**

Em `infra/nginx/Dockerfile`, acrescente o build do app antes do estágio final:

```dockerfile
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web-participante/package.json apps/web-participante/
RUN npm ci -w apps/web-participante
COPY apps/web-participante apps/web-participante
COPY tsconfig.base.json ./
RUN npm run build -w apps/web-participante

FROM nginx:1.27-alpine
# A imagem oficial roda envsubst nos arquivos de /etc/nginx/templates na subida,
# gravando o resultado em /etc/nginx/conf.d. É assim que o segredo entra sem ficar na imagem.
COPY infra/nginx/arquivos.conf.template /etc/nginx/templates/arquivos.conf.template
# O default.conf da imagem tem `server_name localhost` e venceria o nosso por casar exatamente
# com o Host do pedido — o nosso serviço é o único que este container atende.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web-participante/dist /usr/share/nginx/html
```

O contexto do build passa a ser a raiz do repositório: em `docker-compose.dev.yml` e `docker-compose.vps.yml`, troque `build: { context: ./infra/nginx }` por:

```yaml
    build: { context: ., dockerfile: infra/nginx/Dockerfile }
```

Em `infra/nginx/arquivos.conf.template`, acrescente antes do `location = /health` o bloco que serve o app:

```nginx
    # O app é uma página só com rotas em hash (#/e/slug): qualquer caminho cai no index.
    location / {
        root /usr/share/nginx/html;
        try_files $uri $uri/ /index.html;
    }
```

`apps/web-participante/.dockerignore`:

```
node_modules
dist
```

- [ ] **Step 2: Subir e conferir**

Run:

```bash
docker compose -f docker-compose.dev.yml up -d --build arquivos
curl -s -o /dev/null -w '%{http_code}\n' localhost:8080/
curl -s localhost:8080/ | grep -o '<title>[^<]*</title>'
```

Expected: `200` e `<title>Suas fotos do evento</title>`. Se vier 404, confira se o `dist` foi copiado — o build roda dentro da imagem, então `npm run build` local não é necessário.

- [ ] **Step 3: Provar o caminho inteiro no navegador**

Com o compose completo no ar (`docker compose -f docker-compose.dev.yml --profile gpu up -d --build`):

```bash
npm run demo-evento -- --fotos <pasta com fotos> --selfie <uma selfie.jpg>
```

O comando imprime o slug do evento. Abra `http://localhost:8080/#/e/<slug>` no navegador (ou pelo IP da máquina, no celular, que é o teste de verdade), autorize a câmera, marque o consentimento, tire a selfie e confira:

Expected:
- a câmera abre com a moldura oval, e o disparo só funciona depois do visto;
- depois do disparo, "Buscar minhas fotos (1)" leva para "Procurando você";
- a tela de resultado mostra as fotos com o selo de semelhança na primeira;
- tocar numa foto abre em tela cheia; "Salvar" baixa o arquivo;
- "Baixar todas (ZIP)" vira "Preparando…" e depois oferece o arquivo;
- negar a permissão da câmera (recarregue e recuse) mostra o caminho da galeria, nunca uma tela preta.

- [ ] **Step 4: Documentar**

Em `docs/desenvolvimento.md`, acrescente ao fim:

```markdown
## Tela do participante

Em desenvolvimento, com recarregamento automático:

```bash
npm run dev -w apps/web-participante     # http://localhost:5173
```

O Vite já encaminha `/api` para a API (3002) e `/arquivos` para o nginx (8080), então a tela
funciona na mesma origem. Para testar no celular, abra o endereço que o Vite imprime para a
rede local — a câmera exige contexto seguro, então use `localhost` no computador ou HTTPS no
celular.

Servida como em produção (build dentro da imagem do nginx):

```bash
docker compose -f docker-compose.dev.yml up -d --build arquivos   # http://localhost:8080
```

Para ter um evento com fotos, rode antes `npm run demo-evento` (ver acima) e abra
`http://localhost:8080/#/e/<slug>`.
```

- [ ] **Step 5: Verificação final**

Run:

```bash
npm run test -w apps/web-participante
npm run typecheck -w apps/web-participante
npm run test && npm run test:integracao && npm run typecheck
git status --short
```

Expected: tudo PASS (a suíte da API não muda nesta fase) e `git status` sem sobras.

- [ ] **Step 6: Commit**

```bash
git add infra/nginx docker-compose.dev.yml docker-compose.vps.yml docs/desenvolvimento.md apps/web-participante/.dockerignore
git commit -m "feat(web): servir a tela do participante pelo nginx" -m "Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Cobertura do spec

| Item do spec do app | Task |
|---|---|
| §2 Identidade Largada (paleta, pílulas, cantos, tipografia, fonte do sistema, sem modo escuro) | 1, 3 |
| §3.1 Entrada pela câmera, moldura oval, consentimento obrigatório, galeria, permissão negada | 4 |
| §3.1 Redução da selfie para 1280 px antes de enviar | 1, 4 |
| §3.2 Tela "Procurando você" com a selfie e o total de fotos | 5 |
| §3.3 Resultado: grade de 2 colunas, selo só na primeira, ZIP, buscar de novo, validade | 6 |
| §3.4 Foto aberta: tela cheia, Salvar, Compartilhar com `navigator.share` | 6 |
| §3.5 Zero fotos sem pedir nada | 6 |
| §3.6 Privacidade (termo versionado) e galeria do anfitrião | 1, 7 |
| §4 Estados de erro (selfie recusada, limite de IP, evento não encontrado, token vencido, rede) | 2, 5, 6 |
| §5 Arquitetura: pastas por tela, `state`/`actions`, axios `{ call }`, sem store global | 1–7 |
| §5 Consentimento de marketing enviado como "N" enquanto não há tela de verificação | 4 |
| §5 Onde mora e como sobe (workspace, Vite, build servido pelo nginx) | 1, 8 |
| §7 Testes: Vitest para puro, Vue Test Utils para telas, teste manual documentado | 1–8 |

**Não implementado de propósito:** a spec do app (§4) prevê que, ao estourar o limite de buscas
por IP, o botão fique desabilitado por 30 segundos. O plano mostra só a mensagem da API (que já
diz "Tente de novo em alguns minutos"): detectar esse caso exigiria comparar texto de mensagem,
que quebra na primeira vez que alguém reescrever a frase no servidor. Se o bloqueio visual fizer
falta, a API passa a devolver um código junto da mensagem e a tela reage a ele.

**Fora deste plano:** verificação por WhatsApp (parte 2 da fase 4, via Chatwoot), faixa de patrocinadores com dados reais (a API é da parte 2 — o componente já existe e fica invisível com lista vazia), `web-fotografo` (fase 5) e `web-admin` (fase 7).
