# ASOİU HR CRM — Kadr və Əməkhaqqı İdarəetmə Sistemi

Ali təhsil və çoxpilləli korporativ müəssisələr üçün (AR Əmək Məcəlləsi, ASOİU strukturu) kadr və əməkhaqqı sistemi.

**Stek:** Next.js 15 (App Router, Server Actions, React 19) · TypeScript strict · Tailwind CSS v4 · Radix (shadcn üslubu) · TanStack Table v8 + Virtual · Framer Motion · Recharts · Prisma 6 + PostgreSQL 16 · Redis + BullMQ · ExcelJS (axın rejimi) · Zod

## İşə salma

```bash
cp .env.example .env
docker compose up -d          # PostgreSQL :5433, Redis :6380
npm install
npx prisma db push            # sxemi bazaya tətbiq edir
npm run dev                   # http://localhost:3000
npm run worker                # ayrı terminalda — idxal worker-i (BullMQ)
npm test                      # validasiya və hesablama testləri
```

> Host-da Node işləmirsə (məs. kitabxana uyğunsuzluğu), eyni əmrləri konteynerdə icra edin:
> `docker run --rm -it --network host -v "$PWD":/app -w /app node:22-alpine npm run dev`

## Struktur

| Yol | Məzmun |
| --- | --- |
| `prisma/schema.prisma` | Normallaşdırılmış sxem: 10 şablonun bütün sahələri, temporal etibarlılıq (`validFrom/validTo`, `SalaryRecord`), JSONB genişlənmə, ETL staging cədvəlləri |
| `src/lib/validation/templates.ts` | 30 vərəq üçün başlıq xəritəsi (alternativ yazılışlarla), Zod sxemləri, semantik və istinad qaydaları |
| `src/lib/validation/primitives.ts` | `DD.MM.YYYY` tarix, FİN (7 simvol), Bəli/Xeyr, enum, rəqəm primitivləri |
| `src/lib/etl/parser.ts` | ExcelJS axın oxuyucusu — başlıq sətrini avtomatik tapır, 500 sətirlik hissələrlə yazır |
| `src/lib/etl/validator.ts` | Topoloji 8 mərhələli, 3 səviyyəli yoxlama (sintaktik → semantik → istinad) |
| `src/lib/etl/committer.ts` | Topoloji yazılma; siyahı vərəqləri şəxs üzrə atomik əvəz olunur |
| `src/workers/import-worker.ts` | BullMQ worker-i; irəliləyiş Redis pub/sub → SSE ilə brauzerə ötürülür |
| `src/lib/calc/` | Staj, məzuniyyət və əməkhaqqı mühərrikləri |
| `src/components/import/` | Yükləmə sihirbazı və redaktə edilən xəta cədvəli |

## Şablonlar

Təriflər **"Kadr məlumatlarının yüklənməsi üçün şablonlar — əməkhaqqı üçün yenilənmiş 29.09.2025"** paketinə və
"Şablonların doldurulması üzrə təlimat" sənədinə uyğundur: 10 fayl, 38 vərəq. "Fiziki şəxslər" vərəqinin iki sətirli
birləşdirilmiş başlıqları ("Əmək stajı → İllər / Aylar / Günlər" və s.) dəstəklənir.

Təlimatdan götürülən qaydalar:
- "Tarixə" şablonları 30.06.2025, "dövr ərzində" şablonları (9, 10) 01.07.2024 – 30.06.2025 üzrə yoxlanılır (dövrdən kənar tarix — xəbərdarlıq)
- Məzuniyyət qalıqları 01.04.2025 tarixinədək **tam** iş illəri üçün; iş ilinin sonu həm `başlanğıc + 1 il` (təlimatdakı nümunə), həm `+1 il − 1 gün` kimi qəbul olunur
- 4 məzuniyyət vərəqi (əsas, staj, iş şəraiti, qadınlar) iş ili üzrə bir qeyddə birləşir
- "Kvota üzrə əsas məzuniyyət günlərinin miqdarı" vəzifənin əsas məzuniyyətini **əvəz edir**
- İşdə iştirak etməmə kodları: `xəstəlik` / `naməlum`, `sm` / `ö/sm`, `ö/m`; stajdan yalnız `ö/m` (ödənişsiz məzuniyyət) çıxılır
- Vəzifə adları təkrarlana bilməz; uşağın qeydiyyat tarixi qaydası avtomatik yoxlanılır və boş olduqda doldurulur

## İdxal ardıcıllığı

1. Struktur bölmələri (5, 1-ci → 4-cü mərhələ) → 2. Vəzifələr (1) → 3. Ştat cədvəli (4) → 4. Fiziki şəxslər (1) → 5. Əməkdaşlar (1) →
6. Paralel profillər (1, 2, 6, 7, 8) → 7. Məzuniyyət qalıqları (3) → 8. Hərəkətlər (9, 10)

Fayl adı nömrə ilə başlayırsa (`3 Məzuniyyətlərin qalıqları.xlsx`) şablon avtomatik təyin olunur; əks halda sihirbazda seçilir.
Boş şablonlar İdxal mərkəzindəki **Boş şablonlar** menyusundan yüklənə bilər.

## Konfiqurasiya edilən qaydalar

Aşağıdakı dəyərlər kodda bir yerdə saxlanılır və istifadəyə verilməzdən əvvəl hüquq/mühasibatlıq tərəfindən təsdiqlənməlidir:

- `src/lib/calc/payroll.ts → DEFAULT_PAYROLL_CONFIG` — gəlir vergisi pillələri (dövlət sektoru), VM 102.2 güzəşt məbləğləri, DSMF / işsizlik / İTS dərəcələri, **elmi dərəcə və elmi ada görə əlavələrin məbləğləri**
- `src/lib/calc/seniority.ts → DEFAULT_SENIORITY_CONFIG` — iş ilində stajdan çıxılmayan ödənişsiz məzuniyyət həddi (defolt 14 gün)
- `src/lib/validation/templates.ts` — sütun başlıqları və onların alternativ yazılışları (real şablonların başlıqlarına uyğunlaşdırılmalıdır)
