# web-participante — melhorias pós-evento piloto

O evento piloto rodou e o cliente aprovou o sistema. Este documento cobre as melhorias pedidas por ele, mais a repaginação visual do app do participante. Complementa o [design do web-participante](2026-09-26-web-participante-design.md); o que vale lá continua valendo, e onde este documento for mais específico, ele manda.

## 1. O que o cliente pediu

1. **Ver todas as fotos do evento** — participantes reclamaram que o reconhecimento não achou as fotos deles e não havia saída.
2. **Um link só para evento de dois dias**, com escolha do dia dentro da página.
3. **Não pedir selfie de novo** a quem já buscou naquele celular — mas manter a opção de tirar outra.
4. **"Salvar" ruim no iPhone** — o link `?dl=1` abre a foto numa aba em vez de salvar. Compartilhar funciona melhor; consolidar num botão só.

Referência de funcionamento citada pelo cliente: página de evento do Foco Radical (busca por selfie + ver todas, num link só).

**Decisões tomadas com o desenvolvedor:**

| Decisão | Escolha |
|---|---|
| Quem vê "todas as fotos" | Qualquer um com o link do evento (evento privado continua exigindo a `chave_acesso` do link) |
| Escolha do dia | Chips de dia na galeria "todas as fotos"; o resultado da selfie segue mostrando todos os dias juntos |
| Lembrar o participante | Token do resultado + selfie reduzida guardados **no aparelho** (IndexedDB); nada novo no servidor |
| Salvar/Compartilhar | Um botão só, via folha de compartilhamento do sistema quando houver suporte |
| Layout | Repaginar o app inteiro, mantendo a identidade "largada" disciplinada |

## 2. Home do evento

O link do evento deixa de abrir direto na câmera e vira a **home do evento** — a mesma URL que já foi distribuída (`/#/e/<slug>` e `/#/p/<chave_acesso>`) passa a renderizar a home; nenhum link impresso quebra.

A home mostra, sobre o gradiente largada:

- Nome do evento em destaque (o elemento memorável da repaginação — grande, como um número de peito).
- Data ou intervalo de datas, e o total de fotos publicadas.
- **"Buscar minhas fotos"** — ação principal, leva à câmera (rota `/e/<slug>/selfie`).
- **"Ver todas as fotos"** — ação secundária, leva à galeria (rota `/e/<slug>/fotos`).
- Quando o aparelho tem uma busca lembrada e válida (seção 4), a ação principal vira **"Minhas fotos (N)"**, indo direto a `/r/<token>`; "Buscar minhas fotos" desce para segunda ação.

A tela da câmera continua exatamente como está (consentimento, galeria, virar, estados de erro) — só muda de rota. Rotas privadas espelham as públicas: `/p/<chave>/selfie` e `/p/<chave>/fotos`.

## 3. Galeria "todas as fotos"

Nova rota da API: `POST /api/participante/galeria`, seguindo o padrão `call` do projeto. Identificação por `slug` **ou** `chave_acesso` — nunca pela `chave_anfitriao`, que continua exclusiva da galeria do anfitrião.

| Chamada | Entrada | Resposta |
|---|---|---|
| `getEvento` | `slug` \| `chave_acesso` | `{ nome, data_inicio, data_fim, total_fotos, dias: [{ dia, qtd }] }` |
| `getGaleria` | `slug` \| `chave_acesso`, `offset`, `dia?` | `{ fotos: [{ id_foto, thumb, web }] }` |

- A SQL reaproveita a da galeria do anfitrião: só `situacao = 'visivel'`, 60 por página, `ORDER BY capturada_em ASC NULLS LAST, id_foto`.
- `dias` são as datas distintas de `capturada_em` convertidas para `America/Sao_Paulo`, com contagem. Foto sem EXIF entra no dia do processamento — aceitável e já é o comportamento do campo.
- `dia` filtra por essa mesma conversão: `(capturada_em AT TIME ZONE 'America/Sao_Paulo')::date = <dia>`.
- `getEvento` também serve a home (nome, datas, total). Evento inativo, expurgado ou privado acessado por slug: 422 "Evento não encontrado. Confira o link.", como na busca.

Na tela:

- **Chips de dia** logo abaixo do título, só quando `dias` tem mais de um item: "Sáb 26 · 1.234" / "Dom 27 · 987". Trocar de chip zera a paginação. Sem chip selecionado não existe: um dia sempre está ativo (o primeiro, por padrão).
- Grade de 2 colunas, mesma do resultado, com "Ver mais fotos" no rodapé enquanto houver página.
- Toque abre o mesmo visualizador `FotoAberta` (swipe, salvar/compartilhar). O `gerarLinks` do resultado exige token de busca; na galeria a URL `web` assinada já vem na resposta, como na galeria do anfitrião.
- Sem ZIP na galeria pública (fora de escopo, seção 8).

**Custo assumido:** as URLs assinadas expiram em ~1 hora; quem deixar a aba aberta mais que isso verá quebra ao paginar fotos antigas já renderizadas — mesmo comportamento da galeria do anfitrião hoje, não muda nesta etapa.

## 4. Memória do aparelho

Ao concluir uma busca com sucesso, o app guarda **no aparelho**, via `idb-keyval` (mesma lib que o web-fotografo já usa):

```
memoria:<slug | chave_acesso> = {
  token,           // da busca
  qtd_fotos,
  validade_ate,    // vem do getResultado
  selfie,          // Blob JPEG reduzido, o mesmo enviado na busca
  criado_em
}
```

- **Home:** se existe memória e `validade_ate` não passou, mostra "Minhas fotos (N)". Se o `getResultado` responder token vencido, a tela limpa a memória e volta ao fluxo normal — a validade local é atalho, o servidor é quem manda.
- **"Chegaram fotos novas? Buscar de novo"** (no resultado): reenvia a selfie guardada direto para `{ call: "buscar" }`, com `token_origem`, **sem abrir a câmera**. A tela "Procurando você" aparece igual. Se a API recusar a selfie (422), a tela oferece "Tirar outra selfie" e cai na câmera.
- **"Tirar outra selfie"** continua existindo (na home, como link discreto, e no fluxo de erro): abre a câmera e, ao concluir a nova busca, sobrescreve a memória.
- Busca nova bem-sucedida sempre sobrescreve a memória do evento.
- **`chave_aparelho`:** UUID gerado uma vez (`crypto.randomUUID()`) e guardado em `localStorage`; passa a ser enviado em toda busca. A API já aceita (`route.busca.ts`); nada muda no servidor.

**Privacidade:** a selfie continua sendo apagada do servidor logo após a busca, como hoje. A cópia reduzida vive só no IndexedDB do aparelho do próprio participante e é sobrescrita a cada nova busca. A tela de privacidade ganha uma frase dizendo isso.

## 5. Salvar / Compartilhar

No visualizador `FotoAberta`, os botões "Salvar" e "Compartilhar" viram **um**:

- **Com `navigator.canShare({ files })`** (iPhone e Android atuais): botão **"Salvar / Compartilhar"** — baixa a foto por `fetch`, monta o `File` e chama `navigator.share`. A folha do sistema no iOS tem "Salvar imagem", que é o que resolve a reclamação. Mantém o tratamento atual do `NotAllowedError` ("Toque de novo para compartilhar").
- **Sem suporte** (desktop, navegador antigo): botão **"Baixar"** — o download por `?dl=1` de hoje, que no desktop funciona bem.
- Qualquer erro no compartilhar (fora o `NotAllowedError`) cai no download, como hoje.

A galeria do anfitrião não muda nesta etapa.

## 6. Repaginação visual

A identidade "largada" fica — o que muda é a disciplina: **o gradiente é marca, não fundo universal.** A regra passa a ser:

| Tela | Fundo |
|---|---|
| Home do evento, câmera, procurando, privacidade | Gradiente largada (como hoje) |
| Galeria, resultado, foto aberta | `#0e0e12` sólido (`--largada-foto`) — a foto manda |

Nas telas escuras: textos em branco/`rgba(255,255,255,.82)`, chips e botões com a pílula atual adaptada (fundo `rgba(255,255,255,.14)`, ativa em branco com texto `#c81d5a`). O selo de % e os rótulos seguem o sistema atual.

**Tipografia:** entra a **Bricolage Grotesque** (variável, self-hosted em woff2, subset latin) só para display — nome do evento na home, títulos de tela ("N fotos suas", "Todas as fotos"). Corpo, botões e rótulos continuam `system-ui`: quem abre é um corredor no sol, a página não pode esperar fonte. `font-display: swap` e a pilha do sistema como fallback; a fonte pesa ~30 KB e é o único asset novo.

**O que não entra:** animação decorativa (só as transições de resposta a toque que já existem), modo claro/escuro (as telas de foto são escuras por decisão, não por preferência do sistema), ícones novos.

**Piso de qualidade:** áreas de toque ≥ 44px, foco visível nos botões, `prefers-reduced-motion` respeitado nos pontinhos do "Procurando", contraste AA nos textos sobre `#0e0e12`.

## 7. Estados novos a tratar

| Situação | O que a tela mostra |
|---|---|
| Galeria de evento sem nenhuma foto publicada | "As fotos do evento ainda estão chegando. Volte mais tarde." na própria galeria |
| Memória com token vencido | Limpa a memória, home volta a "Buscar minhas fotos" — sem mensagem de erro |
| "Buscar de novo" com selfie guardada recusada pela API | Mensagem da API + botão "Tirar outra selfie" |
| IndexedDB indisponível (aba anônima, storage cheio) | App funciona como se não houvesse memória; gravação falha em silêncio |
| Troca de chip de dia com "Ver mais" já usado | Grade zera e recarrega do offset 0 do dia escolhido |

## 8. Fora desta etapa

- **ZIP na galeria pública.** O ZIP por busca (resultado) continua; o ZIP do evento inteiro segue exclusivo do anfitrião.
- **Liga/desliga da galeria pública por evento no admin.** Se algum cliente pedir galeria fechada, entra como campo em `evento.config`.
- **"Esquecer minha selfie" explícito.** A memória é sobrescrita a cada busca; um botão de apagar entra se houver pedido.
- **Embedding no servidor / re-busca automática.** A `chave_aparelho` enviada já prepara o terreno.
- **Dias/sessões como entidade no banco.** O dia é derivado de `capturada_em`; nenhuma migration nesta etapa.

## 9. Testes

- **Vitest**, funções puras: agrupamento de fotos por dia (fuso de São Paulo, foto sem EXIF), decisão do rótulo do botão (compartilhar vs. baixar), validade da memória (token vencido, sem memória, IndexedDB indisponível — mock), montagem do payload da re-busca com selfie guardada.
- **Vue Test Utils:** home com e sem memória válida; chips só aparecem com mais de um dia; trocar de chip zera a grade; galeria vazia mostra a mensagem certa.
- **API:** testes da rota `participante/galeria` no padrão das rotas existentes — evento público por slug, privado por chave, privado por slug recusado, filtro por dia, paginação.
- **Ponta a ponta manual** (`docs/desenvolvimento.md`): evento demo com fotos em dois dias distintos (ajustar `capturada_em` no `demo-evento` ou via SQL), fluxo completo no celular: home → galeria → dia → foto → salvar pelo share sheet; selfie → resultado → fechar aba → reabrir link → "Minhas fotos (N)" → "Buscar de novo" sem câmera.
