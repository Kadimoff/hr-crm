#!/bin/sh
# app    — bazanın sxemini tətbiq edir (prisma db push, məlumat itirən dəyişikliyi rədd edir) və Next.js-i başladır
# worker — Excel idxalı worker-i (BullMQ)
# storage volume-u adətən root kimi yaranır: "node" istifadəçisinə verilir, proses imtiyazsız işləyir.
set -e
mkdir -p /app/storage/uploads /app/storage/backups /app/storage/documents
if [ "$(id -u)" = "0" ]; then
  chown -R node:node /app/storage
  exec setpriv --reuid=node --regid=node --init-groups "$0" "$@"
fi
case "$1" in
  app)
    npx prisma db push --skip-generate
    exec npx next start -H 0.0.0.0 -p "${PORT:-3000}"
    ;;
  worker)
    exec npx tsx src/workers/import-worker.ts
    ;;
  *)
    exec "$@"
    ;;
esac
