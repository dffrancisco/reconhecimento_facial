# Tela do fotógrafo e painel da estação: estáticos servidos por um nginx pequeno. Na estação com
# Traefik, o Traefik manda /api para a API; no Coolify, é este nginx que encaminha. O build roda aqui dentro.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web-fotografo/package.json apps/web-fotografo/
RUN npm ci -w apps/web-fotografo
COPY apps/web-fotografo apps/web-fotografo
RUN npm run build -w apps/web-fotografo

FROM nginx:1.27-alpine
RUN rm -f /etc/nginx/conf.d/default.conf
# A imagem oficial roda envsubst nos arquivos de /etc/nginx/templates na subida, gravando o
# resultado em /etc/nginx/conf.d. Sem o padrão, o ${API_UPSTREAM} ficaria cru e o nginx não subiria.
ENV API_UPSTREAM=http://api:3000
COPY apps/web-fotografo/nginx.conf.template /etc/nginx/templates/web-fotografo.conf.template
COPY --from=build /app/apps/web-fotografo/dist /usr/share/nginx/html
