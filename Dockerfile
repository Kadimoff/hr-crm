# ---- build: paketlər, Prisma klienti, typecheck + testlər + Next.js build ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
# Prisma mühərriki üçün openssl
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# --include=dev: build TypeScript/Prisma CLI-yə ehtiyac duyur, NODE_ENV=production verilsə də
RUN npm ci --include=dev
COPY . .
RUN npx prisma generate
# Typecheck və ya test keçməsə image yaranmır — Coolify işləyən versiyanı saxlayır
RUN npm run typecheck && npm test && npm run build

# ---- runtime: eyni image iki rejimdə — "app" (Next.js) və "worker" (Excel idxalı, BullMQ) ----
FROM node:22-bookworm-slim
WORKDIR /app
# curl — Coolify-ın sağlamlıq yoxlaması üçün; openssl — Prisma
RUN apt-get update && apt-get install -y --no-install-recommends curl openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 \
    UPLOAD_DIR=/app/storage/uploads BACKUP_DIR=/app/storage/backups DOCUMENTS_DIR=/app/storage/documents
# Worker tsx ilə mənbədən işləyir, bazanın sxemi Prisma CLI ilə tətbiq olunur — dev paketləri saxlanılır
COPY --from=build /app ./
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /app/storage
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=3 \
  CMD test "$ROLE" = "worker" || curl -fsS "http://127.0.0.1:${PORT:-3000}/api/health" > /dev/null || exit 1
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["app"]
