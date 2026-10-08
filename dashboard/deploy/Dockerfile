FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# Runs the built Worker with the pinned Wrangler/Miniflare runtime. D1 is
# SQLite on the mounted volume; no Cloudflare account or remote DB is used.
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production WRANGLER_SEND_METRICS=false WRANGLER_WRITE_LOGS=false
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/deploy/start.mjs ./deploy/start.mjs
COPY --from=build --chown=node:node /app/lib/auth-config.mjs ./lib/auth-config.mjs
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8080
CMD ["node", "deploy/start.mjs"]
