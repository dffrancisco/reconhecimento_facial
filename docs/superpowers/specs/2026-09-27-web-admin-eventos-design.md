# web-admin — eventos e fotógrafos

A primeira versão do admin: o operador cria e ajusta eventos, vê os links do evento e vincula os fotógrafos, sem chamar a API na mão.

Este documento detalha uma parte da fase 7 e a seção 9 do [design da plataforma](2026-09-18-plataforma-fotos-design.md). O que vale lá continua valendo aqui; onde este documento for mais específico, ele manda.

## 1. Objetivo

Hoje o evento, o fotógrafo e o vínculo nascem pelos arquivos `.http` do `_ADMIN`: login, copiar token, criar, editar a config, criar o fotógrafo, vincular. Esta etapa troca isso por telas.

**Sucesso:** o operador entra no admin, cria o evento, adiciona os fotógrafos e, em até 60 s, o evento aparece no painel da estação com os links de upload. Dali o fluxo que já existe segue: fotos pela estação, selfie no app do participante.

## 2. Identidade visual

A mesma "Claro e limpo" do painel da estação ([web-fotografo §2](2026-09-26-web-fotografo-design.md)): as duas são ferramentas do operador. Fundo `#f6f6f8`, superfícies brancas com borda `#e6e6ea`, ação principal em pílula escura, rótulos de seção em maiúsculas pequenas, fonte do sistema. O selo com o gradiente Largada fica ao lado de "Admin" no cabeçalho.

Sem modo escuro: o daisyUI fica fixo no tema claro, como nos outros dois apps.

## 3. As telas

Todas as telas, menos a de entrada, têm o cabeçalho: selo, "Admin", link "Eventos" e "nome do operador · Sair".

### 3.1 Entrar — `/#/entrar`

- Login e senha do operador, os mesmos do painel da estação.
- Senha errada: "Login ou senha inválidos." Passou do limite: "Muitas tentativas. Espere alguns minutos."
- A sessão (token e nome) fica no `localStorage` e dura 12 h. Qualquer resposta com `codigo: "sessao_expirada"` apaga a sessão e volta para esta tela com a mensagem da API.
- Sem sessão, qualquer outra rota leva para cá.

### 3.2 Eventos — `/#/`

- Tabela com nome, período ("27/09/2026" ou "10/10/2026 a 11/10/2026"), tipo, acesso (público ou privado) e situação (ativo ou inativo), mais recentes primeiro.
- Clicar numa linha abre a página do evento.
- Botão "Novo evento".
- Sem eventos: "Nenhum evento ainda. Crie o primeiro."

### 3.3 Novo evento — `/#/eventos/novo`

| Campo | Regra |
|---|---|
| Nome | Obrigatório. |
| Endereço | O `slug`. Montado a partir do nome enquanto o operador não mexe nele: minúsculas, sem acento, espaços e símbolos viram hífen, sem hífen repetido nem nas pontas, até 80 caracteres. Editável. Texto de apoio: "Vai no link do participante quando o evento é público." |
| Tipo | Esportivo ou social. |
| Início e fim | Datas; as duas começam com hoje. O fim não pode ser antes do início. |
| Acesso | Público ou privado. Acompanha o tipo (social → privado) até o operador mexer nele. |
| Exigir WhatsApp | Começa **desligado**, com o aviso: "A verificação por WhatsApp ainda não existe: ligado, o participante não vê as fotos." |

- "Criar evento" chama `criarEvento` e abre a página do evento.
- Os erros da API aparecem acima do botão, sem apagar o que foi preenchido. O principal é "Esse endereço já é de outro evento."

### 3.4 Página do evento — `/#/eventos/<id_evento>`

Três blocos, de cima para baixo.

**Dados**

- Editáveis: nome, início e fim, acesso, ativo e, da `config`:
  - organizador (o nome que o participante vê);
  - exigir WhatsApp (com o mesmo aviso da criação);
  - marca d'água ligada ou desligada, mais "Enviar PNG" (até 2 MB). Texto de apoio: "Vale para as fotos processadas depois do envio."
- **Só leitura:** endereço e tipo. Mudar o endereço quebraria os links já distribuídos, e a API não aceita trocar nenhum dos dois.
- **"Avançado"**, recolhido:

  | Campo | Faixa |
  |---|---|
  | Limiar de semelhança | 0,20 a 0,80 |
  | Máximo de selfies | 1 a 5 |
  | Dias até apagar o evento | 1 a 3650 |
  | Validade do resultado, em dias | vazio (sem validade) ou 1 a 3650 |

- "Salvar" chama `editarEvento` e mostra "Salvo. A estação recebe a mudança em até 1 minuto."

**Links**

- **Do participante:**
  - evento público: `<ENDERECO_PARTICIPANTE>/#/e/<slug>`;
  - evento privado: `<ENDERECO_PARTICIPANTE>/#/p/<chave_acesso>`.
- **Do anfitrião:** `<ENDERECO_PARTICIPANTE>/#/a/<chave_anfitriao>`.
- Cada link aparece com "Copiar", QR pequeno e "QR grande" (em tela cheia, como no painel).
- **Evento inativo:** os links aparecem, com o aviso "Evento inativo: o participante não consegue buscar as fotos."
- **Sem `ENDERECO_PARTICIPANTE` no VPS:** no lugar dos links, "Configure ENDERECO_PARTICIPANTE no VPS para ver os links."

**Fotógrafos**

- Aviso fixo no topo do bloco: "O link e o QR de upload de cada fotógrafo aparecem no painel da estação."
- Lista dos vinculados (ativos): nome e telefone.
- **Adicionar:**
  - escolher um fotógrafo já cadastrado (a lista não traz os já vinculados) e clicar "Adicionar";
  - ou "Cadastrar novo": nome (obrigatório) e telefone (opcional). Cria o fotógrafo e já vincula.
- **"Remover do evento":**
  - pede confirmação: "O link de upload dele para de aceitar fotos. As fotos já enviadas continuam.";
  - desativa o vínculo;
  - adicionar de novo reativa o fotógrafo com um link novo.

## 4. API no VPS

Tudo em `_ADMIN`, com sessão do operador, exceto o login.

| Módulo · chamada | Mudança |
|---|---|
| `login.login` | Limite de 10 tentativas por IP a cada 10 min, como o login do painel. O admin passa a ter tela pública. |
| `evento.criarEvento` | Aceita também `data_inicio`, `privado` e `config` parcial, mesclada sobre o padrão do tipo. Recusa fim antes do início e `config` fora das faixas de §3.4. Endereço repetido (violação única do `slug`) vira "Esse endereço já é de outro evento." em vez de erro 500. |
| `evento.editarEvento` | As mesmas validações de datas e `config`. |
| `evento.obterEvento` | Passa a devolver `links: { participante, anfitriao }`, montados na API com `ENDERECO_PARTICIPANTE`, ou `links: null` sem essa configuração. |
| `fotografo.listarVinculos { id_evento }` | **Nova.** Os vínculos ativos do evento: `id_evento_fotografo`, `id_fotografo`, nome e telefone. Sem o token de upload: o admin não mostra o link. |
| `fotografo.vincularFotografo` | Se o vínculo existir desativado, reativa com um `token_upload` novo: um link antigo que vazou não volta a funcionar. Vínculo já ativo continua como está. |
| `fotografo.desvincularFotografo { id_evento_fotografo }` | **Nova.** Grava `ativo = 'N'`. A sincronização leva isso à estação, que já recusa upload de vínculo inativo. |

- **Regras puras:** a validação de datas e da `config` e a montagem dos links ficam em funções puras, testadas sem banco.
- **Configuração nova:** `ENDERECO_PARTICIPANTE` na API do VPS, opcional, com o mesmo formato de `ENDERECO_LAN` (URL sem barra no fim).
- **Sincronização:** a estação recebe as mudanças de evento e de vínculo no ciclo que já existe, a cada 60 s.

## 5. Arquitetura da tela

- **App novo** `apps/web-admin`, workspace npm, com a mesma base do `web-fotografo`:
  - Vue 3.5, Vite, TypeScript `strict`, `<script setup lang="ts">`;
  - Tailwind 4 + daisyUI 5, tema claro fixo;
  - axios com corpo `{ call }` e o token cru no `Authorization`;
  - `createWebHashHistory`, com guarda de rota para a sessão;
  - uma pasta por tela (`index.vue` + `<tela>.ts` com `state`/`actions` + `interfaces.ts` + `services/`);
  - QR com a biblioteca `qrcode`;
  - tudo em português.
- **Regras puras em `ts/`,** testadas com Vitest:
  - endereço a partir do nome;
  - período;
  - padrões que acompanham o tipo.
- **Mensagens na própria tela e confirmação num modal do daisyUI,** como nos outros dois apps.

## 6. Como sobe

- **Desenvolvimento:**
  - `npm run dev -w apps/web-admin` em `http://localhost:5175`, com o Vite encaminhando `/api` para a API do VPS de dev (`127.0.0.1:3002`);
  - no compose de dev, o `api-vps` ganha `ENDERECO_PARTICIPANTE=http://localhost:8080`.
- **Servida como em produção:** o `arquivos` do compose de dev também entrega o admin em `http://admin.localhost:8080`. Navegadores resolvem `*.localhost` para a própria máquina, então não é preciso mexer no `hosts`.
- **VPS:**
  - a imagem do nginx (`infra/nginx/Dockerfile`) passa a fazer também o build do admin;
  - o template ganha um segundo `server` para `${DOMINIO_ADMIN}`, que só serve o app (sem `/arquivos`);
  - o `arquivos` recebe `DOMINIO_ADMIN` no ambiente;
  - o Traefik ganha o roteador `admin` (`Host(DOMINIO_ADMIN)`) para o `arquivos`. O `/api` desse host continua indo para a API pela regra mais longa, que o Traefik prioriza;
  - a API recebe `ENDERECO_PARTICIPANTE=https://${DOMINIO_PARTICIPANTE}` no compose, então não há variável nova para preencher no `.env.vps`.

## 7. Testes

- **API, unidade (`node:test`):**
  - validação de datas e de cada faixa da `config`;
  - montagem dos links: público, privado e sem endereço.
- **API, integração (Postgres de verdade):**
  - `criarEvento` com `config` mesclada, endereço repetido e datas invertidas;
  - `editarEvento` com `config` fora da faixa;
  - `obterEvento` com os links;
  - `listarVinculos` trazendo só os ativos;
  - `desvincularFotografo`;
  - `vincularFotografo` reativando com token novo;
  - limite do login.
- **Tela, unidade (Vitest):**
  - endereço a partir do nome (acentos, espaços, símbolos, tamanho);
  - período.
- **Tela, montada (Vue Test Utils, serviços simulados):**
  - entrada, com sessão expirada voltando para ela;
  - lista, incluindo a vazia;
  - novo evento: endereço automático até ser editado, acesso acompanhando o tipo, WhatsApp desligado e erro de endereço repetido;
  - página do evento: salvar, links e QR, sem endereço configurado, adicionar existente, cadastrar novo, remover com confirmação.
- **Ponta a ponta, contra o compose de dev:**
  - criar o evento pelo admin;
  - ver o evento no painel da estação em até 60 s;
  - subir fotos pelo link;
  - fazer a busca por selfie no app do participante;
  - roteiro em `docs/desenvolvimento.md`.

## 8. Onde este documento se afasta da spec da plataforma

- **Identidade "Claro e limpo"** em vez das cores do `erp_admin_v2`, e sem modo escuro: é a mesma do painel da estação, a outra ferramenta do operador.
- **Sem SweetAlert2:** mensagens na tela e modal do daisyUI, como nos outros dois apps.
- **Link e QR de upload só no painel da estação:** só a estação sabe o próprio endereço na rede local do evento.
- **Cadastro de fotógrafo dentro da página do evento,** sem a tela `fotografos` por enquanto.
- **"Exigir WhatsApp" começa desligado no formulário** enquanto a verificação não existe. O padrão da API continua por tipo.

## 9. Fora desta etapa

- Fotos do evento (ocultar, mostrar, excluir).
- Patrocinadores.
- Engajamento e exportação CSV.
- LGPD (exclusão por telefone, expurgo agora).
- Calibração do limiar.
- Situação da estação.
- Log de auditoria.
- Tela só de fotógrafos (editar e excluir o cadastro).
- Excluir evento.
- Operadores (cadastro continua pela CLI `criar-operador`).
