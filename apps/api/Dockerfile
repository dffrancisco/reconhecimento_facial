# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY db/package.json db/
RUN npm ci -w apps/api

FROM deps AS build
COPY tsconfig.base.json ./
COPY apps/api apps/api
RUN npm run build -w apps/api

FROM node:22-bookworm-slim AS deps-producao
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY db/package.json db/
# O npm pode não criar a pasta local quando tudo sobe para a raiz; o COPY abaixo precisa dela.
RUN npm ci -w apps/api --omit=dev && mkdir -p apps/api/node_modules

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps-producao /app/node_modules ./node_modules
COPY --from=deps-producao /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/package.json ./apps/api/
WORKDIR /app/apps/api
# Um volume nomeado vazio herda dono e modo do diretório que já existe na imagem. Sem criar
# estas pastas aqui, elas nascem root:root e o processo (usuário node) não grava nada nelas.
RUN mkdir -p /data/originais /data/publicar /data/marcas /data/fotos && chown -R node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/test').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/index.js"]
