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
