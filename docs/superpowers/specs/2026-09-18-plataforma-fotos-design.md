# Plataforma de entrega de fotos por reconhecimento facial — design

Data: 2026-09-18
Status: aguardando revisão do usuário

## 1. Objetivo

Entregar ao participante de um evento (esportivo ou social), pelo celular e sem app, todas as fotos em que ele aparece, a partir de uma selfie. As fotos ficam disponíveis **durante** o evento, poucos minutos depois de o fotógrafo enviá-las.

Caso de referência: corrida de rua de 2 dias, dezenas de fotógrafos, ~20.000 fotos, milhares de participantes.

A plataforma também transforma o participante em **lead verificado**. Ele confirma o WhatsApp para liberar as fotos. Isso gera métricas de engajamento por evento para o organizador e os patrocinadores.

Inspiração: focoradical.com.br. Diferença de modelo: aqui a entrega é **gratuita**; a cobertura é paga pelo organizador ou pelo patrocinador.

## 2. Decisões de produto

| Tema | Decisão |
|---|---|
| Modelo de negócio | Entrega gratuita. Sem carrinho, pagamento ou comissão. |
| Tipos de evento | `esportivo` e `social`. O tipo só define os padrões iniciais do `config`. |
| Operação | Operador único (o dono da plataforma). Sem multi-tenant. |
| Evento privado | Acesso por link secreto (`/p/<chave>`). Quem tem o link entra. |
| Anfitrião | Segundo link secreto por evento (`/a/<chave>`): galeria completa e ZIP. |
| Lead | Verificação por WhatsApp **iniciada pelo participante**, com código de 5 dígitos. Configurável por evento (`exigir_whatsapp`). |
| Filtro por horário | Não existe. A busca traz todas as fotos do evento. |
| Topologia | **Estação** local com GPU, ligada só durante o evento, e **VPS** sempre ligada. |
| Arquivos públicos | Na VPS, em disco, servidos pelo nginx com link assinado. A interface de armazenamento permite trocar por S3/R2 depois. |
| Resolução entregue | 2048 px no lado maior. Suficiente para feed, Stories e Facebook. |
| Retenção | 90 dias após `data_fim` (configurável por evento). O expurgo apaga fotos, rostos, buscas e vínculos. Ficam só os leads com consentimento de marketing e as contagens. Os originais ficam na estação. |
| Calibração do limiar | Tela no admin, sem script com planilha. |
| Borda | Traefik próprio em cada compose. Na estação, Cloudflare Tunnel (só fotógrafo e painel); na VPS, proxy da Cloudflare. |

### Mudanças em relação ao prompt original

O prompt inicial foi gerado por um agente de voz. Estas decisões o substituem:

- Express no lugar de Fastify, seguindo o padrão do `erp_server`.
- Dois servidores (estação e VPS) no lugar de um só.
- Disco da VPS no lugar do R2.
- Três SPAs no lugar de dois; o admin ganhou o seu.
- Schema no padrão do usuário (tabelas no singular, PK `id_<tabela>`) no lugar de uuid e plural.
- Tela de calibração no lugar de `scripts/calibrar-limiar.ts`.
- Filtro por janela de horário removido.
- Download como chamada RPC que devolve link assinado, sem rota `GET /download/:id`.

## 3. Arquitetura

```
ESTAÇÃO (local, GPU)                            VPS (sempre ligada)
liga para o evento, desliga depois              atende o público por 90 dias
┌──────────────────────────────────┐           ┌──────────────────────────────────┐
│ web-fotografo                    │           │ web-participante                 │
│   upload + painel da estação     │           │   selfie, resultados, anfitrião  │
│ api (PAPEL=estacao)              │           │ web-admin                        │
│ worker: hash → original →        │  publica  │ api (PAPEL=vps)                  │
│   rostos (GPU) → derivados →     │ ────────▶ │ worker: WhatsApp, ZIP, expurgo   │
│   publicar                       │           │ vision (MODO=selfie-cpu)         │
│ vision (MODO=gpu)                │ ◀──────── │ postgres (pgvector) + redis      │
│ postgres (pgvector) + redis      │  sincroniza│ /data/fotos (web, thumb, prévia) │
│ /data/originais                  │  eventos  │ nginx: links assinados           │
└──────────────────────────────────┘           └──────────────────────────────────┘
        ▲ LAN ou Cloudflare Tunnel                     ▲ proxy Cloudflare
    fotógrafos e operador                         participantes, anfitriões, operador
```

### Papéis

- **Estação:**
  - recebe os uploads e guarda os originais;
  - detecta rostos na GPU e gera as versões comprimidas;
  - publica cada foto pronta na VPS.
  - Não atende o público. Pode ser desligada depois que o evento é encerrado nela.
- **VPS:** fonte da verdade de eventos, fotógrafos, operador, participantes, leads e buscas. Atende toda a parte pública, por 90 dias, sem depender da estação.

### Containers

| Container | Estação | VPS | Função |
|---|---|---|---|
| `traefik` | sim | sim | Roteamento por host/caminho |
| `cloudflared` | sim | não | Túnel para acesso remoto de fotógrafos e operador |
| `web` (nginx) | web-fotografo | web-participante, web-admin, `/arquivos` | SPAs estáticos. Na VPS também serve as imagens com `secure_link` |
| `api` | `PAPEL=estacao` | `PAPEL=vps` | Mesmo código; cada papel monta só as suas áreas |
| `worker` | `processar-foto`, `publicar-foto`, `sincronizar` | `whatsapp`, `zip`, `expurgo`, `manutencao` | BullMQ |
| `vision` | `MODO=gpu` | `MODO=selfie-cpu` | Mesma imagem Python |
| `postgres` | sim | sim | PostgreSQL 16 + pgvector (≥ 0.8, para busca iterativa) |
| `redis` | sim | sim | Filas, limites de taxa |

### Sincronização

- **VPS → estação** (job `sincronizar`, quando a estação sobe e depois a cada 60 s): a estação chama `_ESTACAO/sincronizacao.getSincronizacao` e recebe operadores (login e hash da senha), eventos ativos com `config` e URL da marca d'água, fotógrafos e vínculos com tokens. Tudo é gravado na estação com **os mesmos IDs** da VPS (upsert por PK).
- **Estação → VPS, fotos** (fila `publicar-foto`): `_ESTACAO/foto.publicarFoto`, multipart com um JSON (dados + rostos) e três arquivos. A VPS faz upsert por `(id_evento, hash_arquivo)` e é idempotente.
- **Estação → VPS, sinal** (a cada 30 s): `_ESTACAO/sinal.registrarSinal` com o tamanho da fila por etapa, fotos por minuto, erros, latência e VRAM.
- **Autenticação estação → VPS:** header `Authorization` com `ESTACAO_CHAVE` (segredo longo, igual nos dois `.env`), sobre HTTPS.

## 4. Padrões de código

### Backend: padrão do `erp_server`

- Node 22, TypeScript `strict`, CommonJS, Express 5, npm. Imports relativos, sem alias.
- Um módulo por pasta: `route.<m>.ts` (Router fino), `ctrl.<m>.ts` (regra de negócio), `sql.<m>.ts` (só SQL), `i.<m>.ts` (interfaces com prefixo `i`) e `<m>.http` (exemplos em REST Client).
- Áreas por cliente:
  - estação: `_FOTOGRAFO`, `_PAINEL`;
  - VPS: `_PARTICIPANTE`, `_ANFITRIAO`, `_ADMIN`, `_ESTACAO`.
- **RPC:** `POST /api/<area>/<modulo>` com `{ call, ... }`, passando por um despachante central `per`. O `per`:
  1. monta o contexto de autenticação;
  2. instancia o Router e chama `init()`;
  3. executa `route[call](req)`;
  4. serializa o retorno;
  5. fecha a conexão no `finally`.
- **Multipart** (selfies, publicação de foto, PNG de marca d'água) usa `express-fileupload` com `call` como campo do formulário. Continua sendo RPC.
- **Exceções ao RPC:**
  - `PUT /api/fotografo/upload/:id_upload`: pedaço binário;
  - `GET|POST /api/whatsapp/webhook`: formato fixo da Meta;
  - `GET /test`: healthcheck.
- **Banco:** `pg` com SQL à mão, placeholders `?` e wrapper `ConexaoPostgres` (`open`, `openTransaction`, `queryParam`, `queryOneParam`, `executeParamCount`, `commit`, `rollback`, `close`). Um banco por papel, sem pool por tenant.
- **Erros:** o erro de negócio é devolvido como `{ msg, error: true }`; `ErroTratado` para erro exibível; o resto vira 500 `{ msg }`. Mensagens em português.
- **Configuração:** `loadEnv.ts` (dotenv) + `services/config.ts` (objeto único). Diferença do `erp_server`: variáveis obrigatórias do papel faltando fazem a aplicação **falhar na inicialização**.
- **Log:** `console.log`/`console.error` com prefixo `[Componente]`, em português.
- **Testes:** `node:test` + `node:assert` via `tsx --test`, ao lado do código (`<nome>.test.ts`). Testes com banco real ficam em `integracao/`.
- **Migrations:** runner próprio em `db/migrate.ts`.
  - Arquivos `db/migrations/AAAAMMDDHHMMSS_nome.sql` com `-- migrate:up` / `-- migrate:down`.
  - Diretiva `-- migrate:target estacao|vps|ambos`.
  - Controle na tabela `schema_migrations`.
  - DDL idempotente.
- **Não replicar:** senha em texto puro (aqui é `scrypt` do `node:crypto`), `.env` com credenciais no git.

### Frontend: padrão do `erp_admin_v2`, com Tailwind

- Vue 3.5, Vite atual, TypeScript `strict`, `<script setup lang="ts">`.
- Rotas por pasta com `vite-plugin-pages` e `createWebHashHistory`. Se o plugin não for compatível com o Vite atual, usar `unplugin-vue-router` com a mesma convenção de pastas.
- Tela = `pages/<tela>/index.vue` (template + `nextTick(() => actions.init())`) + `<tela>.ts` (`export const state = reactive({...})`, `export const actions = {...}`) + `interfaces.ts` + `components/`. Componentes locais importam o `state` do pai.
- axios global, `{ call }`, token cru no header `Authorization`. SweetAlert2 para erros e confirmações.
- **Tailwind 4 + daisyUI 5** no lugar do Vuetify, com as cores do tema do `erp_admin_v2` (`primary #32135e`, `secondary #ff3860`, `info #00d1b2`, `background #e4ebf3`; dark `primary #8dbfda`). Modo escuro pela classe `.dark` no `<html>`.
- Sem xGridV2/xModal/xTable: as telas são poucas e simples, e o participante usa celular.
- Tudo em português. Comentários só para o porquê não óbvio.

### Repositório (npm workspaces)

```
.
├── docker-compose.estacao.yml
├── docker-compose.vps.yml
├── docker-compose.dev.yml           # os dois papéis numa máquina só
├── .env.estacao.example
├── .env.vps.example
├── apps/
│   ├── api/                         # Express + workers, dois papéis
│   ├── vision-service/              # Python (fora dos workspaces npm)
│   ├── web-fotografo/               # estação: upload + painel
│   ├── web-participante/            # VPS
│   └── web-admin/                   # VPS
├── packages/shared/                 # só tipos TS (import type)
├── db/
│   ├── migrate.ts
│   └── migrations/
├── infra/                           # nginx, traefik, cloudflared
├── scripts/
│   └── benchmark-pipeline.ts
└── docs/
```

## 5. Modelo de dados

Convenções:
- tabelas no singular, snake_case em português;
- PK `id_<tabela>`;
- flags `varchar(1)` `'S'/'N'`;
- `timestamptz` para instantes.

### 5.1 VPS

```
operador            id_operador serial PK, nome varchar(100), login varchar(60) UNIQUE,
                    senha_hash varchar(200), deletado varchar(1) 'N', criado_em

evento              id_evento serial PK, nome varchar(150), slug varchar(80) UNIQUE,
                    tipo varchar(20) CHECK (esportivo|social),
                    privado varchar(1) 'N', chave_acesso varchar(40) UNIQUE NULL,
                    chave_anfitriao varchar(40) UNIQUE NOT NULL,
                    data_inicio date, data_fim date NOT NULL, ativo varchar(1) 'S',
                    config jsonb '{}', expurgado_em timestamptz NULL,
                    deletado varchar(1) 'N', criado_em, updated_at

fotografo           id_fotografo serial PK, nome varchar(100), telefone varchar(20),
                    deletado varchar(1) 'N', criado_em
evento_fotografo    id_evento_fotografo serial PK, id_evento FK, id_fotografo FK,
                    token_upload varchar(40) UNIQUE, ativo varchar(1) 'S', criado_em,
                    UNIQUE (id_evento, id_fotografo)

foto                id_foto serial PK, id_evento FK CASCADE, id_evento_fotografo FK NULL,
                    hash_arquivo varchar(64), largura int, altura int, bytes_web int,
                    capturada_em timestamptz NULL, camera varchar(80) NULL,
                    qtd_rostos int, publicada_em timestamptz,
                    UNIQUE (id_evento, hash_arquivo)
rosto               id_rosto bigserial PK, id_foto FK CASCADE, id_evento FK CASCADE,
                    embedding vector(512), bbox jsonb, det_score real, area_px int
numero_peito        id_numero_peito bigserial PK, id_foto FK CASCADE, id_evento FK CASCADE,
                    numero varchar(20), confianca real, bbox jsonb      -- vazia até a Fase 2

participante        id_participante serial PK, telefone varchar(20) UNIQUE (E.164),
                    nome_whatsapp varchar(100), criado_em
participante_evento id_participante_evento serial PK, id_participante FK CASCADE,
                    id_evento FK CASCADE, aceita_marketing varchar(1) 'N',
                    primeira_verificacao timestamptz, UNIQUE (id_participante, id_evento)
aparelho            id_aparelho serial PK, id_participante_evento FK CASCADE,
                    chave_hash varchar(64) UNIQUE, criado_em

busca               id_busca serial PK, id_evento FK CASCADE, token varchar(40) UNIQUE,
                    codigo varchar(5) NULL, status varchar(20) CHECK (aguardando|liberada|expirada),
                    qtd_fotos int, qtd_downloads int 0,
                    consentimento_em timestamptz NOT NULL, versao_termo varchar(20) NOT NULL,
                    aceita_marketing varchar(1) 'N', id_participante FK NULL,
                    criado_em, verificada_em NULL, codigo_expira_em NULL
busca_foto          id_busca FK CASCADE, id_foto FK CASCADE,
                    id_rosto bigint NULL  -- rosto do melhor match, usado na exclusão LGPD
                    , similaridade real, PK (id_busca, id_foto)

arquivo_zip         id_arquivo_zip serial PK, id_evento FK CASCADE, id_busca FK NULL CASCADE,
                    parte int 1, status varchar(20) CHECK (pendente|pronto|erro),
                    qtd_fotos int, bytes bigint, criado_em, expira_em
calibracao          id_calibracao serial PK, id_evento FK CASCADE, rotulo varchar(60),
                    amostras jsonb, criado_em  -- amostras: [{similaridade, correta}], sem imagem nem vetor
evento_resumo       id_evento PK FK, qtd_fotos, qtd_buscas, qtd_buscas_com_resultado,
                    qtd_verificados, qtd_leads_marketing, qtd_downloads, qtd_zips, congelado_em
estacao_sinal       id_estacao_sinal serial PK, recebido_em timestamptz, dados jsonb
log                 id_log serial PK, id_operador FK NULL, tela varchar(60), log text, criado_em
```

Índices:
- `ix_rosto_embedding` HNSW (`vector_cosine_ops`, `m=16`, `ef_construction=200`);
- `ix_rosto_foto (id_foto)`;
- `ix_numero_peito_evento (id_evento, numero)`;
- `ux_busca_codigo_aguardando` UNIQUE (`codigo`) `WHERE status = 'aguardando'`;
- `ix_busca_evento (id_evento)`.

Os caminhos dos arquivos não ficam no banco. Eles são derivados de `id_evento` e `hash_arquivo`: `/data/fotos/<id_evento>/<hash>_web.jpg`, `_thumb.jpg`, `_previa.jpg`.

Chaves do `evento.config`:

| Chave | Padrão | Observação |
|---|---|---|
| `limiar` | 0.42 | |
| `exigir_whatsapp` | esportivo `true`, social `false` | |
| `marca_dagua` | `false` | O PNG fica em `/data/marcas/<id_evento>.png` |
| `organizador` | nome do evento | Usado no texto de marketing |
| `dias_expurgo` | 90 | |
| `validade_resultado_dias` | `null` | `null` = até o expurgo |
| `max_selfies` | 3 | |

`privado` padrão: esportivo `'N'`, social `'S'`.

### 5.2 Estação

```
operador, evento, fotografo, evento_fotografo   -- cópias da VPS, mesmos IDs
                                                -- (evento ganha encerrado_em local)
upload              id_upload serial PK, id_evento_fotografo FK, nome_arquivo varchar(255),
                    tamanho bigint, hash_arquivo varchar(64), bytes_recebidos bigint 0,
                    status varchar(20) CHECK (recebendo|completo|cancelado),
                    criado_em, updated_at
foto                id_foto serial PK, id_evento FK, id_evento_fotografo FK NULL,
                    hash_arquivo varchar(64), nome_arquivo varchar(255), caminho_original text,
                    largura int, altura int, bytes_original bigint, bytes_web int,
                    capturada_em timestamptz NULL, camera varchar(80) NULL, qtd_rostos int,
                    etapa varchar(20) CHECK (registrada|original|rostos|derivados|publicada),
                    erro text NULL, erro_etapa varchar(20) NULL,
                    criado_em, processada_em NULL, publicada_em NULL,
                    UNIQUE (id_evento, hash_arquivo)
rosto               igual à VPS, SEM índice HNSW (a estação não busca)
numero_peito        igual à VPS (Fase 2)
```

## 6. vision-service (Python 3.11, FastAPI, InsightFace `buffalo_l`, onnxruntime)

### Modos (`VISION_MODO`)

- **`gpu` (estação):** carrega detecção e reconhecimento com `CUDAExecutionProvider`. Na inicialização, confere o provider ativo de cada sessão ONNX. Se algum não estiver em CUDA, **encerra com erro** e diz no log o motivo. Roda um processo por GPU (uvicorn com 1 worker).
- **`selfie-cpu` (VPS):** carrega os mesmos modelos com `CPUExecutionProvider`, declarado explicitamente, e expõe só `/embed-selfie` e `/health`. A concorrência é limitada por semáforo (`SELFIE_CONCORRENCIA`, padrão = núcleos − 1).

### Rotas

**`POST /detect`** `{ caminhos: string[] }` → por imagem:

```
{ caminho, largura, altura, erro?,
  rostos: [{ embedding: number[512], bbox: [x1,y1,x2,y2], det_score, kps: [[x,y]×5], area_px }] }
```

- O `embedding` é o `normed_embedding`.
- As coordenadas estão na resolução original, **depois** da rotação EXIF.
- Um erro em uma imagem (arquivo corrompido, formato inválido) sai no campo `erro` dela e não derruba o lote.

**`POST /embed-selfie`** `{ caminho }` → `{ embedding, det_score, largura_rosto, nitidez }`, ou 422 `{ codigo, msg }` com a mensagem em português pronta para o participante:
- `sem_rosto`
- `varios_rostos`: um segundo rosto com área ≥ 40% da do maior
- `baixa_confianca`: `det_score < SELFIE_DET_SCORE_MIN`, padrão 0.6
- `rosto_pequeno`: lado < `SELFIE_ROSTO_MIN_PX`, padrão 80
- `borrada`: variância do Laplaciano no recorte do rosto < `SELFIE_NITIDEZ_MIN`

A selfie usa `det_size` 640.

**`GET /health`** → modo, providers ativos, modelo carregado, VRAM usada/total e utilização (pynvml no modo GPU), fila do micro-lote.

### Processamento no modo GPU

- **Decodificação:** PyTurboJPEG num `ThreadPoolExecutor` (`VISION_DECODE_THREADS`), com `scaling_factor` para decodificar já reduzido. Escolhe o maior fator que mantém o lado maior ≥ `VISION_DECODE_MIN_LADO` (padrão 2048). A decodificação da próxima leva corre em paralelo com a inferência da atual.
- **Rotação EXIF:** aplicada antes da detecção.
- **Micro-lote:** as requisições entram numa fila `asyncio`. O lote é disparado com `VISION_LOTE_MAX` imagens (padrão 16) ou depois de `VISION_LOTE_ESPERA_MS` (padrão 20 ms). Cada requisição recebe o seu resultado por um future.
- **Detecção:** `det_size` = `VISION_DET_SIZE` (padrão 1024×1024).
- **Reconhecimento:** em lote, com os recortes alinhados de todas as imagens do micro-lote.
- **Filtros:** descarta rostos com lado menor que `VISION_ROSTO_MIN_PX` (padrão 40, medido na resolução original) ou `det_score < VISION_DET_SCORE_MIN` (padrão 0.5).
- **TensorRT FP16:** caminho atrás de `VISION_TENSORRT=true` (desligado), usando `TensorrtExecutionProvider` com cache de engine em volume.

### Risco conhecido: lote no detector

O `det_10g` do `buffalo_l` provavelmente foi exportado com lote fixo 1. O plano inicial:
1. o detector roda uma imagem por vez, com a decodificação paralela garantindo que a GPU não espere;
2. o reconhecimento roda em lote.

O benchmark da fase 2 mede isso. Se o detector for o gargalo, o modelo é re-exportado com lote dinâmico.

### Benchmark (`apps/vision-service/benchmark.py`)

- Entrada: uma pasta de fotos reais.
- Saída: fotos/s, tempo por etapa (decodificação, detecção, reconhecimento) e pico de VRAM.
- Compara lote 1/8/16 × `det_size` 640/1024.

## 7. Upload e pipeline (estação)

### Upload resumível

1. O navegador calcula o SHA-256 num Web Worker com `hash-wasm`, lendo o arquivo em pedaços. `crypto.subtle` não serve: ele não existe em `http://<ip-da-LAN>`. O hash vai para o IndexedDB junto com o estado do arquivo.
2. `_FOTOGRAFO/upload.iniciarUpload { nome_arquivo, tamanho, hash_arquivo }` → `{ situacao: 'ja_existe' | 'continuar' | 'novo', id_upload?, bytes_recebidos? }`. Arquivos que não são JPEG (pela extensão e pelos bytes mágicos, conferidos no primeiro pedaço) são recusados com mensagem.
3. `PUT /api/fotografo/upload/:id_upload`, com header `Upload-Offset` e corpo binário de até 8 MB (`UPLOAD_PEDACO_MB`). A estação anexa ao arquivo `/data/uploads/<id_upload>.part` se o offset for igual a `bytes_recebidos`. Se não for, responde 409 com o offset correto.
4. No último pedaço, a estação recalcula o SHA-256 em stream. Se bater, marca o upload como `completo` e enfileira `processar-foto`. Se não bater, apaga o arquivo e responde com erro, e o navegador reenvia do zero.
5. `_FOTOGRAFO/upload.statusUpload` → contagens do fotógrafo no evento (na fila, processadas, publicadas, com erro).

No cliente: concorrência configurável (padrão 3), até 6 tentativas com espera exponencial (1 s → 32 s), botões de pausar e retomar. A lógica da fila fica num módulo TS puro, sem Vue, testado com `node:test`.

### Job `processar-foto`

- `jobId = <id_evento>:<hash>`, o que garante idempotência.
- `attempts` 5, espera exponencial.
- Cada etapa confere `foto.etapa` e pula o que já foi feito.

| Etapa | Ação |
|---|---|
| registrada | `INSERT ... ON CONFLICT (id_evento, hash_arquivo) DO NOTHING`. Se já existe e está `publicada`, encerra. |
| original | Move (upload) ou copia (CLI) para `/data/originais/<slug>/<AAAA-MM-DD>/<hash>.jpg`. A data vem do EXIF ou, sem ele, da data do upload. Lê o EXIF com `exifr`: `DateTimeOriginal` + `OffsetTimeOriginal` (sem offset, usa o fuso do evento, padrão `America/Sao_Paulo`), `Make`/`Model`, dimensões. |
| rostos | `vision /detect`. Numa transação: `DELETE` dos rostos da foto, `INSERT` dos novos e `qtd_rostos`. |
| derivados | sharp com `.rotate()`, sem `withMetadata`. Gera web (2048 px `fit:inside`, JPEG q82, progressivo, mozjpeg), thumb (400 px, q70) e prévia (32 px, blur forte). Aplica a marca d'água (composite do PNG do evento) na web e no thumb se `config.marca_dagua`. Grava em `/data/publicar/<id_evento>/<hash>_{web,thumb,previa}.jpg`. |
| publicada | Marcada pelo job `publicar-foto`. |

- Depois de `derivados`, o job enfileira `publicar-foto` com o mesmo `jobId`.
- **Falhas definitivas** (JPEG corrompido, erro do vision na própria imagem): `UnrecoverableError`, com `erro` e `erro_etapa` gravados.
- **Falhas passageiras:** esgotadas as tentativas, também gravam o erro.
- **Reprocessar** (painel): limpa o erro e reenfileira.
- Fotos sem rosto seguem o pipeline normalmente.

### Job `publicar-foto`

- Fila separada, concorrência 4, tentativas ilimitadas com espera exponencial até 5 min. Uma VPS fora do ar não trava a GPU.
- Envia `publicarFoto` com o JSON da foto + rostos + 3 arquivos.
- Com resposta OK, grava `etapa = publicada` e `publicada_em`, e apaga `/data/publicar/...`.

### Concorrência e CPU

- `processar-foto`: `WORKER_CONCORRENCIA` (padrão 16). A maior parte do tempo é espera pelo vision.
- Etapa `derivados`: limitada por semáforo em `SHARP_CONCORRENCIA` (padrão núcleos − 2) e `sharp.concurrency(1)` por tarefa. Isso preserva CPU para a decodificação do vision e para a API.

### CLI de ingestão

`npm run ingerir -- --evento <slug> --pasta <dir> [--fotografo <id_evento_fotografo>]`

Varre os JPEGs da pasta, calcula o hash e enfileira o mesmo `processar-foto`, com origem = caminho do arquivo e `copiar = true`. Serve para testes e para cartões de memória ou HDs entregues por fotógrafos.

### Encerramento do evento na estação

`_PAINEL/evento.encerrarEvento`:
- só é permitido quando nenhuma foto está em andamento (todas `publicada` ou com `erro`). Se houver fotos com erro, o painel mostra quantas e pede confirmação;
- apaga os `rosto` locais do evento e grava `encerrado_em`;
- os originais permanecem.

### Métricas (painel e sinal)

- fotos publicadas por minuto (janelas de 1, 5 e 15 min);
- contagem da fila por etapa (BullMQ `getJobCounts` + `foto.etapa`);
- taxa de erro;
- latência entre `criado_em` e `publicada_em` (p50 e p95 dos últimos 30 min);
- VRAM.

### `scripts/benchmark-pipeline.ts`

Ingere uma pasta num evento de teste e reporta a vazão de ponta a ponta e a latência por etapa, até a publicação na VPS.

## 8. Busca, verificação e entrega (VPS)

### Acesso

As rotas são de hash router:

| Rota | Quem |
|---|---|
| `/#/e/<slug>` | evento público |
| `/#/p/<chave_acesso>` | evento privado |
| `/#/a/<chave_anfitriao>` | anfitrião |
| `/#/r/<token>` | resultados |

Evento privado nunca é acessível pelo slug.

### Busca: `_PARTICIPANTE/busca.buscar` (multipart)

**Entrada:** `slug` ou `chave_acesso`, 1 a `max_selfies` arquivos, `versao_termo`, `aceita_marketing`, `chave_aparelho?`.

**Passos:**
1. **Limite de taxa:** Redis, `BUSCA_LIMITE_IP` por 10 min (padrão 10). O IP vem de `CF-Connecting-IP`, e só é confiado quando `CONFIAR_CLOUDFLARE=true`.
2. **Selfies:** gravadas em `/data/selfies`, um volume **tmpfs** compartilhado entre `api` e `vision`. O navegador já as envia reduzidas a 1280 px (canvas, com `createImageBitmap` respeitando a orientação).
3. **Embedding:** `vision /embed-selfie` para cada uma, com tempo máximo de espera de 20 s. Se estourar, responde "Muita gente buscando agora, tente em instantes".
4. **Descarte:** apaga as selfies no `finally`. Se todas foram rejeitadas, devolve os motivos.
5. **Consulta por embedding:**

   ```sql
   BEGIN;
   SET LOCAL hnsw.ef_search = 100;
   SET LOCAL hnsw.iterative_scan = relaxed_order;
   SELECT r.id_foto, r.id_rosto, 1 - (r.embedding <=> ?::vector) AS similaridade
     FROM rosto r
    WHERE r.id_evento = ?
    ORDER BY r.embedding <=> ?::vector
    LIMIT 400;
   COMMIT;
   ```

   A busca iterativa mantém o recall com vários eventos no mesmo índice. O plano B, documentado em `docs/`, é um índice parcial por evento (`CREATE INDEX ... WHERE id_evento = N`) criado na abertura do evento.
6. **Agrupamento:** `agruparResultados(listas, limiar)`, função pura. Une as listas, fica com a maior similaridade por foto (guardando o `id_rosto` desse melhor match), filtra por `>= limiar` e ordena por similaridade desc (desempate por `id_foto` asc).
7. **Gravação:** grava `busca` + `busca_foto`. Os embeddings das selfies existem só na memória da requisição.
8. **Status inicial:**
   - `liberada` se o evento não exige WhatsApp ou se `chave_aparelho` for válida para o evento. Nesse caso liga `id_participante`.
   - Senão `aguardando`, com `codigo` de 5 dígitos aleatório, único entre as buscas aguardando (nova tentativa em caso de colisão), expirando em 30 min.

**Resposta:** `{ token, status, qtd_fotos, previas: [urls assinadas], codigo?, whatsapp_numero? }`. Com `status = aguardando`, nenhum thumb nem web é exposto.

### Verificação pelo WhatsApp (Cloud API oficial)

- **O que a tela mostra:** "Encontramos N fotos suas", as prévias borradas, o checkbox opcional de marketing (com o nome do `organizador`) e o botão que abre `https://wa.me/<numero>?text=Quero minhas fotos · código <codigo>`.
- **Como a página descobre a liberação:** chama `_PARTICIPANTE/busca.situacao { token }` a cada 3 s, por até 30 min.
- **`GET /api/whatsapp/webhook`:** verificação da Meta (`hub.verify_token`).
- **`POST /api/whatsapp/webhook`:** valida `X-Hub-Signature-256` (HMAC com o app secret), responde 200 na hora e enfileira `whatsapp`. O worker interpreta a mensagem:
  - **5 dígitos:** busca `aguardando` com esse código e não expirada. Então:
    1. upsert de `participante` (telefone = `wa_id`, nome do perfil);
    2. upsert de `participante_evento` (aceita_marketing da busca, `OR` com o valor existente);
    3. busca `liberada`, com `verificada_em`;
    4. gera a `chave_aparelho` (guarda o hash em `aparelho`), entregue à página **uma única vez**, na primeira consulta de `situacao` depois da liberação;
    5. responde no chat: "Pronto, <nome>! Suas N fotos de <evento>: <link /r/token>".
  - **Código inexistente ou expirado:** resposta explicando como buscar de novo.
  - **`SAIR`:** marca `aceita_marketing = 'N'` em todos os eventos do telefone e confirma.
  - **`EXCLUIR`:** pede confirmação. **`EXCLUIR SIM`** executa a exclusão (seção 10) e confirma.
  - **Qualquer outra mensagem:** texto de ajuda com o link do evento mais recente do telefone, se houver.
- **Custo:** todas as respostas são texto livre dentro da janela de 24 h aberta pelo participante, sem template e sem custo. O aviso de ZIP pronto também cabe na janela.
- **Expiração dos códigos:** o job `manutencao` roda a cada minuto e marca como `expirada` as buscas `aguardando` com `codigo_expira_em` vencido. Isso libera o código para reuso.

### Resultados: `_PARTICIPANTE/resultado`

- `getResultado { token }`: dados do evento, validade e lista de fotos com thumbs assinados. Só funciona para busca `liberada` e dentro da validade.
- `gerarLinks { token, ids, tipo: 'web' }`: URLs assinadas de download (`?dl=1` → `Content-Disposition: attachment`). Incrementa `busca.qtd_downloads`.
- `pedirZip { token }`: cria `arquivo_zip` e enfileira `zip`. `situacaoZip` para acompanhar.
- **Botão principal no celular: "Salvar / Compartilhar",** com `navigator.share({ files })` quando `canShare` aceita. Senão, cai para download individual.

### Links assinados (nginx `secure_link`)

- Formato: `/arquivos/<id_evento>/<hash>_<tipo>.jpg?md5=<base64url>&expires=<epoch>`, com `secure_link_md5 "$secure_link_expires$uri <ARQUIVO_SEGREDO>"`.
- Validade: `ARQUIVO_LINK_VALIDADE_S` (padrão 3600).
- Os ZIPs seguem o mesmo esquema em `/arquivos/zips/...`.
- A geração da assinatura é uma função pura, testada contra o formato do nginx.
- A Cloudflare **não** faz cache dessas URLs.

### Anfitrião: `_ANFITRIAO/galeria`

- `getGaleria { chave, offset }`: `LIMIT 60 OFFSET ?`, ordenada por `capturada_em` e com filtro por fotógrafo.
- `pedirZip { chave, id_evento_fotografo? }`: ZIPs em partes de até 500 fotos.

### ZIP (worker `zip`)

- Stream com `archiver`, em modo *store*, sem recomprimir JPEG, de `/data/fotos` para `/data/zips/<id_evento>/<id_arquivo_zip>.zip`.
- Expira em 7 dias ou no expurgo, o que vier primeiro.
- Se a busca tem participante verificado, avisa pelo WhatsApp.

### Calibração do limiar (admin)

- **`_ADMIN/calibracao.buscarAmostra`** (multipart: evento, selfie, rótulo): mesma selfie → CPU → consulta, com limiar fixo de 0.25. Devolve as fotos com a similaridade. A selfie é descartada.
- **`salvarAmostra { id_evento, rotulo, amostras: [{ similaridade, correta }] }`:** grava em `calibracao`, sem imagem nem vetor.
- **`sugerirLimiar(amostras[][], { de: 0.30, ate: 0.60, passo: 0.02, beta: 2 })`:** função pura.
  - Para cada limiar, calcula precisão, recall e F2 (peso maior para recall).
  - Devolve a tabela e o limiar de maior F2.
  - O recall é relativo às fotos corretas encontradas acima de 0.25; as abaixo disso são invisíveis. Essa limitação é mostrada na tela.
- **`aplicarLimiar`:** grava em `evento.config.limiar`.

## 9. Frontends

### web-fotografo (estação)

Chama a API na mesma origem (`/api`). Funciona igual pelo IP da LAN e pelo túnel. `VITE_API_URL` é opcional.

| Tela | Conteúdo |
|---|---|
| `index` | Entra com `?t=<token_upload>` (o link ou QR gerado no admin) e guarda o token no `localStorage`. |
| `upload` | Arrastar e soltar dezenas de arquivos. Fila visual com progresso por arquivo e geral, contadores enviadas/processadas/na fila/com erro, pausar/retomar e concorrência ajustável. |
| `estacao` | Login do operador. Fila por etapa em tempo real (atualiza a cada 2 s), fotos/min, latência, erros com reprocessar, contadores por fotógrafo, GPU (VRAM e utilização), status da VPS e fotos aguardando publicação, botão encerrar evento. |

### web-participante (VPS), mobile-first

| Tela | Conteúdo |
|---|---|
| `e/[slug]`, `p/[chave]` | Consentimento → câmera (`getUserMedia`, `facingMode: 'user'`, moldura oval) ou galeria → 1 a 3 selfies → buscando → prévia + WhatsApp → resultados. |
| `r/[token]` | Grade de thumbs, seleção múltipla, salvar/compartilhar, baixar, baixar todas (ZIP), "disponível até dd/mm". |
| `a/[chave]` | Galeria do anfitrião. |
| `privacidade` | Termo completo, como excluir os dados, contato. |

### web-admin (VPS)

| Tela | Conteúdo |
|---|---|
| `login` | Login do operador. |
| `eventos` | Lista de eventos. |
| `eventos/[id]` | Dados e `config`, upload da marca d'água, links e QR codes (evento/privado, anfitrião), vínculo de fotógrafos com link e QR de upload. |
| `fotografos` | Cadastro. |
| `engajamento` | Por evento: buscas, buscas com resultado, verificados (telefones únicos), conversão (verificados ÷ buscas com resultado), downloads, ZIPs, leads com marketing, exportação CSV (nome, telefone, data, evento). Depois do expurgo, lê `evento_resumo`. |
| `calibracao` | Tela da seção 8. |
| `lgpd` | Busca por telefone → excluir; expurgar evento agora. |
| `estacao` | Último sinal, online se < 90 s, fila, fotos/min, erros. |
| `log` | Auditoria. |

## 10. LGPD

- **Consentimento biométrico:**
  - checkbox obrigatório antes da câmera;
  - texto versionado em `web-participante` (`versao_termo` gravado na busca);
  - o texto inicial é um rascunho e **precisa de revisão jurídica** antes do primeiro evento.
- **Consentimento de marketing:**
  - separado e opcional, por evento (organizador);
  - só quem aceitou entra no CSV;
  - `SAIR` revoga.
- **Selfie:**
  - fica em tmpfs e é apagada no `finally`;
  - o embedding nunca é persistido, nem em log;
  - selfies de calibração seguem a mesma regra.
- **Exclusão** (pelo WhatsApp `EXCLUIR SIM` ou pelo admin, por telefone):
  1. apaga os `rosto` apontados por `busca_foto.id_rosto` nas buscas liberadas da pessoa. São os rostos que bateram com a selfie dela. Assim ela não pode mais ser encontrada por selfie. As fotos continuam, porque nelas aparecem outras pessoas;
  2. apaga `busca` (e `busca_foto`), `aparelho`, `participante_evento` e `participante`;
  3. grava no `log` o evento de exclusão, sem o telefone (só o SHA-256 dele).
- **Expurgo** (job diário na VPS): para cada evento com `data_fim + dias_expurgo < hoje` e `expurgado_em` nulo:
  1. congela as contagens em `evento_resumo`;
  2. apaga os arquivos em `/data/fotos/<id_evento>` e `/data/zips/<id_evento>`;
  3. apaga `foto` (cascata: `rosto`, `numero_peito`, `busca_foto`), `busca`, `arquivo_zip`, `calibracao` e os `participante_evento` com `aceita_marketing = 'N'` (e os `aparelho` deles);
  4. apaga `participante` sem nenhum `participante_evento`;
  5. grava `expurgado_em`.

  O botão "expurgar agora" no admin roda o mesmo processo para um evento.
- **Estação:** os rostos locais são apagados no encerramento do evento. Os originais não são dado biométrico derivado e ficam como acervo do operador.
- **Abuso** (busca com a foto de outra pessoa): mitigado pela verificação por telefone, pelo limite por IP e pelo log. Não é impedido totalmente, e isso fica declarado no termo.

## 11. Deploy e operação

- **Estação (`docker-compose.estacao.yml`):**
  - `vision` com GPU (`deploy.resources.reservations.devices: nvidia`).
  - Volumes `/data/originais`, `/data/uploads`, `/data/publicar` e cache TensorRT.
  - `cloudflared` com `TUNEL_TOKEN`, publicando só `DOMINIO_ESTACAO`.
  - Acesso na LAN por `http://<ip>:<PORTA_LAN>`.
- **VPS (`docker-compose.vps.yml`):**
  - Traefik com certificado de origem da Cloudflare (SSL "Full (strict)").
  - Hosts: `DOMINIO_PARTICIPANTE` e `DOMINIO_ADMIN`. A API fica em `/api` nos dois hosts.
  - Volumes `/data/fotos`, `/data/zips`, `/data/marcas`, `/data/backups`, mais o volume `selfies` em tmpfs.
  - O firewall aceita 80/443 só dos IPs da Cloudflare (documentado, opcional).
- **Backup:** `pg_dump` diário da VPS em `/data/backups`, mantendo 7 dias. Cópia externa documentada como responsabilidade do operador.
- **Dev (`docker-compose.dev.yml`):**
  - os dois papéis na mesma máquina;
  - um Postgres com dois bancos (`fotos_estacao`, `fotos_vps`);
  - um Redis com prefixos distintos;
  - dois `vision` (GPU e selfie-cpu).
- **Documentação em `docs/`:** Cloudflare Tunnel, certificado de origem, criação do app WhatsApp Cloud API (número dedicado, verificação do Business, webhook), checklist pré-evento.

### Dimensionamento

A vazão real é definida no benchmark.

- **Meta:** p95 de latência upload → publicada < 10 min em regime normal, com 20.000 fotos em 2 dias.
- **Busca:** p95 < 5 s por selfie na VPS em carga normal.
- **VPS recomendada:** 4–8 vCPU, 8–16 GB de RAM, SSD ≥ 200 GB, franquia ≥ 2 TB/mês. Estimativa de tráfego de download: ~50 GB por evento de 5 mil participantes.

## 12. Testes

- **Funções puras** (`node:test`):
  - `agruparResultados`: união, máximo por foto, limiar exato (`>=`), empates, listas vazias;
  - `sugerirLimiar`: tabela, F2, amostras sem acertos;
  - lógica do offset do upload;
  - fila de upload do cliente: concorrência, backoff, pausa;
  - interpretação de mensagens do WhatsApp (código, SAIR, EXCLUIR, EXCLUIR SIM, texto livre);
  - assinatura de link no formato do nginx;
  - seleção de eventos para expurgo;
  - geração de código único.
- **Integração** (`integracao/`, banco real): consulta pgvector com dois eventos no mesmo índice, upsert de `publicarFoto` (idempotência), expurgo de um evento, exclusão por telefone.
- **vision-service** (pytest): rotação EXIF, filtros de tamanho e score, validações da selfie com imagens de exemplo, falha de inicialização sem CUDA (provider simulado).

## 13. Fases de implementação

Cada fase tem plano próprio e só começa com o OK do usuário.

1. **Fundação:**
   - monorepo (npm workspaces) e esqueleto da API nos dois papéis (`per`, `ConexaoPostgres`, `config`, `ErroTratado`, `/test`);
   - runner de migrations com `target` e migrations iniciais das seções 5.1 e 5.2;
   - composes (dev, estação, VPS) com Postgres + pgvector e Redis;
   - `.env.*.example`.
2. **vision-service:** modos gpu e selfie-cpu, `/detect` com micro-lote, `/embed-selfie`, `/health`, benchmark na 4070.
3. **Ingestão ponta a ponta sem frontend:**
   - CLI `ingerir`, `processar-foto` e `publicar-foto`;
   - na VPS: `_ESTACAO` (sincronização, publicação, sinal);
   - módulos `_ADMIN` de login, evento e fotógrafo só como API (usados via `.http`), mais a CLI `npm run criar-operador` para o primeiro acesso;
   - métricas e `benchmark-pipeline.ts`.
4. **Busca na VPS:**
   - `buscar`, agrupamento e testes;
   - WhatsApp (webhook, códigos, SAIR/EXCLUIR);
   - resultados e links assinados;
   - ZIP;
   - anfitrião;
   - API de calibração + `sugerirLimiar` e testes.
5. **web-fotografo:** upload resumível e painel da estação.
6. **web-participante.**
7. **web-admin**, expurgo, exclusão pelo admin, backup, documentação de deploy.

## 14. Fase 2 do produto (só projeto): número de peito por OCR

- **Estação:**
  - nova etapa `numeros`, depois de `rostos` (a coluna `foto.numeros_em` entra por migração aditiva);
  - novo endpoint `vision /numeros`, na GPU: detector de região do peito (modelo treinado para bib) + PaddleOCR para o texto;
  - grava `numero_peito` (número normalizado só com dígitos, confiança, bbox);
  - a publicação passa a incluir os números.
- **VPS:**
  - busca por número (`config.busca_numero`, padrão `true` em esportivo);
  - a busca por selfie une o resultado do rosto com as fotos do mesmo número, quando o participante informa o peito. Isso cobre quem aparece de óculos, de boné ou de costas;
  - a verificação pelo WhatsApp continua valendo.
- **Schema:** `numero_peito` já existe desde a fase 1 nas duas pontas, com índice `(id_evento, numero)`. Nenhuma migração destrutiva.

## 15. Riscos e pendências

| Item | Situação |
|---|---|
| Lote no detector `det_10g` | Medir na fase 2; re-exportar com lote dinâmico se for gargalo. |
| Hardware da estação de produção | Não informado. Benchmark roda na 4070 agora e na produção depois. |
| Configuração da VPS | Não informada. Dimensionar a busca na CPU com ela. |
| WhatsApp Business | Verificação da empresa, número dedicado e app na Meta levam dias. Iniciar antes da fase 4. |
| Termo LGPD | Revisão jurídica antes do primeiro evento. |
| Diferença numérica GPU (FP16) × CPU (FP32) nos embeddings | Pequena. A calibração absorve. Com TensorRT FP16 ligado, recalibrar. |
| Banda da VPS | ~50 GB por evento. Se apertar, plugar R2 pela interface de armazenamento. |
| Domínios | A definir: participante, admin, estação. |
