# Deploy

Tudo roda num servidor só: o do Coolify, que tem a placa de vídeo. Ninguém leva computador para o evento.

O mesmo `docker-compose.coolify.yml` sobe as duas partes do sistema:

- **Parte pública:** o app do participante, o admin, as fotos publicadas e a busca por selfie.
- **Estação:** recebe as fotos que os fotógrafos mandam pela internet, acha os rostos na placa de vídeo e publica as fotos na parte pública.

As duas continuam separadas por dentro, cada uma com o seu banco. A cada 60 s a estação busca na parte pública os eventos, fotógrafos e operadores, e manda para lá as fotos prontas. Isso acontece pela rede interna do servidor, sem passar pela internet. As duas se reconhecem por um segredo em comum, o `ESTACAO_CHAVE`.

## 1. Antes de começar: os segredos

Gere cada um com `openssl rand -hex 32` e guarde num lugar seguro (gerenciador de senhas):

| Segredo | Para que serve |
|---|---|
| `POSTGRES_PASSWORD` | Senha dos dois bancos (só são acessíveis por dentro do servidor) |
| `ESTACAO_CHAVE` | Liga a estação à parte pública |
| `ARQUIVO_SEGREDO` | Assina os links das fotos |
| `OPERADOR_SEGREDO` | Assina o login do admin |
| `OPERADOR_SEGREDO_ESTACAO` | Assina o login do painel da estação (precisa ser **diferente** do `OPERADOR_SEGREDO`) |

## 2. A placa de vídeo no servidor

No terminal do servidor, rode:

```bash
nvidia-smi
```

Ele deve mostrar a placa. Se der "command not found" ou erro, falta o driver da NVIDIA: no Ubuntu, `sudo ubuntu-drivers install` e reinicie o servidor. A estação foi testada com o driver 580. Use esse ou um mais novo.

Depois, confira se o Docker enxerga a placa:

```bash
docker run --rm --gpus all ubuntu nvidia-smi
```

Se der erro como `could not select device driver "" with capabilities: [[gpu]]`, falta o **NVIDIA Container Toolkit**. No Ubuntu:

```bash
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
  | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
  | sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

O `restart docker` derruba por alguns segundos tudo o que roda no servidor, inclusive o Coolify. Escolha uma hora sem evento.

Rode de novo o `docker run --rm --gpus all ubuntu nvidia-smi`. Quando ele mostrar a placa, siga.

## 3. Domínios na Cloudflare

Os três endereços ficam **um nível só** abaixo de `taap.com.br`:

- participante: `foto.taap.com.br`
- admin: `fotoadmin.taap.com.br`
- envio (link dos fotógrafos e painel da estação): `fotoenvio.taap.com.br`

O certificado gratuito da Cloudflare cobre só um nível de subdomínio. Um endereço como `admin.foto.taap.com.br` dá erro de certificado no navegador.

No painel da Cloudflare:

1. **DNS:** um registro `A` para cada endereço, apontando para o IP do servidor do Coolify, com a **nuvem laranja** ligada (proxy).
2. **SSL/TLS → Visão geral:** modo **Full (strict)**.
3. **SSL/TLS → Certificados de borda:** deixe **"Always Use HTTPS" desligado**. O Coolify já redireciona para https, e a renovação automática do certificado precisa que o acesso pela porta 80 chegue ao servidor.

A nuvem laranja precisa ficar sempre ligada: o limite de buscas por pessoa e o de tentativas de login usam o IP que a Cloudflare informa (`CONFIAR_CLOUDFLARE=true`).

## 4. Coolify

### 4.1 Criar o recurso

Se o recurso já existe (o `foto.taap.com.br` já está no ar), pule para o 4.2: o arquivo é o mesmo, só ganhou a estação.

1. No Coolify, abra o projeto (ou crie um) e clique em **+ New → Resource**.
2. Escolha o repositório do GitHub (`dffrancisco/reconhecimento_facial`). Se ele for privado, conecte antes o GitHub ao Coolify em **Sources** (GitHub App).
3. Branch: `master`.
4. **Build Pack:** `Docker Compose`.
5. **Base Directory:** `/`. **Docker Compose Location:** `/docker-compose.coolify.yml`.
6. Salve.

O Coolify lê o arquivo e mostra os serviços:

- da parte pública: `postgres`, `redis`, `migrate`, `api`, `worker`, `arquivos` e `vision`;
- da estação: `postgres-estacao`, `migrate-estacao`, `api-estacao`, `worker-estacao`, `web-estacao` e `vision-gpu`.

### 4.2 Domínios

Só dois serviços recebem domínio. Os outros ficam sem: cada nginx encaminha o `/api` para a API certa, por dentro.

| Serviço | Campo **Domains** |
|---|---|
| `arquivos` | `https://foto.taap.com.br,https://fotoadmin.taap.com.br` |
| `web-estacao` | `https://fotoenvio.taap.com.br` |

### 4.3 Variáveis

Na aba de variáveis de ambiente, preencha:

| Variável | Valor |
|---|---|
| `POSTGRES_PASSWORD` | o seu |
| `ESTACAO_CHAVE` | o seu |
| `ARQUIVO_SEGREDO` | o seu |
| `OPERADOR_SEGREDO` | o seu |
| `OPERADOR_SEGREDO_ESTACAO` | o seu |
| `DOMINIO_PARTICIPANTE` | `foto.taap.com.br` (sem `https://`) |
| `DOMINIO_ADMIN` | `fotoadmin.taap.com.br` (sem `https://`) |
| `DOMINIO_ENVIO` | `fotoenvio.taap.com.br` (sem `https://`). Vira o endereço dos links e QR dos fotógrafos e do painel no admin. |

As obrigatórias estão marcadas: sem elas o Coolify não deixa fazer o deploy.

Opcionais, já têm padrão:

| Variável | Padrão | Quando mexer |
|---|---|---|
| `SHARP_CONCORRENCIA` | núcleos − 2 | Fotos preparadas ao mesmo tempo. A busca por selfie usa a mesma CPU: se ela ficar lenta durante um evento, baixe este número. |
| `SELFIE_CONCORRENCIA` | núcleos − 1 | Selfies processadas ao mesmo tempo. |
| `WORKER_CONCORRENCIA` | 16 | Fotos em processamento ao mesmo tempo. |
| `UPLOAD_PEDACO_MB` | 8 | Tamanho de cada pedaço do envio do fotógrafo. Não passe de 15. |
| `ARQUIVO_LINK_VALIDADE_S` | 3600 | Validade dos links das fotos, em segundos. |
| `BUSCA_LIMITE_IP` | 10 | Buscas por pessoa a cada 10 minutos. |
| `CONFIAR_CLOUDFLARE` | true | Só desligue se tirar a Cloudflare da frente. |

### 4.4 Deploy

Clique em **Deploy**. O primeiro demora (vários minutos): ele monta as imagens da API, das telas e do reconhecimento.

Quando terminar:

- `migrate` e `migrate-estacao` aparecem como **Exited**. É o esperado: eles preparam os bancos e terminam.
- `https://foto.taap.com.br` abre a tela do participante.
- `https://fotoadmin.taap.com.br` abre a tela de entrada do admin.
- `https://fotoenvio.taap.com.br/#/estacao` abre a entrada do painel da estação.

Na primeira vez, o `vision-gpu` leva alguns minutos para ficar pronto: ele prepara os modelos para essa placa e guarda o resultado. Nas próximas, sobe rápido.

### 4.5 Primeiro operador

O operador é quem entra no admin e no painel da estação. Se o admin já tem operador, pule este passo.

No Coolify, abra o **Terminal** do serviço `api` e rode:

```bash
node dist/scripts/criarOperador.js --nome "Seu Nome" --login seulogin
```

Ele pede a senha (não aparece na tela enquanto você digita). O mesmo login e a mesma senha valem no admin e, em até 1 minuto, no painel da estação.

### 4.6 Conferir de ponta a ponta

1. Entre no admin, crie um evento com as datas de hoje e adicione um fotógrafo.
2. Em até 1 minuto, o bloco "Links" do evento mostra o painel da estação (`https://fotoenvio.taap.com.br/#/estacao`). Abra e entre com o operador.
3. No painel, o fotógrafo aparece com o link e o QR de upload. Pelo link, suba algumas fotos. No painel, elas passam pelas etapas até "Prontas".
4. No admin, abra o link do participante e faça a busca pela selfie.

### 4.7 Atualizar

A cada `git push` na `master`, clique em **Redeploy** no Coolify. Com o GitHub App conectado, dá para ligar o deploy automático.

Evite o redeploy no meio de um evento: a estação para por alguns minutos. Nenhuma foto se perde (o envio do fotógrafo continua de onde parou), mas o processamento atrasa.

## 5. No dia do evento

- **Internet:** os fotógrafos enviam pela internet, de onde estiverem. Cada original tem de 10 a 20 MB. Com 50 Mbps de upload, mil fotos de 15 MB levam uns 40 minutos. Se a internet cair, o envio para e continua sozinho de onde parou quando ela voltar.
- **Disco do servidor:** os originais ficam no servidor (uns 300 GB num evento de 20 mil fotos) e nada os apaga sozinho. Antes de cada evento, veja o espaço livre com `df -h`.
- **Fim do evento:** "Encerrar evento" no painel da estação só libera quando não há foto em processamento.

## 6. Quando algo não funciona

| Sintoma | O que ver |
|---|---|
| Erro de certificado no navegador | O endereço tem dois níveis (`admin.foto.taap.com.br`)? Use um nível só. O modo da Cloudflare está em Full (strict)? |
| O Coolify não emite o certificado | "Always Use HTTPS" ligado na Cloudflare. Desligue, ou deixe a nuvem cinza até o certificado sair e depois volte para laranja. |
| O `vision-gpu` fica reiniciando | Abra os logs dele no Coolify. Se falar em CUDA, o Docker não enxerga a placa: refaça o passo 2. |
| O painel da estação não aceita o login do operador | A estação ainda não sincronizou (espere 1 minuto). Se continuar, veja os logs do `worker-estacao` no Coolify. |
| O admin diz que "a estação ainda não deu sinal" | O `worker-estacao` está parado ou com erro. Veja os logs dele. |
| Fotos param em "Esperando publicar" | A estação não está conseguindo publicar na parte pública. Os logs do `worker-estacao` dizem o motivo. |
| A busca por selfie diz "muitas buscas" para todo mundo | A nuvem laranja está desligada: sem a Cloudflare, todos parecem vir do mesmo IP. |
| A busca por selfie fica lenta durante o evento | O processamento das fotos está tomando a CPU. Baixe o `SHARP_CONCORRENCIA` e faça o redeploy. |

## 7. A estação num computador separado

O `docker-compose.estacao.yml` ainda sobe a estação num computador à parte, levado ao evento e ligado à rede local (variáveis em `.env.estacao.example`). Hoje ela não é usada.

Nunca deixe as duas estações ligadas ao mesmo tempo: as duas usam o mesmo `ESTACAO_CHAVE`, e o admin passaria a mostrar o link de uma ou da outra. Para desligar a de um computador, confira antes no painel dela que nenhuma foto está esperando publicar, e rode:

```bash
docker compose --env-file .env.estacao -f docker-compose.estacao.yml stop
```
