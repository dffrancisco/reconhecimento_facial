# Tela do fotógrafo e painel da estação: estáticos servidos por um nginx pequeno, atrás do
# Traefik da estação (que manda /api para a API). O build roda aqui dentro.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web-fotografo/package.json apps/web-fotografo/
RUN npm ci -w apps/web-fotografo
COPY apps/web-fotografo apps/web-fotografo
RUN npm run build -w apps/web-fotografo

FROM nginx:1.27-alpine
RUN rm -f /etc/nginx/conf.d/default.conf
COPY apps/web-fotografo/nginx.conf /etc/nginx/conf.d/web-fotografo.conf
COPY --from=build /app/apps/web-fotografo/dist /usr/share/nginx/html
