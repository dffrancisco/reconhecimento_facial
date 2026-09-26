# web-fotografo — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O fotógrafo sobe as fotos do evento para a estação por um link, com envio em pedaços que retoma sozinho, e o operador acompanha tudo num painel com os links e QR de upload.

**Architecture:**
- **API da estação**, papel `estacao`, dois módulos novos:
  - `_FOTOGRAFO/upload`: chamadas `{ call }` mais um `PUT` binário para os pedaços;
  - `_PAINEL` (`login` e `painel`).
- **App Vue novo** `apps/web-fotografo`, com a fila de envio num módulo TypeScript puro e dependências injetadas. A tela só assina o estado.
- **Servido na estação** por um nginx novo atrás do Traefik que já existe.

**Tech Stack:**
- Vue 3.5, Vite 8, TypeScript 5.9 `strict`, vue-router 5 (hash);
- Tailwind 4.3 + daisyUI 5.7 (tema claro fixo), axios 1.20;
- `hash-wasm`, `idb-keyval`, `qrcode`;
- Vitest 5 + @vue/test-utils 2.5 + jsdom 30 + `fake-indexeddb`;
- API: Express, `node:test`, Postgres, BullMQ.

**Spec:** [docs/superpowers/specs/2026-09-26-web-fotografo-design.md](../specs/2026-09-26-web-fotografo-design.md)

**Forma deste plano:** o próprio autor executa em seguida, no mesmo turno (inline, com revisor de contexto limpo no fim), por pedido explícito do usuário de "fazer tudo logo".

- **O que cada tarefa traz:** os arquivos, as interfaces exatas entre tarefas e a lista de testes, com a situação e o esperado. Esses testes são o contrato de comportamento.
- **Código:** só aparece onde a escolha não é óbvia.
- **Ordem:** cada teste é escrito e visto falhar antes do código.

## Global Constraints

- **Português:** tudo em português (arquivos, variáveis, funções, comentários, textos de tela). Comentário só para o porquê não óbvio.
- **API — padrão:**
  - padrão `route`/`ctrl`/`sql` do projeto (skill `padrao-backend`, adaptada como nos módulos existentes);
  - métodos da rota recebem só `req` e **retornam**;
  - validação de presença na rota com `{ msg, error: true }`;
  - regra de negócio na `ctrl` com `ErroTratado`;
  - SQL com `?`.
- **API — erros:** respostas 422 que a tela precisa distinguir levam `codigo` estável (`link_invalido`, `evento_encerrado`, `nao_e_jpeg`, `hash_diferente`), e `sem_espaco` vai em 507. A tela reage ao código, nunca ao texto.
- **Limites:**
  - pedaço: `UPLOAD_PEDACO_MB` (padrão 8);
  - foto: até 60 MB;
  - JPEG por extensão (`.jpg`/`.jpeg`) e pelos bytes mágicos `FF D8 FF`.
- **Arquivos parciais:**
  - em `RAIZ_UPLOADS` (padrão `/data/originais/_uploads`), no mesmo volume dos originais;
  - `processar-foto` recebe `copiar: false` e `jobId` `<id_evento>_<hash>`, como a CLI.
- **Tempos:**
  - painel consultado a cada 2 s; `statusUpload` a cada 5 s;
  - sessão do operador 12 h (o `gerarToken` já usa 12 h);
  - login limitado a 10 tentativas por IP a cada 10 min.
- **Fila do navegador:**
  - 3 por vez (1 a 6);
  - sem conexão: nunca desiste, espera crescente até 32 s;
  - erro de uma foto: 6 tentativas, espera 1 s → 32 s;
  - hash diferente: reenvia do zero uma vez.
- **Identidade "Claro e limpo"** (spec §2), tokens exatos:
  - fundo `#f6f6f8`; superfície `#fff`; borda `#e6e6ea`;
  - texto `#1d1d22`; secundário `#7a7a86`;
  - barra `#f7414f` sobre `#e9e9ee`;
  - ação principal `#1d1d22`; destrutiva `#b91c1c`/`#fecaca`;
  - sucesso `#16a34a`/`#e8f7ee`; erro `#dc2626`; aviso `#9a3412`/`#fff7ed`;
  - `system-ui`; daisyUI com `themes: light --default`.
- **Sigilo:** nada de token de upload, senha ou token de sessão em log.
- **Ambiente e testes:**
  - comandos com Node 22: `PATH=/home/alves/.nvm/versions/node/v22.23.2/bin:$PATH`;
  - testes de integração exigem `worker-estacao` parado (`docker compose -f docker-compose.dev.yml stop worker-estacao`; religar depois).
- **Commits** terminam com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Dois envios da mesma foto ao mesmo tempo:** dois fotógrafos, ou duas abas, com o mesmo hash. Os dois completam, o segundo `fila.add` devolve o job existente, e o arquivo parcial do segundo ficaria órfão no disco. **Esperado:** quem não enfileirou apaga o próprio parcial. Pinado na Task 4.
2. **Estação reinicia no meio de um pedaço:** o parcial fica com um pedaço pela metade e a trava em memória se perde. **Esperado:** o próximo `PUT` recebe 409 com o tamanho real do disco e o navegador continua dali. Pinado na Task 4.
3. **Pasta com 2 000 fotos:** a fila não pode calcular as 2 000 impressões digitais antes de começar a enviar, nem segurar todos os arquivos lidos na memória. **Esperado:** calcula só um pouco à frente das vagas de envio. Pinado na Task 8.
4. **Duas câmeras com `IMG_0001.JPG` do mesmo tamanho e data, em subpastas diferentes:** **esperado:** a chave do IndexedDB inclui o caminho relativo, e as duas fotos não se confundem. Pinado na Task 9.
5. **Painel aberto em `localhost` na própria estação sem `ENDERECO_LAN`:** **esperado:** os links e QR não saem com "localhost" sem aviso; o painel avisa que o link não serve para o celular. Pinado na Task 5 (API) e na Task 11 (tela).

---

### Task 1: Código de erro nas respostas e configuração do upload

**Files:**
- Modify: `apps/api/src/services/erro.ts`, `apps/api/src/services/per.ts`, `apps/api/src/services/per.test.ts`, `apps/api/src/services/config.ts`, `apps/api/src/services/config.test.ts`

**Interfaces:**
- Produces:
  - `new ErroTratado(mensagem: string, codigo?: string)`, com a propriedade `codigo?: string`. O `per` responde `422 { msg, codigo }` quando há código e `422 { msg }` quando não há (compatível com o que já existe).
  - `config.raizUploads: string` (`RAIZ_UPLOADS`, padrão `/data/originais/_uploads`).
  - `config.uploadPedacoBytes: number` (`UPLOAD_PEDACO_MB`, padrão 8, em bytes).
  - `config.enderecoLan: string | null` (`ENDERECO_LAN`, sem barra no fim).
  - `config.enderecoTunel: string | null` (`ENDERECO_TUNEL`).

- [ ] Testes (`per.test.ts`):
  - "ErroTratado com código vira 422 com msg e codigo";
  - o teste existente "ErroTratado vira 422 com a mensagem" continua passando sem `codigo`.
- [ ] Testes (`config.test.ts`):
  - padrões de `raizUploads` e `uploadPedacoBytes` (8 MiB);
  - `UPLOAD_PEDACO_MB=4` → 4 MiB;
  - `ENDERECO_LAN` com barra final sai sem ela;
  - ausente → `null`.
- [ ] Ver falhar, implementar, ver passar (`npm test -w apps/api`), commit `feat(api): código de erro nas respostas e configuração do upload`.

### Task 2: Regras puras do upload

**Files:**
- Create: `apps/api/src/_FOTOGRAFO/upload/regras.ts`, `apps/api/src/_FOTOGRAFO/upload/regras.test.ts`

**Interfaces:**
- Produces:
  - `TAMANHO_MAXIMO_FOTO = 60 * 1024 * 1024`
  - `validarInicio(e: { nome_arquivo: unknown; tamanho: unknown; hash_arquivo: unknown }): string | null` — a mensagem de erro, ou `null` quando está tudo certo.
  - `ehJpeg(inicio: Buffer): boolean`
  - `decidirPedaco(p: { offset: number; tamanhoAtual: number; tamanhoDeclarado: number; bytesPedaco: number; limitePedaco: number }): "ok" | "fora_de_ordem" | "grande_demais" | "passa_do_tamanho"`
  - `mensagemParaFotografo(erroTecnico: string | null, etapa: string | null): string`

- [ ] Testes:
  - **`validarInicio`**:
    - nome sem extensão JPEG → "Não é JPEG — exporte em JPEG para enviar.";
    - `.JPG` e `.jpeg` passam (maiúsculas também);
    - tamanho 0, negativo, não inteiro ou acima de 60 MB recusados; acima de 60 MB → "Foto maior que 60 MB.";
    - hash com 63 caracteres ou não hexadecimal recusado;
    - hash com letras maiúsculas aceito e normalizado pelo chamador (a função só valida).
  - **`ehJpeg`**: `FF D8 FF E0…` → true; `89 50 4E 47` (PNG) → false; buffer com menos de 3 bytes → false.
  - **`decidirPedaco`**:
    - offset ≠ tamanho atual → `fora_de_ordem`;
    - pedaço acima do limite → `grande_demais`;
    - `tamanhoAtual + bytesPedaco > tamanhoDeclarado` → `passa_do_tamanho`;
    - caso normal → `ok`.
  - **`mensagemParaFotografo`**: "vision recusou a imagem: …" → "A estação não conseguiu ler esta foto (arquivo corrompido)."; erro de publicação → "A foto está pronta e aguarda envio ao site; não precisa fazer nada."; qualquer outro → "A estação teve um problema com esta foto. O operador já vê no painel."
- [ ] Commit `feat(api): regras puras do upload do fotógrafo`.

### Task 3: API do fotógrafo — sessão, início e status

**Files:**
- Create: `apps/api/src/_FOTOGRAFO/upload/route.upload.ts`, `ctrl.upload.ts`, `sql.upload.ts`, `upload.http`, `apps/api/integracao/fotografoUpload.test.ts`
- Modify: `apps/api/src/routes/fotografoRoute.ts`

**Interfaces:**
- Consumes: `validarInicio`, `mensagemParaFotografo` (Task 2); `ErroTratado(msg, codigo)` e `config.uploadPedacoBytes` (Task 1).
- Produces:
  - `POST /api/fotografo/upload` com as chamadas abaixo;
  - `vinculoPorToken(conexao, token): Promise<LinhaVinculo | undefined>` e `exigirVinculo(conexao, token)`, exportados de `ctrl.upload.ts` para a Task 4;
  - `LinhaVinculo = { id_evento_fotografo, id_evento, slug, nome_evento, nome_fotografo, ativo, evento_ativo, encerrado_em, deletado }`;
  - `exigirVinculo` lança `ErroTratado("Este link não aceita mais fotos. Fale com o operador da estação.", "link_invalido" | "evento_encerrado")`.

Chamadas:
- `getSessao { token }` → `{ evento: { nome }, fotografo: { nome }, pedaco_bytes }`.
- `iniciarUpload { token, nome_arquivo, tamanho, hash_arquivo }` → `{ situacao: "ja_existe" }` ou `{ situacao: "continuar" | "novo", id_upload, bytes_recebidos }`.
  - `continuar` usa o tamanho real do arquivo parcial em disco; sem arquivo, é 0.
- `statusUpload { token }` → `{ enviadas, processando, prontas, com_erro, erros: [{ nome_arquivo, mensagem }] }`, só do vínculo daquele token:
  - enviadas: `upload` com `status = 'completo'`;
  - prontas: `foto` com `etapa = 'publicada'`;
  - processando: `foto` fora de `publicada` e sem `erro`;
  - com_erro: `foto` com `erro`;
  - erros: até 50.

- [ ] Testes de integração (papel `estacao`, banco `fotos_estacao`, `RAIZ_UPLOADS` numa pasta temporária):
  - **`getSessao`:**
    - token válido → nomes e `pedaco_bytes`;
    - token inexistente → 422 `link_invalido`;
    - vínculo `ativo='N'` → 422 `link_invalido`;
    - evento com `encerrado_em` → 422 `evento_encerrado`.
  - **`iniciarUpload`:**
    - novo → `novo` com `bytes_recebidos` 0 e linha `upload` criada;
    - repetido com o mesmo hash → `continuar`, com o mesmo `id_upload`;
    - com arquivo parcial de 5 bytes no disco → `bytes_recebidos` 5;
    - hash já em `foto` do evento, inclusive de outro vínculo → `ja_existe`;
    - extensão errada → 422 com a mensagem da Task 2.
  - **`statusUpload`:** conta só as fotos do próprio vínculo; os erros vêm com a mensagem traduzida.
- [ ] Commit `feat(api): _FOTOGRAFO/upload — sessão, início e situação`.

### Task 4: Envio dos pedaços (PUT)

**Files:**
- Create: `apps/api/src/_FOTOGRAFO/upload/pedaco.ts` (handler Express e lógica), `apps/api/integracao/fotografoPedaco.test.ts`
- Modify: `apps/api/src/routes/fotografoRoute.ts`, `apps/api/src/_FOTOGRAFO/upload/sql.upload.ts`

**Interfaces:**
- Consumes: `exigirVinculo` (Task 3), `ehJpeg`/`decidirPedaco` (Task 2), `config.raizUploads`/`uploadPedacoBytes` (Task 1), `criarFila`, `NOME_FILA`, `DadosProcessarFoto`, `calcularHashArquivo`.
- Produces: `PUT /api/fotografo/upload/:id_upload`, com os cabeçalhos `X-Token-Upload` e `Upload-Offset` e corpo `application/octet-stream`.

Respostas:

| Situação | Resposta |
|---|---|
| Pedaço aceito | `200 { bytes_recebidos, completo }` |
| Offset errado ou outro pedaço em curso | `409 { bytes_recebidos }` |
| Pedaço grande demais | `413 { msg }` |
| Primeiro pedaço não é JPEG, ou hash diferente no fim | `422 { msg, codigo }` |
| Disco cheio | `507 { msg, codigo: "sem_espaco" }` |

Implementação:
- Trava em memória: um `Set<number>` de `id_upload` em curso.
- O corpo é lido em stream com contador de bytes. Ao passar do limite, a leitura aborta e o que já foi escrito é truncado de volta ao tamanho anterior.
- Primeiro pedaço: confere os 3 primeiros bytes antes de gravar.
- Último pedaço:
  - `calcularHashArquivo` no arquivo parcial;
  - se bate, `UPDATE upload SET status='completo'` e `fila.getJob(jobId)`;
  - se o job já existe, apaga o próprio parcial (Review Focus 1); senão, `fila.add` com `{ id_evento, id_evento_fotografo, hash_arquivo, nome_arquivo, origem: <parcial>, copiar: false }`, `attempts: 5`, backoff exponencial de 1 s;
  - se não bate, apaga o arquivo e marca `cancelado`.

- [ ] Testes de integração (servidor Express local com a rota, `RAIZ_UPLOADS` temporário; o teste remove da fila os jobs que criar):
  - **Envio normal:** foto JPEG de 20 KB em 3 pedaços (limite de pedaço de 8 KB via config) → os dois primeiros `completo: false`; o último `completo: true`, `upload.status = 'completo'` e job `processar-foto` com `origem` = arquivo parcial e `copiar: false`.
  - **Ordem:** offset errado → 409 com o tamanho real.
  - **Reinício da estação** (Review Focus 2): parcial com meio pedaço a mais que a coluna → 409 com o tamanho do disco.
  - **Tamanhos:** pedaço de 9 KB → 413; pedaço que passa do tamanho declarado → 422.
  - **Conteúdo:**
    - primeiro pedaço PNG → 422 `nao_e_jpeg`, sem arquivo em disco;
    - conteúdo que não bate com o hash declarado → 422 `hash_diferente`, arquivo apagado e `upload.status = 'cancelado'`.
  - **Permissão:** token de outro vínculo → 422 `link_invalido`.
  - **Duplicada** (Review Focus 1): segundo vínculo completa a mesma foto depois do primeiro → o job continua um só e o parcial do segundo é apagado.
  - **Disco cheio:** `ENOSPC`, simulado injetando um escritor que lança `{ code: "ENOSPC" }` → 507 `sem_espaco`. A lógica recebe o criador do stream por parâmetro para isso.
- [ ] Commit `feat(api): envio dos pedaços do upload com conferência do arquivo`.

### Task 5: Painel — login e getPainel

**Files:**
- Create: `apps/api/src/_PAINEL/login/route.login.ts`, `ctrl.login.ts`, `apps/api/src/_PAINEL/painel/route.painel.ts`, `ctrl.painel.ts`, `sql.painel.ts`, `painel.http`, `apps/api/src/_PAINEL/painel/regras.ts`, `regras.test.ts`, `apps/api/integracao/painel.test.ts`
- Modify: `apps/api/src/routes/painelRoute.ts`, `apps/api/src/jobs/sincronizar.ts` (registra a última sincronização bem-sucedida)

**Interfaces:**
- Consumes: `LoginCtrl` do admin (reusado: mesma conferência de senha e token), `contarNaJanela`, `ipDoPedido`, `autorizarOperador`, `montarSinal`, `config.enderecoLan`/`enderecoTunel`.
- Produces:
  - `POST /api/painel/login { call: "login", login, senha }` → `{ token, nome }`. É limitado: 10 por IP a cada 10 min; a 11ª tentativa responde 422 "Muitas tentativas. Espere alguns minutos."
  - `POST /api/painel/painel { call: "getPainel" }` → `RespostaPainel`.
  - `linkDeUpload(endereco: string, token: string): string` → `${endereco}/#/?t=${token}` (em `regras.ts`).
  - `registrarSincronizacao(): Promise<void>` e `ultimaSincronizacao(): Promise<string | null>`, com a chave Redis `${prefixo}estacao:ultima_sincronizacao` (ISO).

```ts
interface RespostaPainel {
    evento: null | { id_evento: number; nome: string; desde: string };
    metricas: { fotos_min: number; latencia_p50_ms: number; latencia_p95_ms: number; taxa_erro: number; gpu: { utilizacao: number; vram_usada_mb: number; vram_total_mb: number } | null };
    fila: { recebidas: number; rostos: number; derivados: number; esperando_publicar: number };
    vps: { ultima_sincronizacao: string | null };
    enderecos: { lan: string | null; tunel: string | null };
    fotografos: { id_evento_fotografo: number; nome: string; token_upload: string; enviadas: number; prontas: number; com_erro: number }[];
    erros: { id_foto: number; nome_arquivo: string; fotografo: string | null; etapa: string | null; erro: string; tem_arquivo: boolean }[];
    em_processamento: number;
}
```

Regras do conteúdo:
- **Evento em andamento:** o de `criado_em` mais recente com `ativo='S'`, `deletado='N'` e `encerrado_em IS NULL`. Sem evento, `evento: null` e o resto zerado ou vazio.
- **Fila do evento:**
  - `recebidas`: etapas `registrada` + `original`;
  - `rostos`: etapa `rostos`;
  - `derivados`: etapa `derivados` sem `erro`;
  - `esperando_publicar`: jobs `waiting`+`delayed`+`active` da fila `publicar-foto`.
- **`tem_arquivo`:** `caminho_original` existe no disco, ou existe o parcial do upload de mesmo hash e vínculo.

- [ ] Testes de unidade (`regras.test.ts`):
  - `linkDeUpload("http://192.168.0.10", "abc")` → `http://192.168.0.10/#/?t=abc`;
  - `escolherEventoEmAndamento(linhas)` ignora encerrados, inativos e deletados e escolhe o mais recente.
- [ ] Testes de integração:
  - **Login:** certo → token e nome; errado → 422; 11ª tentativa do mesmo IP → 422 de limite.
  - **Sessão:** `getPainel` sem token → 422 "Sessão expirada".
  - **`getPainel`** com evento de teste mais recente e ativo:
    - traz o evento;
    - traz os fotógrafos com contagens e `token_upload`;
    - traz os erros com `tem_arquivo`;
    - traz `enderecos.lan` igual ao configurado (Review Focus 5: `lan: null` quando não configurado);
    - traz `vps.ultima_sincronizacao` depois de `registrarSincronizacao()`.
  - **Sem evento:** com o evento de teste encerrado, o painel escolhe outro ou `null`, nunca o encerrado.
- [ ] Commit `feat(api): painel da estação — login e situação`.

### Task 6: Painel — reprocessar, encerrar e limpeza de uploads abandonados

**Files:**
- Modify: `apps/api/src/_PAINEL/painel/route.painel.ts`, `ctrl.painel.ts`, `sql.painel.ts`, `apps/api/src/worker.ts`
- Create: `apps/api/src/jobs/limparUploads.ts`, `apps/api/integracao/painelAcoes.test.ts`

**Interfaces:**
- Produces:
  - `reprocessar { id_foto? }` → `{ reenfileiradas: number, sem_arquivo: number }`.
  - `encerrarEvento { id_evento }` → `{ encerrado: true }`, ou 422 "Ainda há fotos em processamento. Espere a fila esvaziar para encerrar." (`codigo: "em_processamento"`).
  - `limparUploadsAbandonados(conexao, agora = Date.now()): Promise<number>` e `agendarLimpezaUploads()`, chamados pelo `worker.ts` no papel `estacao`.

Regras:
- **`reprocessar`:**
  - limpa `erro`/`erro_etapa`;
  - remove o job antigo com o mesmo `jobId` (falhos continuam na fila com esse id);
  - reenfileira `processar-foto` a partir de `caminho_original`, com `copiar: true` porque o original fica onde está;
  - sem arquivo, conta em `sem_arquivo` e não mexe na foto.
- **`encerrarEvento`:** transação que grava `encerrado_em = now()` e apaga `numero_peito` e `rosto` do evento.
- **Limpeza diária:**
  - `upload` `recebendo` com `updated_at` de mais de 24 h → apaga o parcial e marca `cancelado`;
  - o `PUT` da Task 4 atualiza `updated_at` a cada pedaço (confirmar na Task 4).

- [ ] Testes de integração:
  - **`reprocessar`:**
    - foto com erro e `caminho_original` existente → erro limpo e job novo na fila;
    - foto sem arquivo → `sem_arquivo: 1` e a foto intacta;
    - sem `id_foto` → só as fotos com erro do evento em andamento.
  - **`encerrarEvento`:**
    - com uma foto em `rostos` sem erro → 422 `em_processamento`;
    - com fotos só publicadas e uma com erro → encerrado, `rosto` do evento apagado e `getSessao` do vínculo passa a responder `evento_encerrado`.
  - **`limparUploadsAbandonados`:** upload de 25 h atrás com parcial → apagado e `cancelado`; upload de 1 h → intacto.
- [ ] Commit `feat(api): painel — reprocessar, encerrar evento e limpeza de envios abandonados`.

### Task 7: App web-fotografo — esqueleto, tema e entrada pelo link

**Files:**
- Create:
  - `apps/web-fotografo/` (`package.json`, `index.html`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`);
  - `src/main.ts`, `App.vue`, `router.ts`, `estilo.css`;
  - `src/ts/api.ts`, `erros.ts` (com os testes);
  - `src/pages/entrada/index.vue`, `entrada.ts`, `entrada.test.ts`;
  - placeholders para `enviar` e `estacao`.
- Modify: `package.json` (raiz: workspace), `package-lock.json`

**Interfaces:**
- Produces:
  - rotas: `entrada` (`/`), `enviar` (`/enviar`), `estacao` (`/estacao`);
  - `ErroDaApi extends Error { codigo?: string; status?: number; semConexao: boolean }`;
  - `chamar<T>(area, modulo, corpo): Promise<T>`, que manda `Authorization` quando há sessão do operador salva;
  - `mensagemDeErro(erro)`: respeita `response` antes de `request` (não repetir o defeito da tela do participante);
  - `lerToken(): string | null` e `guardarToken(t)` (`localStorage` `token_upload`);
  - classes do tema: `.pagina`, `.superficie`, `.botao`, `.botao-secundario`, `.botao-perigo`, `.rotulo-secao`, `.numero`, `.selo`.

- [ ] Testes:
  - **`erros.test.ts`:**
    - 422 com `msg` e `codigo` → `ErroDaApi` com os dois;
    - 507 → `codigo` `sem_espaco`;
    - sem resposta → `semConexao: true` e "Sem conexão com a estação.";
    - 413 sem `msg` → texto próprio, não "sem conexão".
  - **`entrada.test.ts`** (montado com router): `/#/?t=abc` guarda o token e vai para `/enviar`; sem `t` e sem token salvo → mostra "Este link de envio não é válido. Peça o link ao operador da estação."
- [ ] Commit `feat(web-fotografo): esqueleto do app, tema claro e entrada pelo link`.

### Task 8: Fila de envio (módulo puro)

**Files:**
- Create: `apps/web-fotografo/src/ts/fila/fila.ts`, `tipos.ts`, `fila.test.ts`

**Interfaces:**
- Produces (`tipos.ts`):

```ts
export type SituacaoItem = "esperando" | "preparando" | "enviando" | "enviado" | "pulado" | "erro";
export interface ItemFila { chave: string; arquivo: File; nome: string; tamanho: number; situacao: SituacaoItem; progresso: number; hash?: string; idUpload?: number; mensagem?: string; tentativas: number; reenviosPorHash: number }
export interface ServicosFila {
    calcularHash(arquivo: File): Promise<string>;
    iniciar(e: { nome_arquivo: string; tamanho: number; hash_arquivo: string }): Promise<{ situacao: "ja_existe" } | { situacao: "continuar" | "novo"; id_upload: number; bytes_recebidos: number }>;
    enviarPedaco(e: { idUpload: number; offset: number; pedaco: Blob; aoProgredir(bytes: number): void }): Promise<{ bytes_recebidos: number; completo: boolean }>;
    esperar(ms: number): Promise<void>;
    aoMudar?(item: ItemFila): void; // persiste no IndexedDB (Task 9)
}
export class FalhaDeEnvio extends Error { constructor(public tipo: "sem_conexao" | "estacao" | "foto" | "fora_de_ordem" | "hash_diferente", mensagem: string, public bytesRecebidos?: number) }
```

- Produces (`fila.ts`), `class FilaDeEnvio`:
  - `constructor(servicos: ServicosFila, opcoes: { pedacoBytes: number; porVez?: number })`
  - `adicionar(itens: { chave: string; arquivo: File }[]): void`, que ignora chaves já presentes
  - `iniciar()`, `pausar()`, `continuar()`, `porVez` (get/set, 1 a 6), `tentarDeNovo(chave)`
  - `estado(): { itens: ItemFila[]; pausada: boolean; semConexaoDesde: number | null; parada: string | null; enviados: number; pulados: number; esperando: number; comErro: number; bytesTotais: number; bytesEnviados: number }`
  - `assinar(ouvinte: () => void): () => void`

- [ ] Testes (serviços falsos, `esperar` imediato):
  - **Concorrência:**
    - com `porVez` 3 e 10 itens, nunca há mais de 3 em `preparando`/`enviando`;
    - o hash só é pedido quando o item vai ocupar uma vaga (Review Focus 3: com 100 itens e nenhum envio concluído, `calcularHash` foi chamado no máximo `porVez` vezes).
  - **Respostas de `iniciar`:**
    - `ja_existe` → `pulado`, sem nenhum pedaço enviado;
    - `continuar` com `bytes_recebidos` 8 → o primeiro pedaço sai do offset 8.
  - **Envio:**
    - arquivo de 20 bytes com `pedacoBytes` 8 → pedaços 0–8, 8–16, 16–20, e depois `enviado`;
    - `fora_de_ordem` com `bytesRecebidos` 16 → o próximo pedaço sai de 16, sem contar tentativa.
  - **Sem conexão:** `sem_conexao` 20 vezes seguidas e depois sucesso → `enviado`, `tentativas` 0, `semConexaoDesde` preenchido durante a falha e `null` depois, esperas crescentes com teto de 32 000.
  - **Da estação inteira:** `estacao` → `parada` com a mensagem, nada mais é iniciado, e `continuar()` limpa `parada` e retoma.
  - **De uma foto:**
    - `foto` 6 vezes → `erro` com a mensagem, e os outros itens seguem;
    - `tentarDeNovo` volta para `esperando` com `tentativas` 0.
  - **Hash diferente:** uma vez → reenvia do offset 0 e termina; duas vezes → `erro` "A foto chegou diferente do original.".
  - **Pausa:** `pausar()` com envio em curso termina o pedaço atual e não começa outro; `continuar()` retoma.
  - **Chaves:** `adicionar` com chave repetida não duplica.
- [ ] Commit `feat(web-fotografo): fila de envio com retomada e os três tipos de falha`.

### Task 9: Impressão digital, armazenamento e leitura das pastas

**Files:**
- Create:
  - `apps/web-fotografo/src/ts/hash.worker.ts`, `hash.ts`;
  - `src/ts/armazenamento.ts`, `armazenamento.test.ts`;
  - `src/ts/arquivos.ts`, `arquivos.test.ts`.

**Interfaces:**
- Produces:
  - `calcularHash(arquivo: File): Promise<string>`: Worker com `hash-wasm` `createSHA256`, lendo em fatias de 4 MB. Um Worker só, com fila de pedidos.
  - `chaveDoArquivo(arquivo: File, caminho: string): string` → `${caminho}|${tamanho}|${lastModified}` (Review Focus 4).
  - `filtrarArquivos(lista: { arquivo: File; caminho: string }[]): { aceitos: { chave; arquivo }[]; recusados: { nome; mensagem }[] }`: extensão e 60 MB, com as mesmas mensagens da API.
  - `lerSoltos(dados: DataTransfer): Promise<{ arquivo: File; caminho: string }[]>`: `webkitGetAsEntry` recursivo, com `readEntries` chamado até vir vazio. Para seletor de arquivos, `caminho = webkitRelativePath || name`.
  - `criarArmazenamento(token: string)` → `{ lerHash(chave), gravarHash(chave, hash), gravarItem(chave, { situacao, idUpload?, hash? }), pendentes(): Promise<number>, esquecerPendentes(), limpar(chave) }`. Usa `idb-keyval` com um store por token (`createStore("fotografo-" + token.slice(0, 12), "itens")`).

- [ ] Testes:
  - **`arquivos.test.ts`:**
    - `.CR3`, `.png` e arquivo de 61 MB recusados com as mensagens da spec;
    - `.JPG` aceito;
    - duas `IMG_0001.JPG` iguais em `camA/` e `camB/` geram chaves diferentes;
    - `lerSoltos` com entradas falsas de pasta aninhada (e `readEntries` que devolve em dois lotes) lê todos os arquivos.
  - **`armazenamento.test.ts`** (`fake-indexeddb/auto`):
    - `gravarHash` → `lerHash`;
    - `pendentes` conta só `esperando`/`enviando`/`preparando`;
    - `esquecerPendentes` zera;
    - tokens diferentes não se misturam.
  - **O worker de hash:** não roda no jsdom; é provado no ponta a ponta (Task 12). `hash.ts` também expõe `sha256EmFatias(arquivo, criar = createSHA256)` puro, testado com `hash-wasm` direto no Vitest contra o SHA-256 conhecido de "abc".
- [ ] Commit `feat(web-fotografo): impressão digital, armazenamento e leitura de pastas`.

### Task 10: Tela de envio

**Files:**
- Create: `apps/web-fotografo/src/pages/enviar/index.vue`, `enviar.ts`, `services/enviar.service.ts`, `enviar.test.ts`, `src/ts/tempo.ts`, `tempo.test.ts`

**Interfaces:**
- Consumes:
  - `FilaDeEnvio` (Task 8);
  - `calcularHash`, `criarArmazenamento`, `filtrarArquivos`, `lerSoltos`, `chaveDoArquivo` (Task 9);
  - `chamar`, `ErroDaApi` (Task 7).
- Produces:
  - `enviar.service.ts`:
    - `getSessao(token)`, `iniciarUpload(token, e)`, `statusUpload(token)`;
    - `enviarPedaco(token, e)`: XHR com `upload.onprogress`, que traduz para `FalhaDeEnvio` a falta de resposta (`sem_conexao`), 409 (`fora_de_ordem`), 422 com `codigo` de link/evento e 507 (`estacao`), 422 `hash_diferente` (`hash_diferente`) e os demais (`foto`).
  - `tempoRestante(bytesRestantes, bytesPorSegundo): string` ("cerca de 4 min", "menos de 1 min", "—").

- [ ] Testes:
  - **`tempo.test.ts`:** 0 → "—"; 30 s → "menos de 1 min"; 250 s → "cerca de 4 min".
  - **`enviar.test.ts`** (montado, serviços e fila com dublês):
    - mostra evento e fotógrafo de `getSessao`;
    - `getSessao` com `link_invalido` → tela de "Este link não aceita mais fotos…";
    - os quatro contadores refletem fila + `statusUpload`;
    - aviso de retomada aparece com pendentes e some em "Esquecer pendentes";
    - aviso de conexão: aparece com `semConexaoDesde` e fica vermelho depois de 60 s (relógio falso); o título da aba vira "⚠ Sem conexão";
    - "Pausar"/"Continuar" alternam;
    - a lista de erros mostra os recusados pelo filtro e os erros da estação;
    - `beforeunload` é registrado quando há itens esperando ou enviando.
- [ ] Commit `feat(web-fotografo): tela de envio`.

### Task 11: Painel da estação (tela)

**Files:**
- Create: `apps/web-fotografo/src/pages/estacao/index.vue`, `estacao.ts`, `services/estacao.service.ts`, `estacao.test.ts`, `src/componentes/QrCode.vue`, `src/ts/sessao.ts`

**Interfaces:**
- Consumes: `chamar` (Task 7), a resposta `RespostaPainel` (Task 5), `linkDeUpload`, reimplementado igual no front (`ts/links.ts`).
- Produces:
  - `sessao.ts`: `lerSessao()`, `guardarSessao({ token, nome })`, `sair()` (`localStorage` `sessao_operador`);
  - telas de login e painel;
  - consulta a cada 2 s enquanto montado, parando ao desmontar;
  - sessão expirada (422 "Sessão expirada…") volta para o login.

- [ ] Testes (montados, serviço com dublê, relógio falso):
  - **Login:** sem sessão → formulário; login certo guarda a sessão e mostra o painel; errado mostra a mensagem da API.
  - **Sem evento:** "Nenhum evento em andamento nesta estação…".
  - **Com evento:**
    - mostra os 4 números (placa de vídeo "—" quando `gpu` é `null`);
    - a fila por etapa;
    - um fotógrafo por linha, com link montado com `enderecos.lan`;
    - "Copiar" chama `navigator.clipboard.writeText` com o link;
    - "QR grande" abre o QR.
  - **Review Focus 5:** `enderecos.lan` nulo e `location.hostname` `localhost` → aviso "Este endereço só funciona neste computador…".
  - **Erros:** "Reprocessar" chama o serviço com `id_foto`; `tem_arquivo: false` mostra "Peça ao fotógrafo para reenviar".
  - **Encerrar:**
    - desabilitado com `em_processamento > 0`;
    - com 0, pede confirmação (texto da spec, com "N fotos com erro não serão publicadas" quando houver) e só chama `encerrarEvento` depois de confirmar.
  - **Atualização:** a consulta repete a cada 2 s e para ao desmontar; sessão expirada volta ao login.
- [ ] Commit `feat(web-fotografo): painel da estação`.

### Task 12: Servir na estação, documentação e prova no navegador

**Files:**
- Create: `apps/web-fotografo/Dockerfile` (build em estágio node e nginx servindo; `location /` com `try_files … /index.html`, `/assets/` imutável, `index` sem cache)
- Modify:
  - `docker-compose.estacao.yml`:
    - serviço `web` com router Traefik `PathPrefix(/)`;
    - a API monta o volume `originais` em `/data/originais`;
  - `docker-compose.dev.yml`: `api-estacao` monta o volume dos originais da estação;
  - `.env.estacao.example`: `ENDERECO_LAN`, `ENDERECO_TUNEL`, `UPLOAD_PEDACO_MB`;
  - `docs/desenvolvimento.md`: seção "Upload do fotógrafo e painel da estação".

- [ ] Provas:
  - `docker compose -f docker-compose.estacao.yml config` sem erro;
  - build da imagem `web` com sucesso;
  - suíte inteira (`npm test`, `npm run test:integracao` com o `worker-estacao` parado, `npm run typecheck`).
- [ ] Ponta a ponta no Chrome sem janela (playwright-core na pasta temporária da sessão, fora do repositório), contra o compose de dev:
  1. **Preparação:**
     - vínculo de fotógrafo criado no VPS e sincronizado;
     - `api-estacao` e `worker-estacao` recriados;
     - `npm run dev -w apps/web-fotografo`.
  2. **Painel:** login com o operador de dev, evento em andamento e fotógrafo com link.
  3. **Envio:**
     - abrir o link, soltar uma pasta com 10 fotos JPEG e um `.png`;
     - no meio, cortar a rede (`context.setOffline(true)` por 5 s) e ver o aviso;
     - ao voltar, o envio termina sozinho, com 10 enviadas e 1 recusado.
  4. **Retomada:** recarregar no meio de outro lote → aviso de pendentes; soltar de novo → só o que faltava sobe; o que já chegou vira "já estavam".
  5. **Painel de novo:** as contagens batem; `getPainel` mostra as fotos publicadas.
- [ ] Commit `feat(web-fotografo): servir na estação e documentação`.

---

## Cobertura da spec

| Spec | Task |
|---|---|
| §2 identidade "Claro e limpo" | 7 (tema), 10, 11 |
| §3.1 entrada pelo link | 7 |
| §3.2 envio: cabeçalho, conexão, retomada, soltar, contadores, progresso, erros, parada, `beforeunload` | 8, 9, 10 |
| §3.3 painel: login, sem evento, números, fila, fotógrafos com link/QR, erros com reprocessar, encerrar | 5, 6, 11 |
| §4 caminho do arquivo, três tipos de falha, pausa/retomada, contadores | 2, 3, 4, 8, 9, 10 |
| §5.1–5.2 API do fotógrafo | 1, 2, 3, 4 |
| §5.3 API do painel, endereços | 5, 6 |
| §5.4 limpeza | 6 |
| §6 arquitetura da tela | 7–11 |
| §7 como sobe | 12 |
| §8 testes | todas |
