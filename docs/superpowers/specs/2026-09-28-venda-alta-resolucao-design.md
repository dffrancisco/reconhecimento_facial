# Venda de fotos em alta resolução

O participante compra, pelo site, o original das fotos em que aparece e paga por Pix (ou cartão) pelo Asaas. O original mora na estação: só o que foi vendido sai de lá, quando o pagamento confirma.

Este documento complementa o [design da plataforma](2026-09-18-plataforma-fotos-design.md), o do [web-fotografo](2026-09-26-web-fotografo-design.md) e o do [web-admin](2026-09-27-web-admin-eventos-design.md). O que vale lá continua valendo; onde este for mais específico, ele manda.

## 1. Objetivo

Hoje o participante baixa de graça a versão web (2048 px) das fotos dele. O original (em média 17 MB, direto da câmera) fica só na estação, como acervo. Esta etapa passa a vender esse original.

**Decisões do dono do produto:**

- **Pagamento automático no site, pelo Asaas** (a conta já existe): o original é liberado sozinho quando o pagamento confirma.
- **Preço por evento:** um valor por foto e, opcional, um valor de pacote ("todas as minhas fotos deste evento").
- **Entrega na própria página**, com um link da compra que vale 30 dias. Sem e-mail e sem WhatsApp nesta etapa.
- **Todo o dinheiro cai na conta Asaas do dono.** O admin mostra quanto cabe a cada fotógrafo, e o repasse é feito por fora.
- **O original sai da estação sob demanda:** só as fotos pagas, quando a estação está ligada. Nada vai para o servidor antes da venda.

**Sucesso:**

1. O participante acha as fotos pela selfie, marca algumas ou leva o pacote, paga o Pix pelo celular.
2. Em até um minuto (com a estação ligada), baixa os originais, sem marca d'água.
3. O operador vê a venda no admin, com a situação e o valor de cada fotógrafo.

## 2. O que o comprador vê

### 2.1 Na tela de resultado — `/#/r/<token>`

Só quando o evento tem a venda ligada e a busca está liberada:

- **Faixa no topo:** "Leve suas fotos em alta resolução: R$ 15 por foto" e, com pacote, "ou todas por R$ 49".
- **Cada foto ganha "Selecionar".** Com pelo menos uma marcada, aparece a barra fixa embaixo: "3 fotos · R$ 45 · Comprar".
- **Pacote:** botão "Comprar todas — R$ 49", com todas as fotos que a busca achou. Se o valor das marcadas passar o do pacote, a barra sugere: "Por R$ 49 você leva todas as 12."
- O download grátis da versão web continua como hoje.

### 2.2 Dados e pagamento

1. **Dados (ainda na tela de resultado, num painel que abre por cima):**
   - nome e CPF, com os dígitos do CPF conferidos na tela antes de enviar;
   - texto de apoio: "O Asaas, que processa o pagamento, pede o CPF de quem paga".
2. **"Gerar Pix"** cria o pedido e leva à página da compra, `/#/c/<chave>`. Esse endereço é o link para voltar depois. A rota nova entra antes do redirecionamento genérico do roteador.
3. **Pix:**
   - QR grande e botão "Copiar código Pix", com valor e prazo;
   - link "Pagar com cartão", que abre a fatura do Asaas em outra aba.
4. **A tela consulta a situação a cada 4 s:**
   - **aguardando** → mostra o Pix;
   - **pago** → "Pagamento confirmado! Preparando suas fotos em alta…";
   - **entregue** → a lista das fotos com "Baixar" em cada uma e "Baixar todas (ZIP)";
   - **problema** → "Tivemos um problema para preparar suas fotos. Fale com o organizador". O operador vê a mesma venda como problema no admin.
5. **Estação sem enviar:** enquanto a situação é "pago", a tela diz "Suas fotos saem do computador do fotógrafo. Se demorar, pode fechar esta página e voltar por este link", com botão para copiar o link.
6. **Prazo:** o link da compra vale 30 dias depois do pagamento. Passado isso: "O prazo para baixar estas fotos terminou."

## 3. O que o operador vê

### 3.1 Admin — página do evento, bloco "Venda em alta"

- **Campos:**
  - "Vender fotos em alta resolução" (liga/desliga);
  - preço por foto;
  - preço do pacote (vazio = sem pacote).
- **Valores:** em reais na tela, gravados em centavos. Mínimo de R$ 5,00 em cada um.
- **Avisos:**
  - **marca d'água desligada:** "A versão grátis sai sem marca d'água: o comprador pode achar que não precisa comprar";
  - **estação sem contato:** último sinal há mais de 5 min. "Estação sem contato há 3 h: as fotos pagas ficam esperando ela ligar";
  - **Asaas sem configuração no VPS:** "Configure o Asaas no VPS para ligar a venda", e o botão de ligar fica desabilitado.
- **Lista de vendas:** data, comprador (nome), fotos ou "pacote", valor, situação (aguardando pagamento, pago, entregue, problema, cancelado).
- **Totais:**
  - vendido no evento (só pagos e entregues);
  - por fotógrafo: soma do valor das fotos dele. No pacote, o valor se divide pela quantidade de fotos de cada fotógrafo no pacote.

### 3.2 Painel da estação

- **Linha nova:** "Vendas: 2 esperando envio", quando houver.
- **Com envio pendente e sem internet:** "Há fotos vendidas esperando envio. Mantenha a estação ligada e com internet."

## 4. Como funciona

```
participante ──(criarPedido)──▶ VPS ──(cliente + cobrança)──▶ Asaas
participante ◀──── Pix ──────── VPS
Asaas ──(aviso: pago)─────────▶ VPS        pedido: aguardando → pago
estação ──(originaisPendentes, a cada 10 s)──▶ VPS
estação ──(enviarOriginal: arquivo + hash)──▶ VPS        pedido: pago → entregue
participante ──(links assinados)──▶ nginx do VPS (/arquivos/vendidos/)
```

### 4.1 Configuração do evento

A `config` do evento ganha três campos, validados por `validarConfig` como os outros:

| Campo | Tipo | Regra |
|---|---|---|
| `venda_ligada` | boolean | padrão `false` |
| `preco_foto_centavos` | inteiro | ≥ 500 quando a venda está ligada |
| `preco_pacote_centavos` | inteiro ou `null` | ≥ 500 quando informado |

Ligar a venda sem o Asaas configurado no VPS é recusado com "Configure o Asaas no VPS para ligar a venda."

### 4.2 Tabelas novas no VPS (migration `vps`)

- **`pedido`:**
  - `id_pedido`, `id_evento`, `id_busca`;
  - `chave` (40 hex, única: o link da compra);
  - `tipo` (`fotos` | `pacote`), `valor_centavos`, `nome_comprador`;
  - `asaas_cliente`, `asaas_cobranca` (única);
  - `pix_payload`, `pix_imagem` (PNG em base64), `pix_expira_em`, `url_fatura`;
  - `status` (`aguardando` | `pago` | `entregue` | `problema` | `cancelado`);
  - `pago_em`, `entregue_em`, `expira_em` (= `pago_em` + 30 dias), `consultado_asaas_em`, `criado_em`.
- **`pedido_foto`:** `id_pedido`, `id_foto`, `hash_arquivo`, `id_evento_fotografo`, `valor_centavos` (a parte da foto no valor), `recebido_em`, `erro`. Chave primária (`id_pedido`, `id_foto`).
- **`asaas_evento`:** `id` do evento do Asaas (chave primária) e `recebido_em`. Evita processar o mesmo aviso duas vezes.
- **CPF:** não é guardado. Vai só para o Asaas, na criação do cliente.

### 4.3 Participante — `POST /api/participante/compra`

- **`criarPedido { token, ids? | pacote: true, nome, cpf }`:**
  - **Confere:**
    - a busca existe e está liberada;
    - o evento tem a venda ligada;
    - `ids` estão entre as fotos visíveis daquela busca;
    - nome com até 150 caracteres e CPF válido.
  - **Valor calculado aqui**, nunca vindo da tela: `ids.length × preco_foto` ou `preco_pacote`. Pacote sem preço configurado é recusado.
  - **Duplo clique:** se já existe um pedido `aguardando` da mesma busca com as mesmas fotos, criado há menos de 30 min, devolve esse mesmo pedido em vez de criar outra cobrança.
  - **No Asaas:**
    - `POST /v3/customers { name, cpfCnpj }`;
    - `POST /v3/payments { customer, billingType: "UNDEFINED", value, dueDate: amanhã, externalReference: id_pedido, description }`;
    - `GET /v3/payments/{id}/pixQrCode` para o QR.
  - **Devolve** `{ chave, valor_centavos, pix: { imagem, copia_e_cola, expira_em }, url_fatura }`.
  - **Limite:** 10 pedidos por IP a cada 10 minutos (como a busca).
- **`situacaoPedido { chave }`:**
  - devolve `{ status, evento, fotos: [{ id_foto, thumb, pronta }], expira_em, pix?, url_fatura? }`;
  - se o pedido está `aguardando` e o Asaas não foi consultado nos últimos 20 s, consulta `GET /v3/payments/{id}`. Assim a venda não depende só do aviso.
- **`linksPedido { chave, ids? }`:** links assinados (`/arquivos/vendidos/<id_evento>/<hash>.jpg`, com `dl=1`) das fotos já recebidas. Só com pedido `entregue` e dentro do prazo.
- **`pedirZipPedido { chave }` e `situacaoZipPedido`:** o ZIP dos originais, com o job de ZIP que já existe. A `arquivo_zip` ganha `id_pedido`, e o job lê de `/data/vendidos`.

### 4.4 Aviso do Asaas — `POST /api/pagamento/asaas`

- **Rota própria**, fora do `per`: o corpo do Asaas não tem `call`.
- **Confere o cabeçalho `asaas-access-token`** contra `ASAAS_WEBHOOK_TOKEN`, em tempo constante. Diferente: 401.
- **Deduplica pelo `id` do evento** (`asaas_evento`) e responde 200 logo depois de gravar.
- **`PAYMENT_RECEIVED` ou `PAYMENT_CONFIRMED`:** o pedido do `payment.externalReference` vai de `aguardando` para `pago` (com `pago_em` e `expira_em`), se o valor bate.
- **`PAYMENT_REFUNDED` ou `PAYMENT_DELETED`:** o pedido vira `cancelado`, e os links param.
- **Outros eventos:** só registrados.

### 4.5 Estação ↔ VPS — `POST /api/estacao/original`

Com a mesma chave da estação (`ESTACAO_CHAVE`) das outras chamadas de `_ESTACAO`.

- **`originaisPendentes`:** até 20 fotos de pedidos `pago` ainda sem `recebido_em`, com `{ id_pedido, id_foto, id_evento, hash_arquivo }`, e o total de pendentes.
- **`enviarOriginal`** (multipart: `id_pedido`, `id_foto`, `arquivo`):
  - **Confere o SHA-256 do arquivo** contra o `hash_arquivo`: diferente, 422.
  - **Grava** em `RAIZ_VENDIDOS/<id_evento>/<hash>.jpg`. Se o arquivo já existe, de outra venda, não grava de novo.
  - **Marca** `recebido_em`. Com todas as fotos do pedido recebidas, o pedido vira `entregue`.
  - **Tamanho:** a foto pode ter até 100 MB. O limite desta rota é 110 MB, maior que o limite geral de upload, e o nginx do `/api` passa a aceitar esse tamanho.
- **`originalNaoEncontrado { id_pedido, id_foto, motivo }`:** a foto recebe `erro` e o pedido vira `problema`.

### 4.6 Estação — job `entregar-originais`

- **A cada 10 s** (job repetido do BullMQ no worker da estação), chama `originaisPendentes`.
- **Para cada foto:**
  1. acha a `foto` local por (`id_evento`, `hash_arquivo`) e confere que o `caminho_original` existe;
  2. envia com `enviarOriginal`: duas por vez, com limite de 5 min cada, e tenta de novo no ciclo seguinte se falhar;
  3. se não achar a foto ou o arquivo, chama `originalNaoEncontrado`.
- **Painel:** o total de pendentes fica no Redis da estação.

### 4.7 VPS — arquivos e limpeza

- **Volume novo `vendidos`:** a API grava, e o `arquivos` (nginx) lê.
- **Nginx:** `location /arquivos/vendidos/`, com o mesmo `secure_link` das fotos e `Content-Disposition: attachment`.
- **Job diário no worker do VPS:**
  - apaga o arquivo vendido cujos pedidos estão todos vencidos (`expira_em` passou) ou cancelados;
  - pedido `aguardando` há mais de 24 h vira `cancelado`.
- **Expurgo do evento** (plataforma §10): apaga os arquivos vendidos e o `nome_comprador`. Valores e datas ficam, para a conta do evento.

### 4.8 Configuração nova no VPS

| Variável | Uso |
|---|---|
| `ASAAS_URL` | `https://api-sandbox.asaas.com/v3` (testes) ou `https://api.asaas.com/v3` (produção) |
| `ASAAS_API_KEY` | chave da conta (cabeçalho `access_token`) |
| `ASAAS_WEBHOOK_TOKEN` | código que o Asaas manda no aviso; o mesmo cadastrado no painel do Asaas |
| `RAIZ_VENDIDOS` | padrão `/data/vendidos` |

- **Obrigatórias só para vender:** sem as três do Asaas, a API sobe normalmente e a venda fica indisponível.
- **Guia de deploy:** onde pegar a chave, como cadastrar o aviso de pagamento (URL `https://fotoadmin.taap.com.br/api/pagamento/asaas`, eventos de cobrança, o código) e como trocar do sandbox para produção.

### 4.9 Admin — `POST /api/admin/venda`

- **`listarVendas { id_evento }`:** os pedidos do evento (sem o CPF, que nem existe aqui), os totais e a soma por fotógrafo.
- **`situacaoEstacao`:** o horário do último sinal, para o aviso da §3.1.

## 5. Erros e casos que precisam de cuidado

- **Pagamento que chega depois do vencimento do Pix:** o Asaas avisa normalmente, e o pedido vira `pago`. A limpeza de 24 h só cancela o que continua `aguardando`.
- **Aviso repetido ou fora de ordem:** a deduplicação e as transições só para a frente (`aguardando` → `pago` → `entregue`) tornam o reprocessamento inofensivo.
- **Estação entregando e caindo no meio:** `recebido_em` só é gravado depois do SHA-256 conferido. O ciclo seguinte manda de novo o que faltou.
- **Mesma foto em dois pedidos:** o arquivo é gravado uma vez, e cada `pedido_foto` recebe seu `recebido_em`.
- **Foto ocultada ou excluída pelo admin depois da venda:** a entrega segue, porque o comprador já pagou.
- **Evento com a venda desligada depois de vendas:** os pedidos existentes seguem até entregar, e novos pedidos são recusados.

## 6. Testes

- **Unidade (API):**
  - cálculo do valor e da parte de cada foto (inclusive o pacote dividido);
  - validação de CPF e da `config` de venda;
  - transições de situação;
  - conferência do token do aviso.
- **Integração (API, Postgres de verdade, Asaas simulado):** um servidor HTTP local responde como o Asaas (clientes, cobranças, QR, consulta). Cobre:
  - `criarPedido`, com ids de outra busca, pacote sem preço e duplo clique;
  - aviso: token errado, repetido, fora de ordem;
  - `originaisPendentes` e `enviarOriginal`, com hash errado, arquivo de 100 MB e duas vendas da mesma foto;
  - `linksPedido` dentro e fora do prazo;
  - limpeza.
- **Estação (integração):** o job `entregar-originais` contra um VPS simulado: envia, tenta de novo depois de falha e reporta original ausente.
- **Telas (Vitest):** seleção e barra de compra, sugestão do pacote, formulário com CPF, estados da página da compra; no admin, o bloco "Venda em alta" e a lista de vendas.
- **Ponta a ponta no sandbox do Asaas**, antes de ligar em produção:
  - evento de teste, busca e compra;
  - pagamento de teste confirmado no sandbox, aviso chegando ao VPS;
  - original saindo da estação e download.

## 7. Primeira verificação do plano

A documentação do Asaas não garante que o QR do Pix (`pixQrCode`) exista para cobrança `UNDEFINED`. A primeira tarefa do plano confere isso no sandbox:

- **Se existir:** fica `UNDEFINED`, com Pix na página e cartão na fatura.
- **Se não existir:** a cobrança passa a ser `PIX`, e o "Pagar com cartão" sai desta etapa.

## 8. Fora desta etapa

- Estorno pelo sistema (faz-se direto no Asaas; o aviso de estorno cancela o pedido).
- Divisão automática do pagamento (split).
- Envio da compra por e-mail ou WhatsApp.
- Cupom de desconto e faixas de preço.
- Relatório em planilha.
- Venda pela galeria do anfitrião.
- Envio dos originais em pedaços retomáveis. Nesta etapa, cada original vai inteiro num pedido, e a estação tenta de novo se cair.
- Cloudflare na frente do VPS com originais perto de 100 MB: o plano gratuito da Cloudflare limita cada envio a 100 MB. Hoje os domínios não passam pela Cloudflare.
