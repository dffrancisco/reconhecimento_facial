# A tela do participante é estática: este mesmo nginx, que já valida os links assinados,
# serve o build. Uma origem só para app, fotos e ZIPs — sem CORS e sem container novo.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web-participante/package.json apps/web-participante/
RUN npm ci -w apps/web-participante
COPY apps/web-participante apps/web-participante
RUN npm run build -w apps/web-participante

FROM nginx:1.27-alpine
# A imagem oficial roda envsubst nos arquivos de /etc/nginx/templates na subida,
# gravando o resultado em /etc/nginx/conf.d. É assim que o segredo entra sem ficar na imagem.
COPY infra/nginx/arquivos.conf.template /etc/nginx/templates/arquivos.conf.template
# O default.conf da imagem tem `server_name localhost` e venceria o nosso por casar exatamente
# com o Host do pedido — o nosso serviço é o único que este container atende.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web-participante/dist /usr/share/nginx/html
