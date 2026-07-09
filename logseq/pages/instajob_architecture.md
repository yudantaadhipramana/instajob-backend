project:: InstaJob
tags:: instajob, architecture
date:: 2026-07-09
updated:: 2026-07-09

# InstaJob — Architecture v2

## Project Paths
- Backend: C:/Users/OMNIBOOK/Desktop/instajob-backend
- Frontend: C:/Users/OMNIBOOK/Desktop/instajob-backend/src/app (Next.js App Router)
- Excel Checklist: C:/Users/OMNIBOOK/Desktop/InstaJob_Project_Checklist_v2.xlsx
- Generator Script: C:/Users/OMNIBOOK/Desktop/gen_checklist.py
- Logseq: C:/Users/OMNIBOOK/Desktop/instajob-backend/logseq/pages/

## Entry Points
- Backend: src/index.ts (~1625+ baris, semua endpoint masih monolith di satu file)
- Frontend: src/app/ (Next.js App Router, per-page file)
- Prisma schema: prisma/schema.prisma
- Seed: prisma/seed.js (CommonJS)

## Tech Stack
- Runtime: Node.js + TypeScript (npx tsx src/index.ts)
- Framework: Fastify (port 3001)
- ORM: Prisma v5.22
- DB: PostgreSQL (DATABASE_URL in .env)
- Queue: BullMQ + Redis (Redis OFFLINE — enableOfflineQueue:false workaround)
- Auth: JWT via @fastify/jwt — SEMENTARA DI-BYPASS (hardcoded debug-user-id)
- Frontend: Next.js App Router
- Package mgr: npm, "type": "commonjs"
- Telegram: Telegraf (@instajobid_bot, long-polling)
- AI: OpenAI client di src/services/aiService.ts

## CRITICAL BUG (BELUM DIFIX)
- File: src/index.ts line 692-727
- Bug: hardcoded 'debug-user-id' fallback aktif di production path
- Risk: siapapun bisa akses data user lain tanpa auth
- Fix: reactivate fastify.authenticate, hapus hardcoded fallback
- Blocker untuk: production deploy

## Database
- Total model: 25+ di prisma/schema.prisma
- Dev workflow: npx prisma db push (bukan migrate — migration_lock masih sqlite)
- Seed user: debug@instajob.test (subscriptionType: free)
- Production: perlu fresh migration history (bukan db push)

## LOCKED ARCHITECTURAL DECISIONS (9 Juli 2026)

### Auto-Apply Button State Machine
3 tombol: Start / Pause / Stop
- IDLE: Start[ON] Pause[OFF] Stop[OFF]
- RUNNING: Start[OFF] Pause[ON] Stop[ON]
- PAUSED: Start[ON] Pause[OFF] Stop[ON]
- STOPPED = IDLE (bukan state terpisah, bisa Start lagi langsung)
- File target: src/app/auto-apply/page.tsx (belum dibuat)

### AutoApplyRun Snapshot Pattern
- Saat Start diklik → buat AutoApplyRun baru
- Snapshot Preference disimpan di field snapshotPreference (JSON)
- Run pakai snapshot, BUKAN live Preference
- Cegah filter berubah di tengah run
- Schema: AutoApplyRun(id, userId, status, snapshotPreference, startedAt, pausedAt, stoppedAt, appliedCount)

### Edit-Lock Pattern (Profile / Preference / Setting)
- Default state: read-only
- Klik Edit → cek AutoApplyRun status
- Jika RUNNING → konfirmasi: "Auto-Apply akan dihentikan. Lanjutkan?"
- Jika user confirm → stop run, unlock edit
- Berlaku di: Profile page, Preference page, Setting page

### Job Scout Waterfall (LOCKED ORDER)
Layer 3 → Layer 2 → Layer 4
- Layer 3: Local Parser (Greenhouse/Ashby/Lever API) — zero cost, prioritas tertinggi
- Layer 2: DDGS — gratis unlimited, PRIMARY search engine
- Layer 4: Google CSE Paid — fallback HANYA jika DDGS unhealthy
- Layer 1: Google CSE Free (100/hari) — PENDING DECISION: Opsi A (hapus) atau Opsi B (pertahankan sebelum DDGS)?
- PENDING: user belum pilih — pengaruhi ScoutCacheService schema

### DDGS Circuit Breaker (bukan AI agent)
Implementasi: src/services/ddgsHealthService.ts (belum dibuat)
- Retry 3x: backoff 2s → 5s → 15s
- Gagal semua → mark unhealthy 30 menit, skip ke Layer 4
- Setelah 30 menit → probe 1 test query ringan
- Probe sukses → healthy, pakai DDGS lagi
- Breaking API change (kode rusak) → alert admin saja, manusia yang fix

### ScoutCache Dedup
- Hash key: role + location + workType
- TTL: 24 jam
- 10 user filter sama → 1 query saja
- Job re-discovered → TIDAK reset age, lanjut dari discoveredAt awal

### UserPreference: Single Location
- Hapus multi-location dari UI
- 1 location field saja
- Tambah field: emailTemplate (wajib diisi sebelum Auto-Apply bisa Start)
- Tambah field: coverLetterTemplate (opsional)
- Placeholder email: {role} {company} {recruiter} (recruiter opsional, fallback "Dear Hiring Manager")

### GET /api/jobs — Read-Only dari DB
- Endpoint ini TIDAK boleh trigger scraping real-time
- Hanya baca dari DB lokal (Job table)
- Scraping hanya via Scout Engine cron/queue

## Route Map (lengkap, dari src/index.ts)
Auth: POST /auth/register, POST /auth/login
Profile: GET /api/profile, PUT /api/profile
Jobs: POST /api/jobs, GET /api/jobs, GET /api/jobs/search, GET /api/jobs/:id, POST /api/jobs/:id/apply
Applications: GET /api/applications
AI: POST /api/ai/tailor-cover-letter, GET /api/ai/recommendations
Bookmarks: GET/POST/DELETE /api/bookmarks
Gamification: POST /api/gamification/check-in, GET /api/gamification/achievements
Auto-Apply: POST /api/auto-apply/queue, GET /api/auto-apply/queue, GET /api/auto-apply/quota
Referral: POST/GET /api/referral, GET /api/referral/earnings, POST /api/referral/withdraw, GET /api/referral/leaderboard
Subscription: GET/POST/DELETE /api/subscription
Telegram: POST /api/telegram/link, GET /api/telegram/status
Analytics: GET /api/analytics/overview, /applications, /jobs, /performance
Admin: GET /api/admin/users, /jobs, /health, /analytics
Misc: GET /api/trx, GET /api/chat (di luar protected scope — auth bypass bug)
Webhooks: POST /api/webhooks/resend (src/routes/webhookRoutes.ts, minimal)

## Reference: Other Bot (Architecture Inspiration)
- @jinnjob_bot di Hermes profile job-hunter
- Path: C:/Users/OMNIBOOK/AppData/Local/hermes/profiles/job-hunter/
- Pola: 19 parallel DDGS scout scripts + SQLite job_hunter.db + email sender
- Single-tenant hardcoded 1 kandidat
- Jadi referensi arsitektur Scout Engine InstaJob yang multi-tenant
