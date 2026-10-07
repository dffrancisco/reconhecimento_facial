# web-admin — excluir o evento e todas as fotos

Um jeito, no admin, de apagar um evento inteiro: as fotos do site, os originais dos fotógrafos na estação e tudo o que os participantes deixaram. Sem volta, e só depois de digitar o nome do evento.

Continua o [design do admin](2026-09-27-web-admin-eventos-design.md). Não é o expurgo da [plataforma](2026-09-18-plataforma-fotos-design.md) (§ retenção): o expurgo, quando existir, apaga as fotos e mantém o evento no admin; a exclusão tira o evento de vez.

## 1. Objetivo

Hoje não há como tirar um evento: um evento de teste, ou criado errado, fica no admin, no site e no disco para sempre.

**Sucesso:** o operador abre o evento, pede para excluir, digita o nome e confirma. O evento some da lista; em seguida o link do participante para de abrir e, em até 1 minuto, os originais e as cópias da estação também somem. Outro evento pode usar o mesmo endereço (slug).

## 2. A tela

### 2.1 O bloco no fim da página do evento

Depois de "Links", o último bloco da página:

```
┌──────────────────────────────────────────────────────────────────┐
│ EXCLUIR EVENTO                                                   │
│ Apaga o evento e todas as fotos, no site e na estação.           │
│ Não dá para desfazer.                         [ Excluir evento… ] │
└──────────────────────────────────────────────────────────────────┘
```

Borda e botão no vermelho de perigo (`botao-perigo`), para não ser confundido com os outros blocos.

### 2.2 A confirmação

```
┌────────────────────────────────────────────────────────────┐
│ Excluir CasaAlves para sempre?                             │
│                                                            │
│ Some tudo deste evento:                                    │
│  • as 29 fotos do site e os originais dos fotógrafos       │
│  • as buscas, os resultados e os ZIPs dos participantes    │
│  • a marca d'água e os links de upload                     │
│                                                            │
│ ┌────────────────────────────────────────────────────────┐ │
│ │ Não dá para desfazer. As fotos não podem ser           │ │
│ │ recuperadas. Se o evento estiver acontecendo, os       │ │
│ │ fotógrafos param de conseguir enviar.                  │ │
│ └────────────────────────────────────────────────────────┘ │
│                                                            │
│ Para confirmar, digite o nome do evento: CasaAlves         │
│ [                                                       ]  │
│                                                            │
│                 [ Cancelar ] [ Excluir para sempre ]       │
└────────────────────────────────────────────────────────────┘
```

- "Excluir para sempre" só libera quando o texto digitado, sem os espaços das pontas, é **igual** ao nome do evento, com maiúsculas e minúsculas como estão. Colar vale.
- O número de fotos vem do evento; sem foto nenhuma, a linha diz "as fotos do site e os originais dos fotógrafos", sem número.
- Enquanto exclui, o botão vira "Excluindo…" e a janela não fecha.
- Erro da API aparece dentro da janela, sem apagar o que foi digitado.
- Deu certo: volta para a lista de eventos, que mostra "Evento excluído." uma vez, acima da tabela.

## 3. No site (VPS)

`excluirEvento` no módulo `_ADMIN/evento`, com `id_evento` e `nome_confirmacao`.

1. Confere o nome de novo: `nome_confirmacao`, sem os espaços das pontas, igual ao nome do evento. Diferente: "O nome digitado não confere com o do evento." Quem chamar a API sem a tela não pula a confirmação.
2. Numa transação própria (com `statement_timeout` de 5 minutos, que um evento grande passa dos 30 s de sempre):
   - trava a linha do evento (`FOR UPDATE`);
   - conta as fotos, para o registro;
   - apaga as `foto` do evento (o `ON DELETE CASCADE` leva `rosto`, `numero_peito` e `busca_foto`);
   - apaga os `evento_fotografo` do evento (eles não têm cascade a partir do evento);
   - grava o registro em `evento_excluido`;
   - apaga o `evento` (o cascade leva `busca`, `arquivo_zip`, `participante_evento` com `aparelho`, `calibracao`, `evento_resumo` e `evento_patrocinador`).
3. Só depois do COMMIT, apaga do disco `RAIZ_FOTOS/<id_evento>/`, `RAIZ_ZIPS/<id_evento>/` e `RAIZ_MARCAS/<id_evento>.png`. Uma falha aqui fica no log e não desfaz a exclusão: sobra arquivo sem dono, nunca evento sem foto.

Ficam: os `fotografo` (podem estar em outros eventos), os `participante` (a pessoa pode ter buscado em outros eventos) e as contas `log`/`estacao_sinal`, que não são do evento.

### 3.1 O registro — `evento_excluido`

Migration nova, só no VPS:

| Coluna | |
|---|---|
| `id_evento` | `int PRIMARY KEY` (o id que o evento tinha) |
| `nome` | `varchar(150)` |
| `slug` | `varchar(80)` |
| `qtd_fotos` | `int` |
| `id_operador` | `int REFERENCES operador` — quem excluiu |
| `excluido_em` | `timestamptz DEFAULT now()` |

Sem dado de participante e sem foto. Serve para responder "quem apagou aquele evento?" e para avisar a estação (§4). O slug não fica preso: a tabela `evento` não tem mais a linha, e o próximo evento pode usar o mesmo endereço.

### 3.2 O que chega atrasado

- **Foto publicada pela estação depois da exclusão** (`POST /api/estacao/foto`): evento que não existe mais no VPS é respondido com `{ ok: true }` e nada é gravado. Como os eventos nascem no VPS, evento ausente ali só pode ser evento excluído. Sem isso, a estação tentaria de novo para sempre.
- **ZIP pedido antes da exclusão**: o job `zip` que não encontra o `arquivo_zip` termina sem erro, em vez de tentar de novo.

## 4. Na estação

A sincronização (a cada 60 s) passa a receber `eventos_excluidos`: os ids de todos os eventos de `evento_excluido`. A lista é pequena (um número por evento excluído) e vai inteira sempre, para uma estação que ficou desligada semanas também limpar.

O job `sincronizar` trata os excluídos **antes** de gravar os eventos: assim, um evento novo com o slug de um excluído não colide com a linha velha. Para cada id que ainda existe na estação:

1. Numa transação: apaga os `upload` dos vínculos do evento, as `foto` do evento (o cascade leva `rosto` e `numero_peito`), os `evento_fotografo` e o `evento`.
2. Depois do COMMIT, apaga do disco:
   - os originais, em `RAIZ_ORIGINAIS/<slug>/`;
   - as cópias para publicar, em `RAIZ_PUBLICAR/<id_evento>/`;
   - a marca d'água, em `RAIZ_MARCAS/<id_evento>.png`;
   - os envios pela metade dos uploads apagados (`caminhoParcial`).

Id que não existe na estação é ignorado: excluir de novo não faz nada.

**Trava do disco:** a pasta dos originais é montada pelo slug. Antes de apagar, o slug precisa passar na mesma regra do cadastro (minúsculas, números e hífen, sem vazio), e o caminho final precisa ficar dentro de `RAIZ_ORIGINAIS`. Um slug vazio ou estranho apagaria a raiz inteira; nesse caso a pasta não é apagada e o problema vai para o log. A mesma conferência vale para as pastas por `id_evento`.

### 4.1 Fotos no meio do caminho

- O job `processar-foto` que não encontra mais a foto termina sem erro.
- O job `publicar-foto` que não encontra mais a foto termina sem erro. Hoje ele lança erro e tenta de novo até 1000 vezes.
- O fotógrafo que estava enviando: até a estação sincronizar (no máximo 1 minuto) o upload ainda é aceito. O que chegou nesse meio-tempo é apagado junto com o resto quando a estação trata a exclusão, e dali em diante o link dele deixa de valer.

## 5. API

| `call` | Corpo | Devolve |
|---|---|---|
| `excluirEvento` | `id_evento, nome_confirmacao` | `{ ok: true }` |

Recusas: "Evento não encontrado." e "O nome digitado não confere com o do evento."

`obterEvento` passa a devolver `qtd_fotos`, para a janela dizer quantas fotos somem.

## 6. Arquitetura da tela

- `pages/evento/components/Excluir.vue`, com `data-bloco="excluir"`, ao lado de `Dados`, `Fotografos` e `Links`.
- O estado da janela (aberta, nome digitado, ocupado, erro) e a ação `excluir` ficam no `evento.ts`, como a remoção de fotógrafo.
- `excluirEvento` em `services/evento.service.ts`.
- O "Evento excluído." da lista vai pela query (`/?excluido=1`): a lista mostra e tira o parâmetro.

## 7. Testes

- **Integração, VPS:** com fotos, rostos, busca, ZIP, vínculo e arquivos em disco, `excluirEvento` apaga tudo do banco e do disco e grava `evento_excluido`; outro evento ao lado fica intacto; nome errado recusa sem apagar nada; o mesmo slug pode ser usado de novo; a sincronização lista o id em `eventos_excluidos`; foto publicada depois da exclusão volta `ok` sem gravar.
- **Integração, estação:** o `sincronizar` com um id excluído apaga banco, originais, cópias, marca e envio parcial do evento, e não toca em outro evento; rodar de novo não falha; um evento novo com o mesmo slug, na mesma sincronização, é gravado.
- **Jobs:** `processar-foto`, `publicar-foto` e `zip` sem o registro terminam sem erro.
- **Tela (vitest):** o bloco aparece no fim; o botão só libera com o nome exato (espaços nas pontas ignorados, maiúscula diferente não); confirmar chama a API com o nome e volta para a lista com "Evento excluído."; erro da API aparece na janela; cancelar não chama a API.
- **À mão, antes de publicar:** rodar aqui com um evento de teste com fotos de verdade, excluir e conferir as pastas do site e da estação.

## 8. Fora desta etapa

- O expurgo automático por `dias_expurgo` (que mantém o evento no admin).
- Uma tela para ver os eventos excluídos (o registro fica só no banco).
- Desfazer, lixeira ou exclusão agendada.
- Os logos dos patrocinadores: ainda não existe upload deles.
