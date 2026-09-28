# web-fotografo — upload do fotógrafo e painel da estação

A tela em que o fotógrafo sobe as fotos do evento para a estação, e o painel em que o operador acompanha o processamento.

Este documento detalha a fase 5 e as seções 7 e 9 do [design da plataforma](2026-09-18-plataforma-fotos-design.md). O que vale lá continua valendo aqui; onde este documento for mais específico, ele manda.

## 1. Objetivo

Hoje as fotos só entram pela linha de comando (`ingerir`), lendo uma pasta no computador da estação. Esta etapa troca isso pela experiência real do evento:

- o fotógrafo recebe um link (ou QR), solta a pasta do cartão e as fotos chegam à estação, entram no processamento que já existe e aparecem para os participantes;
- o operador acompanha tudo num painel e distribui os links.

**Aparelho principal do fotógrafo:** notebook, arrastando uma pasta com centenas de fotos JPEG de 10 a 25 MB. Celular funciona, mas não é o caso principal.

**Uma estação atende um evento por vez.** O painel mostra o evento em andamento: o que está acontecendo hoje, pelas datas. O operador pode escolher outro evento aberto.

**Sucesso:**

- o fotógrafo solta a pasta e não precisa vigiar a tela;
- se o Wi-Fi cai no meio, o envio continua sozinho quando a rede volta;
- nada chega duplicado;
- o operador vê, sem abrir terminal, o que está na fila, o que deu erro e quem já mandou o quê.

## 2. Identidade visual — "Claro e limpo"

Escolhida entre três direções (Largada, estúdio escuro, claro e limpo), comparadas lado a lado no navegador. A tela do fotógrafo e o painel usam a mesma.

| Elemento | Decisão |
|---|---|
| Fundo da página | `#f6f6f8` |
| Superfícies (cabeçalho, caixas, área de soltar) | `#fff`, borda `#e6e6ea`, cantos de 10 a 12 px |
| Texto | `#1d1d22`; secundário `#7a7a86` |
| Marca | Selo quadrado de 20 px com o gradiente Largada (`168deg, #ff6b35 → #f7414f 52% → #c81d5a`) ao lado do nome do evento |
| Barras de progresso | Trilho `#e9e9ee`, preenchimento `#f7414f` |
| Ação principal | Pílula escura: `#1d1d22` com texto branco |
| Ação secundária | Pílula branca com borda `#d4d4dc` |
| Ação destrutiva ("Encerrar evento") | Pílula branca, texto `#b91c1c`, borda `#fecaca` |
| Estados | Sucesso `#16a34a` (fundo `#e8f7ee`), erro `#dc2626`, aviso `#9a3412` sobre `#fff7ed` |
| Rótulo de seção | 10 px, maiúsculas, `letter-spacing: .1em`, peso 700, cor secundária |
| Números dos contadores | 18 px, peso 800, `letter-spacing: -.02em` |
| Fonte | Pilha do sistema (`system-ui`) |

Sem modo escuro: o daisyUI fica fixo no tema claro, como na tela do participante.

## 3. As telas

Rotas em hash, como no resto da plataforma.

### 3.1 Entrada — `/#/?t=<token_upload>`

- **O que é o link:** é o link que o operador entrega (ver §3.3). O `token_upload` é a credencial do fotógrafo naquele evento: não há senha.
- **O que a tela faz:** guarda o token no `localStorage` e segue para `/#/enviar`.
- **Sem token** (ou com token inválido): uma frase — "Este link de envio não é válido. Peça o link ao operador da estação."

### 3.2 Envio — `/#/enviar`

De cima para baixo:

1. **Cabeçalho:** selo, nome do evento, nome do fotógrafo e a situação da conexão com a estação:
   - "● Conectado à estação";
   - "Sem conexão com a estação — tentando de novo";
   - depois de 1 minuto sem conexão, esse aviso fica vermelho e o título da aba vira "⚠ Sem conexão".
2. **Aviso de retomada:** aparece quando ficou envio pendente de uma visita anterior. "N fotos ficaram pendentes da última vez. Solte a mesma pasta de novo para continuar — o que já chegou não é reenviado." Vem com o botão "Esquecer pendentes".
3. **Área de soltar:**
   - "Solte a pasta ou as fotos aqui — ou clique para escolher · só JPEG";
   - soltar uma pasta inclui as subpastas; clicar abre o seletor de arquivos (vários de uma vez).
4. **Quatro contadores:**

   | Contador | De onde vem |
   |---|---|
   | enviadas | navegador |
   | prontas na estação (publicadas, isto é, visíveis para os participantes) | estação |
   | esperando envio | navegador |
   | com erro | navegador + estação |

5. **Progresso geral:**
   - "N de M · P% · cerca de X min";
   - seletor "Enviar [3] por vez" (1 a 6);
   - botão "Pausar" / "Continuar".
6. **Enviando agora:** uma linha por arquivo em andamento, com nome, tamanho, barra e porcentagem ("preparando" enquanto calcula a impressão digital).
7. **Com erro:** arquivo e motivo em português, com "Tentar de novo" quando faz sentido. Os erros de processamento vindos da estação também aparecem aqui.
8. **Rodapé:**
   - "N fotos já estavam na estação e foram puladas";
   - "Deixe o notebook ligado e com esta tela aberta até terminar".

**Parada total.** Quando a estação responde que o link não aceita mais fotos (vínculo desativado ou evento encerrado), a fila para inteira e a tela mostra "Este link não aceita mais fotos. Fale com o operador da estação."

**Saída com envio em andamento.** Sair da página com fotos na fila faz o navegador pedir confirmação (`beforeunload`).

### 3.3 Painel da estação — `/#/estacao`

**Login.** Sem sessão, a rota mostra o login (login e senha do operador). A sessão dura 12 h.

**Sem evento em andamento.** A tela diz "Nenhum evento em andamento nesta estação." Havendo eventos abertos com outras datas, ela oferece escolher um deles; senão, acrescenta "Crie ou reative o evento no admin e aguarde a sincronização."

**Com evento.** O painel se atualiza a cada 2 s e mostra, de cima para baixo:

1. **Cabeçalho:** selo, "Estação", nome e datas do evento (com mais de um evento aberto, um seletor; a escolha fica guardada no navegador e é esquecida quando o evento fecha), situação do VPS ("VPS conectado · sincronizou há 20 s", ou em vermelho quando a última sincronização passou de 3 min) e "nome do operador · Sair".
2. **Quatro números:**
   - fotos/min (janela de 5 min);
   - tempo da chegada à publicação (p50, com o p95 ao lado);
   - taxa de erro (30 min);
   - placa de vídeo (uso % e VRAM usada de total; "—" quando o vision não informa).
3. **Fila por etapa do evento:** recebidas (`registrada`, mais os uploads completos que o processamento ainda não pegou), rostos, versões web (`derivados` em processamento) e esperando publicar.
4. **Fotógrafos do evento:** uma linha por vínculo ativo, com:
   - nome, enviadas, prontas e erros;
   - o link de upload com "Copiar" e um QR pequeno;
   - "QR grande" (abre o QR em tela cheia para o fotógrafo apontar o celular).

   O link usa o endereço da rede local configurado na estação; o do túnel aparece como segundo link, para quem está longe (§5.3).
5. **Erros de processamento:** arquivo, fotógrafo, etapa e mensagem, com "Reprocessar" por foto e "Reprocessar todos". Se o arquivo original não existe mais, a linha diz "Peça ao fotógrafo para reenviar" em vez do botão.
6. **Encerrar evento.**
   - **Quando habilita:** só quando nenhuma foto do evento está em processamento, isto é, fora de `publicada` e sem erro, ou recebida e ainda sem registro em `foto`. Fotos com erro não bloqueiam: uma foto corrompida que nunca processa não pode prender o evento para sempre.
   - **Confirmação:** "Encerrar apaga os rostos guardados nesta estação e os links param de aceitar fotos. As fotos publicadas continuam no ar." Havendo fotos com erro, ela acrescenta "N fotos com erro não serão publicadas".
   - **Depois:** o painel volta ao estado "nenhum evento em andamento".

## 4. O envio, foto a foto

### 4.1 Caminho de cada arquivo

1. **Filtro.**
   - Extensão fora de `.jpg`/`.jpeg` vai direto para "com erro": "Não é JPEG — exporte em JPEG para enviar."
   - Acima de 100 MB, também: "Foto maior que 100 MB."
2. **Impressão digital.**
   - É o SHA-256, calculado num Web Worker com `hash-wasm`, lendo o arquivo em pedaços. O `crypto.subtle` não existe em `http://<ip-da-LAN>`.
   - O resultado fica no IndexedDB, com chave `nome + tamanho + lastModified`: soltar a mesma pasta de novo não recalcula nada.
3. **`iniciarUpload`.** A estação responde uma de três coisas:
   - `ja_existe`: a foto é pulada e conta em "já estavam na estação". Vale se qualquer fotógrafo do evento já mandou aquela foto (`foto` com o mesmo `id_evento` e hash).
   - `continuar`: vem com `id_upload` e `bytes_recebidos`.
   - `novo`: vem com `id_upload`.
4. **Pedaços de 8 MB** (`UPLOAD_PEDACO_MB`), enviados por `PUT` com `Upload-Offset`. O progresso do arquivo vem do evento de progresso do envio, então a barra anda de forma contínua dentro do pedaço.
5. **Conferência final.** No último pedaço a estação recalcula o SHA-256.
   - Se bate: a foto entra no processamento.
   - Se não bate: a estação descarta. O navegador reenvia do zero, sozinho, uma vez; na segunda falha, marca "A foto chegou diferente do original" com "Tentar de novo".

### 4.2 Três tipos de falha

| Tipo | Exemplos | O que a fila faz |
|---|---|---|
| **Sem conexão** | rede caiu, estação reiniciando, sem resposta | Não conta tentativa e não marca erro. Espera e tenta de novo com intervalo crescente até 32 s, para sempre. A tela mostra o aviso de conexão (§3.2). |
| **Da estação inteira** | link desativado, evento encerrado, estação sem espaço | Para a fila inteira e mostra a mensagem. Sem espaço, "Continuar" tenta de novo; link inválido é definitivo. |
| **De uma foto** | não é JPEG pelos bytes, erro 5xx naquela foto | Até 6 tentativas, com espera de 1 s a 32 s; depois marca só aquela foto e as outras seguem. |

A estação distingue os tipos pela resposta:

- **o próprio link ou o evento:** 422 com um `codigo` estável: `link_invalido`, `evento_encerrado`;
- **sem espaço em disco:** 507 com `codigo: "sem_espaco"`;
- **problema de uma foto:** 422 com `codigo: "nao_e_jpeg"` ou `"hash_diferente"`, ou 5xx.

A tela reage ao código, nunca ao texto da mensagem.

### 4.3 Pausar, fechar e voltar

- **"Pausar"** deixa terminar o pedaço que está no ar e não começa outro. "Continuar" retoma.
- **O estado de cada arquivo fica no IndexedDB:** pendente, enviando, enviado, erro, `id_upload` e hash.
- **Ao reabrir o link:** os pendentes geram o aviso de retomada. O navegador não permite reabrir arquivos do computador sozinho, então o fotógrafo solta a pasta de novo. Os arquivos reconhecidos continuam de onde pararam (`continuar`) ou são pulados (`ja_existe`).
- **O estado é por token:** outro fotógrafo no mesmo notebook tem a sua própria fila.

### 4.4 Contadores e erros vindos da estação

- `statusUpload` é consultado a cada 5 s enquanto a tela está aberta.
- **Números** daquele fotógrafo no evento:
  - enviadas: `upload` completo;
  - prontas: `foto` publicada;
  - processando;
  - com erro: `foto` com `erro`.
- **Erros:** a lista (nome do arquivo e mensagem), traduzida para o fotógrafo. "A estação não conseguiu ler esta foto (arquivo corrompido)" é um exemplo; o detalhe técnico fica no painel.

## 5. API na estação

Tudo roda na API em papel `estacao`, no padrão do projeto (`route`/`ctrl`/`sql`, despacho por `{ call }`, `ErroTratado` → 422).

### 5.1 `_FOTOGRAFO/upload` — `POST /api/fotografo/upload`

Público. Toda chamada leva `token` (o `token_upload`). Um vínculo é válido quando está ativo (`ativo = 'S'`), com o evento ativo, não encerrado e não deletado.

| Chamada | Entrada | Saída |
|---|---|---|
| `getSessao` | `token` | `{ evento: { nome }, fotografo: { nome }, pedaco_bytes }` |
| `iniciarUpload` | `token, nome_arquivo, tamanho, hash_arquivo` | `{ situacao: "ja_existe" }` ou `{ situacao: "continuar" \| "novo", id_upload, bytes_recebidos }` |
| `statusUpload` | `token` | `{ enviadas, processando, prontas, com_erro, erros: [{ nome_arquivo, mensagem }] }` |

`iniciarUpload` em detalhe:

- **Valida as entradas:** hash com 64 hexadecimais, tamanho entre 1 byte e 100 MB, extensão JPEG.
- **Retomada.** Existindo um `upload` `recebendo` do mesmo vínculo com o mesmo hash, devolve `continuar`, com `bytes_recebidos` igual ao tamanho real do arquivo parcial em disco (o disco manda, não a coluna).

### 5.2 Envio dos pedaços — `PUT /api/fotografo/upload/:id_upload`

**É a única rota fora do `{ call }`,** porque o corpo é binário. Cabeçalhos: `X-Token-Upload` e `Upload-Offset`.

**Validação.**

- O upload precisa pertencer ao vínculo do token e estar `recebendo`.
- Um pedaço por vez por upload: há uma trava em memória por `id_upload`, e um segundo pedaço concorrente recebe 409 `em_curso` (sem `bytes_recebidos`). Quase sempre é o pedaço de uma conexão que caiu, que segura a trava até a estação desistir dele: o navegador espera, com intervalos crescentes, e manda de novo do mesmo byte, sem gastar tentativa da foto.

**Gravação.**

- **Offset:** se `Upload-Offset` for diferente do tamanho atual do arquivo parcial, responde 409 `{ bytes_recebidos }`. O navegador segue de lá.
- **Destino:** o corpo vai em stream para `RAIZ_UPLOADS/<id_upload>.part` (padrão `/data/originais/_uploads`, no mesmo volume dos originais, para o processamento só renomear).
- **Limite:** o pedaço passa de `UPLOAD_PEDACO_MB` → 413. O arquivo ficaria maior que o `tamanho` declarado → 422.
- **Primeiro pedaço:** confere os bytes mágicos do JPEG (`FF D8 FF`). Se não for JPEG, apaga e responde 422 `nao_e_jpeg`.
- **Disco cheio:** `ENOSPC` → 507 `sem_espaco`.

**Último pedaço** (o arquivo atingiu o `tamanho`): a estação recalcula o SHA-256 em stream.

- **Se bate:** marca `completo` e enfileira `processar-foto` com `origem` = o arquivo parcial, `copiar: false`, `id_evento_fotografo` do vínculo e o mesmo `jobId` (`<id_evento>_<hash>`) que a CLI usa.
- **Se não bate:** apaga o arquivo, marca `cancelado` e responde 422 `hash_diferente`.

**Resposta:** `{ bytes_recebidos, completo }`.

### 5.3 `_PAINEL` — `POST /api/painel/<modulo>`

Com sessão do operador, exceto o login.

| Módulo · chamada | O que faz |
|---|---|
| `login.login { login, senha }` | Confere com os operadores sincronizados (`deletado = 'N'`), com o mesmo hash de senha do admin. Devolve o token da sessão (12 h) e o nome. Limite de 10 tentativas por IP a cada 10 min. |
| `painel.getPainel { id_evento? }` | Uma chamada com tudo o que a tela mostra (§3.3). `id_evento` é o evento escolhido pelo operador; se ele não estiver mais aberto, vale a regra de datas. |
| `painel.reprocessar { id_foto \| id_evento }` | Com `id_foto`, uma foto; com `id_evento`, todas as do evento com erro. Limpa `erro` e reenfileira `processar-foto` a partir de `caminho_original` (ou do arquivo parcial, se o erro foi antes da etapa `original`). Erro de publicação: tira também o job de `publicar-foto` que falhou e, se alguma versão web sumiu, volta a foto para `rostos` para gerá-las de novo. Sem arquivo em disco, responde que não há o que reprocessar. |
| `painel.encerrarEvento { id_evento }` | Recusa com 422 se houver foto em processamento (fora de `publicada` e sem erro). Senão, grava `encerrado_em`, apaga os `rosto` e `numero_peito` do evento na estação (plataforma §10) e devolve o painel vazio. |

O que `getPainel` reúne:

- **Evento em andamento:** entre os eventos com `ativo = 'S'`, não encerrados e não deletados, o que está acontecendo hoje no fuso `America/Sao_Paulo`: de `data_inicio` (ou `data_fim`, se não houver início) até 3 dias depois de `data_fim`, para os envios dos dias seguintes. Dois ao mesmo tempo: o que começou por último. Não é o mais recente: a sincronização traz também os eventos cadastrados com antecedência. Nenhum acontecendo: `evento: null`.
- **Eventos abertos:** os 30 mais próximos de hoje, para o seletor (o escolhido entra mesmo se estiver longe).
- **Métricas:** as que o sinal já monta (`montarSinal`).
- **Fila por etapa:** filtrada pelo evento.
- **Situação do VPS:** a última sincronização bem-sucedida, que o job de sincronização passa a registrar no Redis.
- **Fotógrafos:** vínculos ativos do evento, com contagens e `token_upload`.
- **Erros:** os 50 mais recentes.
- **Endereços:** os de `ENDERECO_LAN` e `ENDERECO_TUNEL`.

**Endereços dos links:** as variáveis novas `ENDERECO_LAN` (ex.: `http://192.168.0.10`) e `ENDERECO_TUNEL` (ex.: `https://estacao.exemplo.com.br`) no `.env.estacao`.

- O link de cada fotógrafo é `<endereço>/#/?t=<token>`.
- Sem `ENDERECO_LAN`, o painel usa o endereço pelo qual ele próprio foi aberto e avisa quando ele é `localhost`, que não serve para o celular do fotógrafo.

### 5.4 Limpeza

Um job diário apaga arquivos parciais de uploads `recebendo` sem pedaço novo há 24 h e os marca `cancelado`, para envio abandonado não encher o disco da estação.

## 6. Arquitetura da tela

- **App novo** `apps/web-fotografo`, workspace npm, com a mesma base do `web-participante`:
  - Vue 3.5, Vite, TypeScript `strict`, `<script setup lang="ts">`;
  - Tailwind 4 + daisyUI 5 fixo no tema claro;
  - axios com corpo `{ call }`;
  - `createWebHashHistory`;
  - uma pasta por tela (`index.vue` + `<tela>.ts` com `state`/`actions` + `services/`);
  - tudo em português.
- **Fila de envio num módulo TypeScript puro, sem Vue** (`ts/fila/`), que recebe as dependências por parâmetro: enviar pedaço, iniciar upload, calcular hash, relógio, armazenamento. A tela só assina o estado dela. É o que permite testar concorrência, pausa e os três tipos de falha sem navegador.
- **Impressão digital:** Web Worker com `hash-wasm`.
- **Armazenamento:** IndexedDB via `idb-keyval`.
- **QR:** gerado no navegador com a biblioteca `qrcode`.
- **Painel:** atualização por consulta a cada 2 s, sem WebSocket.

## 7. Como sobe

- **Estação:**
  - um serviço `web` novo no `docker-compose.estacao.yml`: nginx com o build do app feito dentro da imagem, como no VPS;
  - o Traefik da estação manda `/api` e `/test` para a API e o resto para o `web`; funciona igual pela rede local e pelo túnel;
  - a API passa a montar o volume dos originais (para gravar os arquivos parciais);
  - `.env.estacao.example` ganha `ENDERECO_LAN`, `ENDERECO_TUNEL` e `UPLOAD_PEDACO_MB`.
- **Desenvolvimento:**
  - `npm run dev -w apps/web-fotografo`, com o Vite encaminhando `/api` para a API da estação de dev (`127.0.0.1:3001`);
  - no compose de dev, o `api-estacao` também monta o volume dos originais.

## 8. Testes

- **API, unidade (`node:test`):** as regras puras:
  - decisão do offset;
  - bytes mágicos do JPEG;
  - validação de `iniciarUpload`;
  - tradução dos erros da foto para o fotógrafo;
  - escolha do evento em andamento;
  - montagem dos links.
- **API, integração (Postgres e disco de verdade):**
  - `getSessao`, com vínculo desativado e evento encerrado;
  - `iniciarUpload` nas três respostas;
  - `PUT` em ordem e fora de ordem;
  - primeiro pedaço que não é JPEG;
  - hash diferente;
  - hash certo, que enfileira o job com a origem certa;
  - `statusUpload`;
  - login (senha certa e errada, limite);
  - `getPainel`, `reprocessar`;
  - `encerrarEvento`, recusando com foto em processamento, aceitando com foto em erro e apagando os rostos.
- **Tela, unidade (Vitest):** a fila, a fundo:
  - N por vez;
  - pausar e continuar;
  - sem conexão espera sem desistir;
  - erro da estação inteira para tudo;
  - erro de uma foto tenta 6 vezes;
  - hash diferente reenvia uma vez;
  - retomada pelo IndexedDB.

  E as funções puras (tempo estimado, filtro de arquivos, leitura de pastas).
- **Tela, montada (Vue Test Utils):** envio (contadores, aviso de retomada, parada total, aviso de conexão), login e painel (fotógrafos com link, encerrar desabilitado com fila).
- **Ponta a ponta no Chrome, contra o compose de dev:**
  - subir uma pasta de fotos de verdade;
  - cortar a rede no meio e ver a fila esperar e continuar sozinha;
  - fechar e reabrir a aba e retomar;
  - conferir no painel os números, o QR e o reprocessar;
  - documentado em `docs/desenvolvimento.md`.

## 9. Onde este documento se afasta da spec da plataforma

- **Link e QR de upload no painel da estação,** e não só no `web-admin`. O admin ainda não existe (fase 7), e só a estação sabe o próprio endereço na rede local do evento.
- **A fila é testada com Vitest, e não com `node:test`:** é o executor do resto do app, e o módulo continua sem Vue.
- **Painel de um evento só:** a estação atende um evento por vez.
- **Contagens do painel e do fotógrafo por evento;** a fila de jobs e a placa de vídeo continuam somando tudo.

## 10. Fora desta etapa

- **`web-admin`** (fase 7): cadastro de fotógrafo e vínculo continuam pela API do admin no VPS.
- **Pastas reabertas sozinhas:** o File System Access API exige contexto seguro, e a estação na rede local é `http`.
- **Fotógrafo ver miniaturas das próprias fotos ou apagar uma foto enviada:** a moderação é do admin.
- **Formatos além de JPEG** (HEIC, RAW).
