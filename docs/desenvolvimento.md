# Desenvolvimento

## Pré-requisitos

- Node 22 (`nvm use`, lê o `.nvmrc`)
- Docker com Compose

## Primeiro uso

```bash
npm install
docker compose -f docker-compose.dev.yml up -d postgres redis
cp apps/api/.env.example apps/api/.env
npm run migrate:dev
npm run dev -w apps/api          # papel vps na porta 3002
```

O Postgres de dev tem dois bancos, `fotos_estacao` e `fotos_vps`, em `127.0.0.1:5433`. O Redis fica em `127.0.0.1:6380`. Para rodar a API como estação, troque `PAPEL`, `POSTGRES_DB` e `PORTA` no `apps/api/.env`.

## Testes

```bash
npm test                 # funções puras, sem banco
npm run test:integracao  # precisa do Postgres de dev de pé
npm run typecheck
```

Os testes de integração inspecionam as filas do Redis, então o `worker-estacao` não pode estar rodando junto — ele consome os jobs que os testes acabaram de enfileirar. Se o compose completo estiver no ar: `docker compose -f docker-compose.dev.yml stop worker-estacao` antes de rodar.

## Migrations

```bash
npm run migrate -- create adiciona_coluna_x --target=vps   # estacao | vps | ambos
PAPEL=vps POSTGRES_DB=fotos_vps npm run migrate -- up
PAPEL=vps POSTGRES_DB=fotos_vps npm run migrate -- status
PAPEL=vps POSTGRES_DB=fotos_vps npm run migrate -- down   # desfaz só a última
```

Cada banco guarda o seu papel em `schema_papel` e recusa migrations do outro papel. Nunca edite uma migration já aplicada: crie outra.

## Módulo novo na API

Siga a skill `.claude/skills/padrao-backend` (pasta `apps/api/src/_<AREA>/<modulo>/` com `route.`, `ctrl.`, `sql.`, `i.` e `.http`) e registre em `apps/api/src/routes/<area>Route.ts`:

```ts
router.post("/<modulo>", routeModulo);
```

A chamada fica `POST /api/<area>/<modulo>` com `{ "call": "<metodo>", ... }`.

## Composes

| Arquivo | Uso |
|---|---|
| `docker-compose.dev.yml` | Tudo numa máquina: Postgres com os dois bancos, Redis, migrations e as duas APIs (3001 estação, 3002 VPS). |
| `docker-compose.estacao.yml` | Estação no evento. `docker compose --env-file .env.estacao -f docker-compose.estacao.yml up -d --build` |
| `docker-compose.vps.yml` | VPS. `docker compose --env-file .env.vps -f docker-compose.vps.yml up -d --build`. Precisa de `infra/certs/origem.pem` e `origem.key`. |

O `--env-file` é obrigatório nos composes da estação e da VPS: é dele que saem `PORTA_LAN`, os domínios e as portas usados nas regras do Traefik.

A API encerra na inicialização se faltar alguma variável obrigatória do papel e mostra a lista do que falta.

## vision-service (Python)

```bash
npm run test:vision                                                   # testes, em CPU, dentro da imagem de teste
docker compose -f docker-compose.dev.yml --profile gpu up -d --build  # sobe o vision-gpu (8001) e o vision-cpu (8002)
curl -s localhost:8001/health
```

O vision na GPU precisa do `nvidia-container-toolkit` no host. A pasta `dados/` (fora do git) aparece dentro do `vision-gpu` como `/data/dados`, para testes manuais e para o benchmark (`docs/benchmark-vision.md`).

## Ver a plataforma inteira funcionando

Um comando faz o evento do começo ao fim — cria no admin, manda as fotos pela estação,
espera o reconhecimento na GPU, publica na VPS e busca pela sua selfie:

```bash
docker compose -f docker-compose.dev.yml --profile gpu up -d --build
npm run demo-evento -- --fotos <pasta com as fotos> --selfie <sua selfie.jpg>
```

No fim ele imprime links prontos para abrir no navegador: as suas fotos com a porcentagem
de semelhança, o download em tamanho grande e o ZIP com todas. A chave do anfitrião sai
junto, para ver o evento inteiro sem selfie:

```bash
npm run demo-galeria -- --chave <chave_anfitriao>
```

O primeiro uso precisa de um operador cadastrado:

```bash
npm run criar-operador -w apps/api -- --nome "Ana" --login ana   # senha: senha-dev-123
```

## Busca do participante (fase 4)

Com o compose de dev no ar e um evento já ingerido pela estação:

```bash
npm run demo-busca -- --evento <slug> --selfie <arquivo.jpg>
```

O script faz a busca real, lê o resultado, baixa um thumb pelo nginx (`127.0.0.1:8080`) — que é quem valida o link assinado — e pede o ZIP. O evento precisa estar com `exigir_whatsapp: false` enquanto a verificação (parte 2 da fase 4) não existir:

```sql
UPDATE evento SET config = config || '{"exigir_whatsapp":false}'::jsonb WHERE slug = '<slug>';
```

## Tela do participante

Em desenvolvimento, com recarregamento automático:

```bash
npm run dev -w apps/web-participante     # http://localhost:5173
npm run test -w apps/web-participante    # Vitest + Vue Test Utils, sem API no ar
```

O Vite encaminha `/api` para a API (3002) e `/arquivos` para o nginx (8080), então a tela
funciona numa origem só.

Servida como em produção (o build roda dentro da imagem do nginx, que também entrega as fotos):

```bash
docker compose -f docker-compose.dev.yml up -d --build arquivos   # http://localhost:8080
```

O próprio nginx encaminha `/api` para a API (variável `API_UPSTREAM`, no compose de dev
apontando para `api-vps`). Por isso `:8080` também serve a tela inteira, busca incluída. No
Coolify é o mesmo encaminhamento; o deploy está em [deploy.md](deploy.md).

Para ter um evento com fotos, rode antes `npm run demo-evento` (ver acima) e abra o link
que ele imprime: `http://localhost:8080/#/e/<slug>`, ou `/#/p/<chave_acesso>` se o evento
for privado. A galeria do anfitrião fica em `/#/a/<chave_anfitriao>`.

**No celular:** a câmera do navegador só abre em contexto seguro (`localhost` ou HTTPS).
Pelo IP da máquina na rede local (`http://<ip>:5173`, o endereço que o Vite imprime) a tela
cai no caminho "Escolher da galeria" — que também é um caminho real a testar. Para testar
a câmera no celular, é preciso HTTPS (por exemplo, um túnel).

A selfie precisa ter um rosto só: foto em grupo volta com "Encontramos mais de um rosto".
E a API limita as buscas por IP (10 a cada 10 minutos, `BUSCA_LIMITE_IP`); pelo nginx de
dev todo pedido chega com o IP do container, então testes seguidos esbarram nesse limite.

**Roteiro ponta a ponta do participante (fotos em dois dias, memória, botão único):**

Com o compose de dev no ar, um evento ingerido e a tela do participante rodando (`npm run dev -w apps/web-participante`):

1. Espalhe as fotos em dois dias para testar a galeria com abas:
   ```sql
   -- Neste psql do compose, a metade mais antiga das fotos vai para a véspera:
   UPDATE foto SET capturada_em = capturada_em - interval '1 day'
    WHERE id_foto IN (SELECT id_foto FROM foto WHERE id_evento = 1 ORDER BY id_foto LIMIT (SELECT count(*) / 2 FROM foto WHERE id_evento = 1));
   ```

2. Abra a home do evento em `http://localhost:8080/#/e/<slug>`: mostra o nome, o período (dois dias), e os botões "Ver todas as fotos" e "Buscar minhas fotos".

3. Clique em "Ver todas as fotos":
   - A galeria abre com dois chips no topo (um para cada dia, com contagem).
   - Trocar de dia zera a posição da grade.
   - Role para baixo e clique em "Ver mais fotos" para paginar.
   - Clique numa foto para abrir em tela cheia: navegue com swipe ou setas e veja o botão único "Salvar / Compartilhar" na barra inferior.

4. Volte à home ("Voltar") e clique em "Buscar minhas fotos":
   - Tire uma selfie (ou escolha da galeria), aperte "Buscar".
   - Veja o resultado com as fotos em que você aparece.

5. Feche a aba do navegador e reabra `http://localhost:8080/#/e/<slug>`:
   - A home agora mostra "Minhas fotos (N)" em vez de "Buscar minhas fotos" — a selfie foi lembrada no dispositivo.
   - Clique em "Minhas fotos (N)" para voltar ao resultado da última busca.

6. No resultado anterior, clique em "Buscar de novo":
   - A busca abre sem câmera (só permite escolher da galeria ou digitar arquivo) — útil para tentar com outra foto.

7. De volta na galeria (ou resultado), abra uma foto e clique em "Salvar / Compartilhar":
   - No navegador desktop, abre um diálogo de download.
   - No celular (especialmente iPhone), abre a folha do sistema nativa (share sheet), com opções como "Salvar imagem" e compartilhamento social.

## Admin

Em desenvolvimento, com recarregamento automático:

```bash
docker compose -f docker-compose.dev.yml up -d --build api-vps
npm run dev -w apps/web-admin        # http://localhost:5175
npm run test -w apps/web-admin       # Vitest + Vue Test Utils, sem API no ar
```

O Vite encaminha `/api` para a API do VPS de dev (`127.0.0.1:3002`). Entre com o operador de dev (`ana` / `senha-dev-123` depois do `criar-operador`).

Servido como em produção pelo nginx do VPS: `docker compose -f docker-compose.dev.yml up -d --build arquivos` e abra `http://admin.localhost:8080` (o navegador resolve `*.localhost` para a própria máquina).

- **Novo evento:** as datas já vêm com hoje. "Exigir WhatsApp" vem desligado: a verificação ainda não existe, e ligada o participante não vê as fotos.
- **Página do evento:** dados e config, marca d'água, links do participante e do anfitrião (com QR) e os fotógrafos. Os links saem de `ENDERECO_PARTICIPANTE` (em dev, `http://localhost:8080`; na VPS, `https://${DOMINIO_PARTICIPANTE}`, montado pelo compose).
- **Link de upload:** o admin só vincula o fotógrafo; o link e o QR ficam no painel da estação (`http://localhost:5174/#/estacao`), que é quem sabe o próprio endereço na rede do evento.
- **Remover um fotógrafo** fecha o link dele em até 60 s. Adicionar de novo gera um link novo.
- **Desativar o evento** também chega à estação em até 60 s (a sincronização leva os desativados nos últimos 7 dias).

**Roteiro ponta a ponta** (compose completo no ar com `docker compose -f docker-compose.dev.yml --profile gpu up -d --build`, e `npm run dev` no `apps/web-admin` e no `apps/web-fotografo`):

1. No admin (`http://localhost:5175`), crie um evento com as datas de hoje e adicione um fotógrafo (cadastre um novo, se preciso).
2. Em até 60 s o evento aparece no painel da estação (`http://localhost:5174/#/estacao`, mesmo login) como o evento em andamento, com o link e o QR do fotógrafo.
3. Abra o link do fotógrafo e solte uma pasta de JPEGs; no painel, as fotos passam pelas etapas até "Prontas".
4. No admin, abra o link do participante (bloco "Links") e faça a busca pela selfie; as fotos em que você aparece voltam no resultado.
5. Remova o fotógrafo no admin: em até 60 s o link dele passa a dizer "Este link não aceita mais fotos". Desative o evento: em até 60 s ele some do painel da estação.

## Upload do fotógrafo e painel da estação

Em desenvolvimento, com recarregamento automático:

```bash
docker compose -f docker-compose.dev.yml up -d --build api-estacao worker-estacao
npm run dev -w apps/web-fotografo        # http://localhost:5174
npm run test -w apps/web-fotografo       # Vitest + Vue Test Utils, sem API no ar
```

O Vite encaminha `/api` para a API da estação de dev (`127.0.0.1:3001`).

- **Painel:** `http://localhost:5174/#/estacao`, com o mesmo login do admin (`ana` / `senha-dev-123` depois do `criar-operador`). Ele mostra o evento em andamento (o que está acontecendo hoje pelas datas; com mais de um aberto, o operador escolhe no cabeçalho) e, para cada fotógrafo vinculado, o link e o QR de upload.
- **Envio:** abra o link do fotógrafo (`/#/?t=<token_upload>`) e solte uma pasta de JPEGs.

O evento, o fotógrafo e o vínculo nascem no admin (ver "Admin" acima) e chegam à estação pela sincronização, a cada 60 s.

**Na estação de verdade:**
- `docker-compose.estacao.yml` sobe o serviço `web` (a tela, num nginx) atrás do mesmo Traefik da API.
- No `.env.estacao`, configure `OPERADOR_SEGREDO` (sem ele o login do painel se recusa) e `ENDERECO_LAN` (o IP da estação na rede do evento, que entra nos links e QR). Sem `ENDERECO_LAN`, o painel monta os links com o endereço pelo qual foi aberto e avisa quando ele é `localhost`.

**Detalhes do envio:**
- Os arquivos chegam em pedaços em `RAIZ_UPLOADS` (padrão `/data/originais/_uploads`), no mesmo volume dos originais.
- Envio parado há mais de 24 h é apagado pelo worker.
- Os testes de integração do upload e do painel usam o banco `fotos_estacao` de dev e encerram os eventos que criam.
