# Estágio 1 — build do frontend (Vite)
FROM node:22-alpine AS build

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json vite.config.ts tailwind.config.js postcss.config.js index.html ./
COPY src ./src
COPY public ./public
RUN npm run build

# Estágio 2 — runtime (Express servindo dist/ + /api)
FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

# Cluster air-gapped: toda dependência é instalada aqui, no build.
COPY api/package.json api/package-lock.json* ./api/
RUN cd api && npm install --omit=dev

COPY server.cjs ./
COPY api ./api
COPY --from=build /app/dist ./dist

EXPOSE 3000
CMD ["node", "server.cjs"]
