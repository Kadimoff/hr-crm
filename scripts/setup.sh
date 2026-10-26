#!/usr/bin/env bash
# Layihəni yeni kompüterdə bir əmrlə qurur: npm run setup
# Tələblər: Docker (compose ilə) və Node.js 20+
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\n\033[1;34m==>\033[0m %s\n' "$1"; }
die() { printf '\n\033[1;31mXəta:\033[0m %s\n' "$1" >&2; exit 1; }

command -v docker >/dev/null || die "Docker tapılmadı — https://docs.docker.com/get-docker/"
docker compose version >/dev/null 2>&1 || die "'docker compose' işləmir — Docker Compose v2 lazımdır"
command -v node >/dev/null || die "Node.js tapılmadı — https://nodejs.org (20 və ya daha yeni)"
[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ] || die "Node.js 20+ lazımdır (indiki: $(node -v))"

if [ ! -f .env ]; then
  say ".env yaradılır (.env.example-dan)"
  cp .env.example .env
fi

say "PostgreSQL və Redis konteynerləri qaldırılır"
docker compose up -d postgres redis
for i in $(seq 60); do
  docker compose exec -T postgres pg_isready -U ehr -d ehr >/dev/null 2>&1 && break
  [ "$i" -eq 60 ] && die "PostgreSQL 60 saniyədə hazır olmadı (docker compose logs postgres)"
  sleep 1
done

say "Paketlər quraşdırılır"
npm ci

say "Baza sxemi tətbiq edilir"
npx prisma db push --skip-generate
npx prisma generate

say "Demo məlumat (yalnız baza boşdursa)"
npm run db:seed || echo "Bazada artıq məlumat var — demo məlumat yazılmadı."

mkdir -p storage/uploads storage/backups

cat <<'MSG'

Hazırdır. İşə salmaq üçün:
  npm run dev        →  http://localhost:3000
  npm run worker     →  ayrı terminalda (Excel idxalı üçün)

İlk açılışda /setup səhifəsində ROOT istifadəçi yaradın.
Köhnə kompüterdəki məlumatları olduğu kimi köçürmək üçün README-dəki "Başqa kompüterə köçürmə" bölməsinə baxın.
MSG
