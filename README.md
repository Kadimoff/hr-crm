# ASOİU HR CRM — Kadr və Əməkhaqqı İdarəetmə Sistemi

Ali təhsil və çoxpilləli korporativ müəssisələr üçün (AR Əmək Məcəlləsi, ASOİU strukturu) kadr və əməkhaqqı sistemi.

**Stek:** Next.js 15 (App Router, Server Actions, React 19) · TypeScript strict · Tailwind CSS v4 · Radix (shadcn üslubu) · TanStack Table v8 + Virtual · Framer Motion · Recharts · Prisma 6 + PostgreSQL 16 · Redis + BullMQ · ExcelJS (axın rejimi) · Zod

## İşə salma (yeni kompüterdə)

Lazımdır: **Git**, **Docker** (Compose v2 ilə) və **Node.js 20+**.

```bash
git clone git@github.com:Kadimoff/hr-crm.git   # və ya https://github.com/Kadimoff/hr-crm.git
cd hr-crm
npm run setup        # .env, PostgreSQL + Redis, paketlər, sxem, demo məlumat — hamısı bir əmrlə
npm run dev          # http://localhost:3000
npm run worker       # ayrı terminalda — Excel idxalı worker-i (BullMQ)
```

İlk açılışda **/setup** səhifəsində ROOT istifadəçi yaradılır. Demo məlumat (640 şəxs, 24 bölmə) yalnız baza boş olduqda yazılır.

Digər əmrlər:

| Əmr | Nə edir |
| --- | --- |
| `npm run dev:lan` | Lokal şəbəkədən `http://<IP>:3000` ilə giriş — IP-ni `.env`-də `DEV_ORIGINS`-ə yazın |
| `npm test` | Validasiya və hesablama testləri |
| `npm run typecheck` | TypeScript yoxlaması |
| `npm run db:studio` | Bazaya Prisma Studio ilə baxış |

> Portlar başqa layihə ilə toqquşursa (5433, 6380), `docker-compose.override.yml` yaradıb portu dəyişin
> və `.env`-dəki `DATABASE_URL` / `REDIS_URL`-i uyğunlaşdırın. Bu fayl git-ə düşmür.

### Başqa kompüterə köçürmə (məlumatlar olduğu kimi)

Kod GitHub-dan gəlir, məlumatlar isə backup faylı ilə köçürülür (fayl repo-ya **qoyulmur** — şəxsi məlumat və şifrə hash-ları var):

1. Köhnə kompüterdə: **Verilənlər bazası → Backup al**, sonra həmin sətirdə **Yüklə** (`backup-….zip`).
2. Yeni kompüterdə `npm run setup`, `npm run dev`, /setup-da müvəqqəti ROOT yaradın.
3. **Verilənlər bazası → Fayldan yüklə** ilə faylı seçin, sonra onun sətrində **Bərpa et**.
4. Bərpadan sonra köhnə kompüterdəki istifadəçi adı və şifrə ilə daxil olun.

Struktur xəritəsinin düzülüşü və görünüşü brauzerdə saxlanılır, köçürülmür.

**Şəxsi iş sənədləri** (dosyedəki «Şəxsi iş» tabına yüklənən PDF, skan, şəkil, Word, Excel faylları) diskdə `storage/documents/` qovluğunda saxlanılır (`.env`-də `DOCUMENTS_DIR`) və **backup faylına daxildir**: backup — bir `.zip` faylıdır (`database.json` + `documents/`). Bərpa həm bazanı, həm sənəd fayllarını qaytarır. Çox böyük backup-ı brauzerdən yükləmək əvəzinə faylı yeni kompüterdə birbaşa `storage/backups/` qovluğuna kopyalamaq da olar — siyahıda görünəcək. Köhnə `.json.gz` backup-lar yalnız bazanı bərpa edir.

## Production (Docker / Coolify)

Bir image iki rejimdə işləyir: `app` (Next.js, başlayanda bazanın sxemini `prisma db push` ilə tətbiq edir) və `worker` (Excel idxalı). `docker-compose.prod.yml` hamısını qaldırır: app, worker, PostgreSQL 16, Redis.

```bash
POSTGRES_PASSWORD='güclü-şifrə' APP_URL='https://hr.example.az' docker compose -f docker-compose.prod.yml up -d --build
```

| Dəyişən | Məna |
| --- | --- |
| `POSTGRES_PASSWORD` | Məcburi — bazanın şifrəsi |
| `APP_URL` | Sistemin xarici ünvanı — çap və Excel-dəki QR kod / linklər bunu göstərir |
| `COOKIE_SECURE` | HTTPS arxasında `true` (defolt) |
| `APP_PORT` | Host portu (defolt 3000) |
| `TRUSTED_PROXY_HOPS` | Tətbiqin qarşısındakı etibarlı reverse proxy-lərin sayı (defolt `0` — birbaşa port). `0`-da klient IP-si TCP soketdən götürülür, `X-Forwarded-For` nəzərə alınmır (saxtalaşdırıla bilməz); Traefik/nginx arxasında `1` |
| `BACKUP_ENCRYPTION_KEY` | İstəyə görə — 32 baytlıq açar (`openssl rand -hex 32`). Verilsə, avtomatik backup-ların şifrəli nüsxəsi yazılır (aşağıda) |
| `BACKUP_OFFSITE_DIR` | Şifrəli nüsxələrin qovluğu (defolt `storage/backups/offsite`) |

- **Volume-lar**: `storage` (şəxsi iş sənədləri, backup `.zip`-lər, idxal faylları — app və worker ortaq istifadə edir), `pgdata`, `redisdata`. `storage` itərsə sənəd faylları itir — server backup-ına daxil edin.
- **Sağlamlıq yoxlaması**: `GET /api/health` (giriş tələb etmir, bazanı yoxlayır).
- Image build zamanı typecheck və testlər işləyir — keçməsə yeni versiya yaranmır, işləyən qalır.
- İlk açılışda `/setup`-da ROOT yaradılır; köhnə məlumatlar **Verilənlər bazası → Fayldan yüklə → Bərpa et** ilə gətirilir.

### Canlı server (Coolify) və avtomatik yenilənmə

Sistem serverdə Coolify layihəsi **HR CRM** → tətbiq **hr-crm** kimi işləyir (Docker Compose, port `6633`): http://169.58.163.254:6633

- **Avtomatik deploy:** serverdəki `hr-crm-autodeploy.timer` hər dəqiqə GitHub-dakı `main` budağını yoxlayır. Yeni commit görəndə **əvvəlcə backup** alır (`npm run backup -- deploy` — baza + sənədlər, Verilənlər bazası səhifəsində görünür), sonra Coolify-da deploy başladır. Push-dan saytda görünənə qədər ~4–7 dəqiqə. Build alınmasa (typecheck/test), işləyən versiya qalır.
- **Gecə backup-ı:** `hr-crm-backup.timer` hər gün 03:45. Saxlanılır: son 10 deploy və son 14 gecə backup-ı; əl ilə alınanlar silinmir.
- Yarımçıq işi ayrıca budaqda saxlayın — `main`-ə düşən hər commit canlıya çıxır. Deploy zamanı tətbiq bir neçə saniyə yenidən başlayır.
- Loqlar: `journalctl -u hr-crm-autodeploy -n 50`, `journalctl -u hr-crm-backup -n 20`.

### Server xaricində backup (tövsiyə)

Hazırda backup-lar (`storage/backups`) tətbiqin özü ilə **eyni serverdədir** — disk sıradan çıxsa və ya server itirilsə, backup-lar da itir.
Ən azı gecə backup-larının bir nüsxəsini başqa yerə (S3-uyğun saxlama, başqa server) göndərmək tövsiyə olunur:

1. Açar yaradın və **ayrıca, təhlükəsiz yerdə** saxlayın (parol meneceri, seyf): `openssl rand -hex 32`. Açar itərsə şifrəli nüsxələr açılmır.
2. Coolify-da tətbiqin mühit dəyişənlərinə `BACKUP_ENCRYPTION_KEY=<açar>` əlavə edin. Bundan sonra `npm run backup -- deploy|nightly`
   əsas `.zip`-dən əlavə onun AES-256-GCM ilə şifrələnmiş nüsxəsini `storage/backups/offsite/<ad>.zip.enc` kimi yazır
   (köhnələri eyni qayda ilə silinir: 10 deploy, 14 gecə). Serverdəki əsas backup-lar və onların bərpası dəyişmir.
3. Host-da `offsite` qovluğunu xarici yerə sinxronlaşdırın — məs. `hr-crm-backup.service`-dən sonra
   `rclone copy <volume>/backups/offsite remote:hr-crm-backups` (və ya `rsync`/`scp` başqa serverə). Fayllar artıq şifrəlidir —
   xarici tərəf məzmunu görmür.
4. Bərpa: `.zip.enc` faylını **Verilənlər bazası → Fayldan yüklə** ilə birbaşa yükləyin (serverdə eyni açar təyin edilibsə, server özü açır)
   və ya əvvəlcə açın: `BACKUP_ENCRYPTION_KEY=… npm run backup:decrypt -- backup-….zip.enc` → adi `.zip`.

Format: `HRCRMENC1` imzası · 12 bayt IV · şifrəmətn · 16 bayt GCM auth tag — fayl dəyişdirilibsə və ya açar səhvdirsə açılmır.

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

## Hesablar və giriş təhlükəsizliyi

- Root yeni istifadəçi yaradanda və ya başqasının şifrəsini sıfırlayanda həmin istifadəçi **növbəti girişdə şifrəsini dəyişməlidir** —
  o vaxta qədər yalnız «Şifrəni dəyiş» səhifəsi açılır, server action və API sorğuları rədd edilir. Hər kəs şifrəsini istifadəçi
  menyusundan (**Şifrəni dəyiş**) dəyişə bilər; dəyişiklikdən sonra digər brauzer/kompüterlərdəki sessiyalar bağlanır, audit jurnalına yazılır.
- Brute-force limiti: eyni IP-dən eyni istifadəçi adına 15 dəqiqədə 5 uğursuz cəhd, eyni IP-dən istənilən adlara 20 uğursuz cəhd.
  Kilid «istifadəçi + IP» cütünə bağlıdır — başqa ünvandan edilən cəhdlər hesabın sahibini (məs. root-u) kilidləmir.
  IP TCP soketdən götürülür (`TRUSTED_PROXY_HOPS`, yuxarıda).

## Kadr hərəkəti (köçürmə, oklad dəyişikliyi)

Mövcud müqavilədə bölmə, vəzifə, oklad və ya ştat payı dəyişikliyi **əmr əsasında** qeydə alınır: əmrin nömrəsi, tarixi və qüvvəyə minmə tarixi
(dosye → «Müqavilə və maaş» → **Köçürmə / maaş dəyişikliyi**; tam redaktə formasında və struktur xəritəsinin panelində bu sahələr dəyişəndə
əmr sahələri avtomatik açılır). Müqavilə yeni vəziyyətə keçir, «əvvəl → sonra» `EmploymentMovement` cədvəlində saxlanılır, oklad tarixçəsi
(`SalaryRecord`) qüvvəyə minmə tarixindən bağlanır/açılır, hərəkət **Kadr hərəkəti** hesabatında görünür. Qüvvəyə minmə tarixi gələcəkdə ola bilməz.

## Konfiqurasiya edilən qaydalar

Aşağıdakı dəyərlər kodda bir yerdə saxlanılır və istifadəyə verilməzdən əvvəl hüquq/mühasibatlıq tərəfindən təsdiqlənməlidir:

- `src/lib/calc/payroll.ts → DEFAULT_PAYROLL_CONFIG` — gəlir vergisi pillələri (dövlət sektoru), VM 102.2 güzəşt məbləğləri, DSMF / işsizlik / İTS dərəcələri, **elmi dərəcə və elmi ada görə əlavələrin məbləğləri**.
  Güzəştlər (200 AZN azad məbləğ, VM 102.2) və elmi dərəcə/ad əlavələri şəxsə **bir dəfə — əsas iş yeri müqaviləsində** tətbiq olunur, əlavələr ştat payına
  mütənasibdir (0.5 ştat → yarısı); əvəzçilikdə yalnız oklad və zərərli şərait əlavəsi. Oklad müqavilədə ştat payı daxil olmaqla saxlanılır.
- `src/lib/calc/seniority.ts → DEFAULT_SENIORITY_CONFIG` — iş ilində stajdan çıxılmayan ödənişsiz məzuniyyət həddi (defolt 14 gün)
- `src/lib/validation/templates.ts` — sütun başlıqları və onların alternativ yazılışları (real şablonların başlıqlarına uyğunlaşdırılmalıdır)
