# web-participante — design das telas

A tela que o participante do evento abre no celular: manda uma selfie e recebe as fotos em que aparece.

Este documento detalha a seção 9 do [design da plataforma](2026-09-18-plataforma-fotos-design.md) para o app `web-participante`, e só para ele. O que vale lá continua valendo aqui; onde este documento for mais específico, ele manda.

## 1. Objetivo

Substituir os comandos de terminal pela experiência real do cliente final: abrir um link, tirar uma selfie e ver as fotos dele. É a primeira tela do projeto, e é a cara do produto para quem paga o evento.

**Público decidido:** corridas e provas esportivas. O corredor abre o link no celular, muitas vezes no sol, logo depois da prova ou em casa à noite.

**Sucesso:** um corredor que nunca viu o sistema consegue, sozinho e sem instrução, sair do link com as fotos dele salvas no celular.

## 2. Identidade visual — "Largada"

Escolhida entre três direções, comparadas lado a lado no navegador.

| Elemento | Decisão |
|---|---|
| Fundo | Gradiente `168deg`, `#ff6b35` → `#f7414f` (52%) → `#c81d5a` |
| Sobre o gradiente | Branco; textos secundários em `rgba(255,255,255,.82)` |
| Ação principal | Pílula branca (`border-radius: 999px`) com texto `#c81d5a` |
| Ação secundária | Pílula vazada: `rgba(255,255,255,.16)` com texto branco |
| Caixas e blocos | `rgba(255,255,255,.14)`, cantos de 13px |
| Fotos | Cantos de 13px na grade; sem cantos quando aberta em tela cheia |
| Títulos | 800, `letter-spacing: -.02em`, tamanho 19–22px |
| Rótulo acima do título | 10px, `letter-spacing: .12em`, maiúsculas, peso 700 |
| Fundo de foto aberta | `#0e0e12` sólido — a foto manda, o gradiente sai de cena |
| Fonte | Pilha do sistema (`system-ui`): carrega instantâneo e parece nativa em cada aparelho |

Sem modo escuro: o gradiente já é escuro o bastante e o app tem cinco telas. O `prefers-color-scheme` não muda nada.

**Patrocinadores** (spec §8) entram como faixa de logos sobre fundo branco, no rodapé das telas de evento e de resultado. Fundo branco porque logo colorido sobre o gradiente fica ilegível.

## 3. As cinco telas

O desenho foi validado tela a tela no navegador. A ordem é a do corredor, não a do código.

### 3.1 Entrada: câmera direto

**Rotas:** `/#/e/<slug>` (evento público) e `/#/p/<chave_acesso>` (evento privado). Evento privado nunca abre pelo slug — a API já recusa, e a tela mostra "Evento não encontrado. Confira o link."

Abre já na câmera frontal, com moldura oval no centro, sobre a imagem ao vivo. Sobreposto na parte de baixo: o título "Encaixe seu rosto e toque" e o consentimento.

- **Consentimento** é um visto obrigatório, desmarcado no início: "Autorizo o uso da selfie para achar minhas fotos. Ela é apagada depois." com link "Termo" abrindo a tela de privacidade. Sem o visto, o disparo não dispara e o botão fica apagado.
- **Barra inferior:** "Galeria" à esquerda, disparo no centro, "Virar" à direita.
- **Permissão negada** (o risco conhecido dessa escolha): a tela troca na hora para um estado que explica em uma frase o que o serviço faz e oferece o botão "Escolher da galeria" em destaque. Nunca fica uma tela preta sem saída.
- **Sem `getUserMedia`** (navegador antigo, contexto sem HTTPS): mesma tela do caso acima, direto.
- A captura respeita a orientação do aparelho e reduz para 1280 px no `canvas` antes de enviar, como a spec §8 determina.
- Até `max_selfies` fotos (padrão 3): depois do primeiro disparo, a tela oferece "Adicionar outra" ou "Buscar agora".

### 3.2 Procurando

Mostra a miniatura da selfie enviada, "Procurando você" e "Olhando N fotos da prova", com três pontos animados. O N vem do total de fotos do evento.

A busca leva segundos; esta tela existe para que a espera tenha tamanho e não pareça travamento. Se passar de 20 segundos, a API responde "Muita gente buscando agora, tente em instantes" e a tela mostra essa mensagem com o botão "Tentar de novo".

### 3.3 Resultado

**Rota:** `/#/r/<token>`, para onde a tela navega assim que a busca libera — e que o participante pode reabrir depois.

- Rótulo com nome do evento, título "N fotos suas".
- Grade de duas colunas, foto em cantos arredondados. A primeira traz um selo com a porcentagem de semelhança; as demais não, para não virar planilha.
- "Baixar todas (ZIP)" como ação principal. Enquanto o worker monta, o botão vira "Preparando… " e volta pronto com o link.
- Rodapé: "Chegaram fotos novas? Buscar de novo" — as fotos chegam durante o evento, e esse botão refaz a busca reaproveitando a verificação já feita (`token_origem`).
- Aviso de validade quando o evento tem prazo: "Disponível até dd/mm".

### 3.4 Foto aberta

Toque numa foto abre em tela cheia sobre fundo `#0e0e12`, com deslizar para a próxima. Dois botões: **Salvar** e **Compartilhar**.

No celular, "Compartilhar" usa `navigator.share({ files })` quando o navegador aceita — abre o menu do sistema com a foto anexada, que é como as pessoas mandam para o WhatsApp. Quando não aceita, o botão some e sobra "Salvar", que baixa o arquivo pelo link assinado com `?dl=1`.

### 3.5 Não achou nada

Lupa, "Ainda não achamos você" e a explicação: "Os fotógrafos ainda estão mandando fotos da prova. Volte mais tarde e tente de novo." Botão "Tentar outra selfie".

Não pede telefone, não pede cadastro, não culpa o participante e não sugere que ele tirou uma selfie ruim — pela spec §8, zero fotos é `liberada` com `qtd_fotos = 0` e não dispara verificação nenhuma.

### 3.6 Telas de apoio

- **`/#/privacidade`** — termo completo, o que é guardado, por quanto tempo, como pedir exclusão, contato. Texto versionado; a versão exibida é a que a busca grava em `versao_termo`.
- **`/#/a/<chave_anfitriao>`** — galeria do anfitrião: quem organizou vê o evento inteiro, sem selfie. Mesma grade da tela de resultado, paginada de 60 em 60, com "Baixar tudo" em partes.

## 4. Estados que a tela precisa tratar

O caminho feliz é um dos casos; estes são os outros, todos com mensagem em português voltada ao participante.

| Situação | O que a API devolve | O que a tela mostra |
|---|---|---|
| Selfie sem rosto, vários rostos, tremida, rosto pequeno | 422 com a mensagem pronta do vision | A mensagem do vision e o botão "Tentar outra selfie" |
| Arquivo que não é imagem, ou acima de 8 MB | erro de negócio | A mensagem da API, sem sair da câmera |
| Limite de buscas do IP estourado | 422 "Muitas buscas seguidas…" | A mensagem e o botão "Tentar de novo" desabilitado por 30 s |
| Evento não encontrado, inativo ou privado pelo slug | 422 | "Evento não encontrado. Confira o link." |
| Token de resultado vencido ou inválido | 422 | "O prazo para baixar estas fotos venceu. Faça a busca de novo." com botão que volta para a câmera |
| Busca ainda `aguardando` (quando o WhatsApp existir) | `status: "aguardando"` | Tela de verificação — **fora desta etapa**, ver seção 6 |
| Sem internet no meio da busca | falha de rede | "Perdemos a conexão. Tente de novo." sem perder a selfie já tirada |

## 5. Arquitetura

Segue o padrão do `erp_admin_v2`, com as diferenças que a spec §4 já fixa.

- **Vue 3.5 + Vite + TypeScript `strict`**, `<script setup lang="ts">`.
- **Rotas por pasta**, `createWebHashHistory` — as rotas do spec são hash (`/#/e/<slug>`).
- **Uma pasta por tela:** `pages/<tela>/index.vue` (template, chama `actions.init()` no `nextTick`), `<tela>.ts` (`export const state = reactive({...})` e `export const actions = {...}`), `interfaces.ts`, `services/<tela>.service.ts` (axios) e `components/` quando precisar.
- **Tailwind 4 + daisyUI 5**, com a paleta da seção 2 deste documento no lugar das cores do ERP.
- **axios global**, corpo `{ call, ... }`, como toda a API do projeto.
- **SweetAlert2** só para confirmação destrutiva; erro de busca é mostrado na própria tela, não em modal — no celular, modal de erro sobre a câmera atrapalha.
- **Sem store global.** Cinco telas, estado curto: o `state` de cada tela basta. O token da busca vem na URL (`/#/r/<token>`); o `sessionStorage` guarda só o token da busca anterior, que o "buscar de novo" manda como `token_origem`.
- **Tudo em português**, incluindo nomes de variáveis e comentários.

### Consentimento de marketing

A API exige `aceita_marketing` em toda busca, e na spec da plataforma esse visto opcional
aparece na tela de verificação por WhatsApp — que não existe nesta etapa. Enquanto ela não
existe, a tela envia `"N"`: ninguém entra em lista de marketing sem ter dito que sim. O visto
opcional entra junto com a tela de verificação, na parte 2, com o nome do organizador do
evento no texto, como a spec §8 descreve.

### Chamadas usadas

Todas já existem e estão testadas (fase 4, parte 1):

| Tela | Chamada |
|---|---|
| Entrada | `POST /api/participante/busca` `{ call: "buscar" }` — multipart com `slug` ou `chave_acesso`, `versao_termo`, `aceita_marketing`, `selfies[]` |
| Resultado | `{ call: "getResultado", token }`, `{ call: "gerarLinks", token, ids }` |
| Resultado (ZIP) | `{ call: "pedirZip", token }` e `{ call: "situacaoZip", token, id_arquivo_zip }` |
| Espera (futuro) | `{ call: "situacao", token }` — já existe, usada quando o WhatsApp entrar |
| Anfitrião | `POST /api/anfitriao/galeria` `{ call: "getGaleria", chave, offset }` e `{ call: "pedirZip", chave }` |

As imagens **não** passam pela API: as URLs vêm assinadas na resposta e o navegador busca direto no `/arquivos` (nginx). Em desenvolvimento isso é `127.0.0.1:8080`; em produção é o mesmo domínio, roteado pelo Traefik.

### Onde mora e como sobe

`apps/web-participante/`, workspace npm novo. Em desenvolvimento, `npm run dev -w apps/web-participante` com proxy do Vite para a API e para `/arquivos`, para o navegador ver tudo na mesma origem. Em produção, `npm run build` gera estáticos que o nginx serve — o mesmo container que já entrega as fotos.

## 6. Fora desta etapa

- **Verificação por WhatsApp.** Não existe na API (é a parte 2 da fase 4) e, no projeto, passará pelo **Chatwoot**, não pela Cloud API da Meta — a §8 da spec da plataforma está desatualizada nesse ponto. Enquanto isso, os eventos rodam com `exigir_whatsapp: false` e o corredor vai da selfie direto às fotos. Quando entrar, vira uma tela entre "Procurando" e "Resultado", sem mexer nas outras.
- **Faixa de patrocinadores.** O desenho está definido na seção 2, mas a API de patrocinadores é da parte 2. A tela deixa o espaço pronto e não renderiza nada enquanto a lista vier vazia.
- **web-fotografo e web-admin.** Fases 5 e 7, cada uma com spec e plano próprios.
- **App instalável (PWA), notificação push e multi-idioma.** Nada disso está na spec da plataforma; entra se o produto pedir.

## 7. Testes

- **Vitest** para as funções puras: redução da selfie no canvas, montagem da URL do arquivo, formatação de validade, decisão de qual estado de erro mostrar para cada resposta da API.
- **Vue Test Utils** para as telas: que o disparo só funciona com o consentimento marcado, que a permissão negada leva ao estado de galeria, que zero fotos mostra a tela certa e não pede nada, que o token vencido manda de volta para a câmera.
- **Teste de ponta a ponta manual**, documentado em `docs/desenvolvimento.md`: subir o compose, rodar `npm run demo-evento` para ter um evento com fotos, abrir a tela no navegador e fazer a busca com uma selfie de verdade — inclusive pelo celular na mesma rede.
- Sem Playwright nesta etapa: cinco telas, e o custo de manter o navegador headless no CI não se paga ainda.
