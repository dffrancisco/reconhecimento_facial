# As telas do participante e do admin são estáticas: este mesmo nginx, que já valida os links
# assinados, serve os dois builds. Uma origem por domínio, sem CORS e sem container novo.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web-participante/package.json apps/web-participante/
COPY apps/web-admin/package.json apps/web-admin/
RUN npm ci -w apps/web-participante -w apps/web-admin
COPY apps/web-participante apps/web-participante
COPY apps/web-admin apps/web-admin
RUN npm run build -w apps/web-participante && npm run build -w apps/web-admin

FROM nginx:1.27-alpine
# A imagem oficial roda envsubst nos arquivos de /etc/nginx/templates na subida,
# gravando o resultado em /etc/nginx/conf.d. É assim que o segredo entra sem ficar na imagem.
COPY infra/nginx/arquivos.conf.template /etc/nginx/templates/arquivos.conf.template
# O default.conf da imagem tem `server_name localhost` e venceria o nosso por casar exatamente
# com o Host do pedido — o nosso serviço é o único que este container atende.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web-participante/dist /usr/share/nginx/html
COPY --from=build /app/apps/web-admin/dist /usr/share/nginx/admin
