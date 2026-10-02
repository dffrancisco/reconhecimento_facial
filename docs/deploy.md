# Deploy

São duas máquinas:

- **VPS (nuvem, no Coolify):** fica sempre ligada. Serve o app do participante, o admin, as fotos publicadas e a busca por selfie.
- **Estação (o computador com a placa NVIDIA):** vai para o evento. Recebe as fotos dos fotógrafos pela rede local, acha os rostos na placa de vídeo e publica as fotos na VPS.

A estação é quem liga para a VPS: a cada 60 s ela busca eventos, fotógrafos e operadores, e manda as fotos prontas. A VPS nunca chama a estação. As duas se reconhecem por um segredo em comum, o `ESTACAO_CHAVE`.

## 1. Antes de começar: os segredos

Gere cada um com `openssl rand -hex 32` e guarde num lugar seguro (gerenciador de senhas):

| Segredo | Onde vai |
|---|---|
| `ESTACAO_CHAVE` | **Igual** na VPS (Coolify) e na estação (`.env.estacao`) |
| `ARQUIVO_SEGREDO` | VPS |
| `OPERADOR_SEGREDO` da VPS | VPS |
| `OPERADOR_SEGREDO` da estação | Estação (pode ser outro) |
| `POSTGRES_PASSWORD` da VPS | VPS |
| `POSTGRES_PASSWORD` da estação | Estação |

## 2. Domínios na Cloudflare

Os dois endereços ficam **um nível só** abaixo de `taap.com.br`:

- participante: `foto.taap.com.br`
- admin: `fotoadmin.taap.com.br`

O certificado gratuito da Cloudflare cobre só um nível de subdomínio. Um endereço como `admin.foto.taap.com.br` dá erro de certificado no navegador.

No painel da Cloudflare:

1. **DNS:** dois registros `A`, um para cada endereço, apontando para o IP do servidor do Coolify, com a **nuvem laranja** ligada (proxy).
2. **SSL/TLS → Visão geral:** modo **Full (strict)**.
3. **SSL/TLS → Certificados de borda:** deixe **"Always Use HTTPS" desligado**. O Coolify já redireciona para https, e a renovação automática do certificado precisa que o acesso pela porta 80 chegue ao servidor.

A nuvem laranja precisa ficar sempre ligada: o limite de buscas por pessoa usa o IP que a Cloudflare informa (`CONFIAR_CLOUDFLARE=true`).

## 3. VPS no Coolify

### 3.1 Criar o recurso

1. No Coolify, abra o projeto (ou crie um) e clique em **+ New → Resource**.
2. Escolha o repositório do GitHub (`dffrancisco/reconhecimento_facial`). Se ele for privado, conecte antes o GitHub ao Coolify em **Sources** (GitHub App).
3. Branch: `master`.
4. **Build Pack:** `Docker Compose`.
5. **Base Directory:** `/`. **Docker Compose Location:** `/docker-compose.coolify.yml`.
6. Salve. O Coolify lê o arquivo e mostra os serviços: `postgres`, `redis`, `migrate`, `api`, `worker`, `arquivos` e `vision`.

### 3.2 Domínios

Só o serviço **`arquivos`** recebe domínio. No campo **Domains** dele, coloque os dois, separados por vírgula:

```
https://foto.taap.com.br,https://fotoadmin.taap.com.br
```

Os outros serviços ficam sem domínio: o nginx do `arquivos` entrega as duas telas e encaminha o `/api` para a API por dentro.

### 3.3 Variáveis

Na aba de variáveis de ambiente, preencha:

| Variável | Valor |
|---|---|
| `POSTGRES_PASSWORD` | o da VPS |
| `ESTACAO_CHAVE` | o segredo em comum |
| `ARQUIVO_SEGREDO` | o seu |
| `OPERADOR_SEGREDO` | o da VPS |
| `DOMINIO_PARTICIPANTE` | `foto.taap.com.br` (sem `https://`) |
| `DOMINIO_ADMIN` | `fotoadmin.taap.com.br` (sem `https://`) |

Opcionais, já têm padrão: `ARQUIVO_LINK_VALIDADE_S` (3600), `BUSCA_LIMITE_IP` (10), `CONFIAR_CLOUDFLARE` (true), `SELFIE_CONCORRENCIA` (núcleos − 1).

As obrigatórias estão marcadas: sem elas o Coolify não deixa fazer o deploy.

### 3.4 Primeiro deploy

Clique em **Deploy**. O primeiro demora (vários minutos): ele monta as imagens da API, das telas e do reconhecimento de selfie.

Quando terminar:

- `migrate` aparece como **Exited**. É o esperado: ele roda as migrações do banco e termina.
- `https://foto.taap.com.br` abre a tela do participante.
- `https://fotoadmin.taap.com.br` abre a tela de entrada do admin.

### 3.5 Primeiro operador

O operador é quem entra no admin e no painel da estação. No Coolify, abra o **Terminal** do serviço `api` e rode:

```bash
node dist/scripts/criarOperador.js --nome "Seu Nome" --login seulogin
```

Ele pede a senha (não aparece na tela enquanto você digita). Depois disso, entre no admin com esse login e essa senha.

### 3.6 Atualizar

A cada `git push` na `master`, clique em **Redeploy** no Coolify. Com o GitHub App conectado, dá para ligar o deploy automático.

## 4. Estação (o computador com a placa NVIDIA)

Este computador já tem o Docker e a placa (RTX 4070) funcionando com o Docker. Em outro computador, instale antes o Docker e o **NVIDIA Container Toolkit**. Para conferir, rode `docker run --rm --gpus all ubuntu nvidia-smi`: ele deve mostrar a placa.

### 4.1 Liberar a placa e a porta

- **Placa:** a estação e o ambiente de desenvolvimento usam a mesma placa de vídeo. Pare o de desenvolvimento antes:

  ```bash
  docker compose -f docker-compose.dev.yml --profile gpu stop
  ```

- **Porta:** neste computador o Apache já usa a porta 80. A estação vai na **8090**.

### 4.2 Configurar

Na pasta do projeto, atualizada com `git pull`:

```bash
cp .env.estacao.example .env.estacao
```

Edite o `.env.estacao`:

| Variável | Valor |
|---|---|
| `POSTGRES_PASSWORD` | o da estação |
| `ESTACAO_CHAVE` | **o mesmo** da VPS |
| `VPS_URL` | `https://fotoadmin.taap.com.br` |
| `OPERADOR_SEGREDO` | o da estação |
| `PORTA_LAN` | `8090` |
| `ENDERECO_LAN` | `http://<IP deste computador na rede>:8090`. Em casa, hoje: `http://192.168.100.18:8090`. A estação manda esse endereço no sinal de cada minuto, e o admin mostra o link do painel no bloco "Links" do evento. |
| `ENDERECO_TUNEL` | deixe vazio (`ENDERECO_TUNEL=`) enquanto não houver túnel. Com o valor de exemplo, o painel mostraria um link que não existe. |

O `.env.estacao` não vai para o git.

### 4.3 Subir

```bash
docker compose --env-file .env.estacao -f docker-compose.estacao.yml up -d --build
```

A primeira vez demora: ele monta a imagem do reconhecimento com suporte à placa.

Em até 1 minuto, os operadores da VPS chegam à estação. Então:

1. Abra `http://192.168.100.18:8090/#/estacao` e entre com o operador criado na VPS. Se entrar, a ligação com a VPS está funcionando.
2. Crie um evento no admin, com as datas de hoje, e adicione um fotógrafo. Em até 1 minuto ele aparece no painel, com o link e o QR de upload.
3. Pelo link do fotógrafo, suba algumas fotos. No painel, elas passam pelas etapas até "Prontas".
4. No admin, abra o link do participante e faça a busca pela selfie.

Se o firewall do computador estiver ligado (`sudo ufw status`), libere a porta para os celulares da rede: `sudo ufw allow 8090/tcp`.

### 4.4 No dia do evento

- **Rede:** a estação e os celulares dos fotógrafos precisam estar na mesma rede (o roteador do evento). O IP da estação muda de rede para rede: veja o novo com `ip -4 addr` e troque o `ENDERECO_LAN` no `.env.estacao`. Depois rode o mesmo `up -d` do passo 4.3. Se der, deixe um IP fixo para a estação no roteador.
- **Internet:** a estação precisa dela para publicar as fotos na VPS. Sem internet, ela continua recebendo e processando; publica tudo quando a conexão voltar.
- **Fim do evento:** "Encerrar evento" no painel da estação só libera quando não há foto em processamento.

### 4.5 Atualizar

```bash
git pull
docker compose --env-file .env.estacao -f docker-compose.estacao.yml up -d --build
```

## 5. Quando algo não funciona

| Sintoma | O que ver |
|---|---|
| Erro de certificado no navegador | O endereço tem dois níveis (`admin.foto.taap.com.br`)? Use um nível só. O modo da Cloudflare está em Full (strict)? |
| O Coolify não emite o certificado | "Always Use HTTPS" ligado na Cloudflare. Desligue, ou deixe a nuvem cinza até o certificado sair e depois volte para laranja. |
| O painel da estação não aceita o login do operador | A estação ainda não sincronizou. Veja os logs: `docker compose --env-file .env.estacao -f docker-compose.estacao.yml logs worker`. Erro de chave: o `ESTACAO_CHAVE` é diferente nos dois lados. Erro de conexão: o `VPS_URL` está errado ou sem internet. |
| O celular do fotógrafo não abre o link | Ele está em outra rede, o `ENDERECO_LAN` está com o IP antigo, ou o firewall está bloqueando a 8090. |
| Fotos param em "Esperando publicar" | A estação não alcança a VPS. Os logs do `worker` da estação dizem o motivo. |
| A busca por selfie diz "muitas buscas" para todo mundo | A nuvem laranja está desligada: sem a Cloudflare, todos parecem vir do mesmo IP. |
