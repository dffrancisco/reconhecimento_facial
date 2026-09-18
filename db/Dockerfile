# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY db/package.json db/
RUN npm ci -w db --omit=dev
COPY tsconfig.base.json ./
COPY db db
WORKDIR /app/db
USER node
CMD ["node", "--import", "tsx", "migrate.ts", "up"]
