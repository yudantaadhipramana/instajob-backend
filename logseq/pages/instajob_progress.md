project:: InstaJob
tags:: instajob, progress
date:: 2026-07-09
updated:: 2026-07-09

# InstaJob — Project Progress (v2)

## Overall Completion: ~43.2% (119 items, 13 phases)
Excel checklist: C:/Users/OMNIBOOK/Desktop/InstaJob_Project_Checklist_v2.xlsx
Generator script: C:/Users/OMNIBOOK/Desktop/gen_checklist.py

---

## Phase Breakdown

| Phase | Items | Completion |
|---|---|---|
| Phase 1: Auth & User Mgmt | 10 | 36.5% |
| Phase 2: Profile System | 12 | 49.6% |
| Phase 3: Job Scout Engine | 18 | 22.8% |
| Phase 4: Matching Engine | 6 | 34.2% |
| Phase 5: Auto Mail Engine | 7 | 14.3% |
| Phase 6: Auto-Apply Lifecycle | 6 | 0.0% — NEW, semua planned |
| Phase 7: LinkedIn Extension | 7 | 49.3% |
| Phase 8: Telegram Assistant | 8 | 59.4% |
| Phase 9: Analytics Engine | 7 | 57.1% |
| Phase 10: Referral System | 7 | 71.4% |
| Phase 11: Admin Dashboard | 7 | 60.7% |
| Phase 12: Frontend | 12 | 57.1% |
| Phase 13: DevOps & Infra | 12 | 49.2% |

---

## SESSION LOG — 9 Juli 2026

### Step A — DONE (commit 7d5b1f1)
- File: C:/Users/OMNIBOOK/instajob-frontend/src/app/settings/page.tsx
- Wire handleSaveAccountSettings -> PUT /api/user/preferences
- Fields wired: emailNotifications, telegramNotifications
- Skipped: fullName, password (no endpoint), applicationUpdates/weeklyDigest (not in schema)
- Build: exit 0

### Step B — DONE (commit 7ef8111)
- File: C:/Users/OMNIBOOK/instajob-frontend/src/app/monitor/page.tsx
- State machine: runStatus: 'idle' | 'running' | 'paused'
- Default: idle
- Conditional render: idle=Start only, running=Pause+Stop, paused=Resume+Stop
- Stop -> reset to idle
- Build: exit 0

### Step C — DONE (commit 7ef8111)
- File: C:/Users/OMNIBOOK/instajob-frontend/src/app/preferences/page.tsx
- useEffect: auth check + GET /api/user/preferences -> populate formData on mount
- handleSave: PUT /api/user/preferences (all fields)
- 401 -> redirect /login, fallback to defaultPrefs on non-401 error
- Build: exit 0

### Step D — DONE (commit ba6d1ac)
- File: C:/Users/OMNIBOOK/instajob-frontend/src/app/profile/page.tsx
- useEffect: auth check + GET /api/user/profile -> load nested response on mount
- Backend response nested: { id, email, fullName, profile: { bio, skills, ... } }
- Map profile.skills JSON.parse() to array
- handleSave: PUT /api/user/profile (phone, location, bio, skills, experience, education)
- Skipped fullName + profilePicture (no backend schema, ponytail comment for Step G)
- Build: exit 0

### Step E — DONE (commit dcc56df)
- File: C:/Users/OMNIBOOK/Desktop/instajob-backend/src/index.ts
- Security fix: /api/extension/sync-apply endpoint missing preHandler authenticate
- Root cause: endpoint had manual userId check but no JWT verification via preHandler (weak)
- Fix: added `{ preHandler: [(fastify as any).authenticate] }` to endpoint declaration
- Test verified: curl without token returns 401 Unauthorized + "No Authorization was found in request.headers"
- Backend restarted, security patch applied
- Note: memory note about "debug-user-id hardcode line 692-727" was stale — string not found in code

### Bug Fix — DONE (commit 766f987)
- File: C:/Users/OMNIBOOK/instajob-frontend/src/app/monitor/page.tsx
- Bug found during crosscheck: status badge rendered 2x (orphan from prior cleanup patch)
- Removed duplicate div (baris 626-646, identical to 604-624)
- Build verified clean

### Step F — DONE (commit 91cec03)
- File: C:/Users/OMNIBOOK/Desktop/instajob-backend/prisma/schema.prisma
- Add model AutoApplyRun with userId, status, snapshotPreference, timestamps
- Fields: id (UUID PK), userId (FK), status (default "idle"), snapshotPreference (JSON), startedAt/stoppedAt/pausedAt, createdAt/updatedAt
- Add relation autoApplyRuns to User model
- prisma db push: "Your database is now in sync" (782ms)
- prisma generate: "Generated Prisma Client (v5.22.0) in 295ms"
- Backend build: exit 0
- Model query test: prisma.autoApplyRun.findMany() → OK

### Step G — DONE (commit bd0a819)
- File: C:/Users/OMNIBOOK/Desktop/instajob-backend/src/index.ts + prisma/schema.prisma
- Add profilePicture field to UserProfile schema (nullable String)
- Add 3 endpoints (all protected with preHandler authenticate):
  1. PUT /api/user/update-name: update User.fullName (zod validation min 1, max 100)
  2. POST /api/user/change-password: bcrypt.compare(currentPassword) + bcrypt.hash(newPassword, 10)
  3. POST /api/user/upload-profile-picture: update UserProfile.profilePicture (URL validation)
- Add bcrypt import to index.ts (was missing)
- Build: exit 0
- All 8 test cases verified:
  * update-name valid token → 200 + user returned with new fullName
  * change-password valid → 200 + password rehashed in DB
  * upload-profile-picture valid → 200 + profilePicture URL stored
  * Login with new password → 200 + token returned
  * Login with old password → 401 "Invalid credentials"
  * update-name without token → 401 "No Authorization was found in request.headers"
  * change-password with wrong currentPassword → 400 "Current password is incorrect"
  * upload-profile-picture with invalid URL → 400 validation error

### Git Checkpoints
- 7d5b1f1: feat: wire notification preferences to backend API
- 7ef8111: feat: Pause/Resume/Stop state machine di monitor page + wire preferences ke real API
- ba6d1ac: feat: wire profile page to real API (GET+PUT /api/user/profile)
- 766f987: fix: remove duplicate status badge in monitor page
- dcc56df: fix: add authentication to /api/extension/sync-apply endpoint
- 91cec03: feat: add AutoApplyRun model for tracking bot runs
- bd0a819: feat: Step G - add update-name, change-password, upload-profile-picture endpoints

---

## NEXT STEPS (if any)

### Backend API completeness check
- Verify all user-facing endpoints have preHandler authenticate protection
- Check if frontend profile/settings pages can now call new endpoints

### Frontend integration (if needed)
- Wire fullName + password inputs in settings page to new endpoints
- Wire profilePicture upload to new endpoint
- POST /api/user/upload-profile-picture (unblock profile profilePicture)

---

## LOCKED ARCHITECTURAL DECISIONS (sesi 9 Juli 2026)

### Auto-Apply Button State Machine
- IDLE: Start[ON] Pause[OFF] Stop[OFF]
- RUNNING: Start[OFF] Pause[ON] Stop[ON]
- PAUSED: Start[ON] Pause[OFF] Stop[ON]
- STOPPED = IDLE (bukan state terpisah)
- Stop -> reset ke IDLE, bisa Start lagi

### Edit-Lock Pattern (Profile / Preference / Setting page)
- Default: read-only
- Klik Edit -> cek status Auto-Apply run
- Jika RUNNING -> dialog konfirmasi "Auto-Apply akan dihentikan. Lanjutkan?"
- Berlaku di: Profile page, Preference page, Setting page

### Job Scout Waterfall Layer Order (LOCKED)
Layer 3 (Local Parser: Greenhouse/Ashby/Lever, zero cost)
  -> Layer 1 (CSE Free 100/hari) — Opsi B: tetap sebelum DDGS
  -> Layer 2 (DDGS primary, circuit breaker klasik retry 3x 2s/5s/15s unhealthy 30min)
  -> Layer 4 (CSE Paid, fallback DDGS down saja)

### DDGS Auto-Maintenance
- Circuit breaker klasik (bukan AI agent)
- Retry 3x backoff: 2s -> 5s -> 15s
- Gagal semua -> mark unhealthy 30 menit, skip ke Layer 4
- Setelah 30 menit -> probe 1 test query ringan
- Probe sukses -> healthy, pakai DDGS lagi
- Breaking API change = alert admin saja, manusia yang fix

### AutoApplyRun Snapshot Pattern
- Saat user klik Start -> buat AutoApplyRun baru
- Snapshot Preference disimpan di kolom snapshotPreference (JSON)
- Run pakai snapshot, bukan live Preference
- Cegah filter berubah di tengah run

### Scout Query Dedup (ScoutCache)
- Hash key: role + location + workType
- TTL cache: 24 jam
- 10 user filter sama -> 1 query saja
- Job re-discovered -> TIDAK reset age, lanjut dari discoveredAt awal

### Job Preference: Single Location Only
- Hapus multi-location dari UI Preference
- Satu location field saja
- emailTemplate field WAJIB diisi sebelum Auto-Apply bisa Start

### PENDING DECISION
- Layer 1 CSE Free: Opsi A (hapus dari waterfall) vs Opsi B (pertahankan sebelum DDGS)?
- Ini pengaruhi ScoutCacheService schema

---

## ERRORS ENCOUNTERED & SOLUTIONS (sesi 9 Juli 2026)

### Dev Server Conflict (Next.js Turbopack)
- Error: "Another next dev server is already running"
- Root: Turbopack punya singleton lock per directory
- Fix: taskkill /PID <pid> /F (bukan //PID — Windows flag)
- Detection: netstat -ano | grep :3000, ambil PID kolom terakhir

### Port 3000 Kill Syntax Windows
- WRONG: taskkill //PID 9072 //F
- CORRECT: taskkill /PID 9072 /F

### node_modules tracked in git
- Ratusan lucide-react/nanoid files berubah karena npm install auto-update
- Solusi pending: tambah node_modules/ ke .gitignore

### 500 on PUT /api/user/preferences
- Curl test pakai userId fiktif (test-user-id) -> Prisma FK error -> normal 500
- Bukan bug — expected behavior, user tidak exist di DB
- Endpoint berfungsi benar untuk real user

### Profile GET response nested (Step D)
- Backend return nested: { id, email, fullName, profile: { bio, skills, ... } }
- Frontend asumsi flat response → mapping error
- Fix: destructure data.profile, JSON.parse(profile.skills)

### Profile PUT schema mismatch (Step D)
- Frontend kirim fullName + profilePicture → backend zod error
- Backend schema hanya terima: bio, skills, experience, education, phone, location, resumeUrl
- Fix: skip fullName + profilePicture dari body, ponytail comment untuk Step G

### Step H — DONE (commits e5e50cb backend + b169618 frontend)
**Backend: Bot Orchestration Endpoints (src/index.ts)**
- POST /api/bot/start → create AutoApplyRun, queue jobs (50 mock), return runId + metrics
- POST /api/bot/pause → update AutoApplyRun.status = 'paused', pausedAt timestamp
- POST /api/bot/resume → update status = 'running', clear pausedAt
- POST /api/bot/stop → update status = 'stopped', stoppedAt timestamp, fail pending queue items
- GET /api/bot/status → return AutoApplyRun + BotStatus + queue metrics (pending/sent/failed)
- Removed legacy Phase 3A bot endpoints (duplicate conflict)
- Build: exit 0
- Test: 7 curl lifecycle tests passed (login → start → pause → resume → stop → status)

**Frontend: Monitor Page Wiring (src/app/monitor/page.tsx)**
- State: botMetrics, actionLoading, actionError
- useEffect: fetch initial bot status on mount + 5s polling loop when running/paused
- handleStart: call POST /api/bot/start (idle) or /api/bot/resume (paused)
- handlePause: call POST /api/bot/pause
- handleStop: call POST /api/bot/stop
- UX: button disable during loading, loading text (⋯ Starting.../Pausing...), error banner
- Build: exit 0

**Bugfix (src/app/settings/page.tsx)**
- Pre-existing runtime error: parsedUser.id.substring() failed when id not string
- Fix: String(parsedUser.id).substring() for type safety
- Error cleared after frontend restart

**Integration verified:**
- Backend health: GET /api/jobs HTTP 200
- Frontend health: GET / HTTP 200
- Bot lifecycle: start→running, pause→paused, resume→running, stop→stopped (all passed)
- Servers live: backend 3001, frontend 3000
- Zero runtime errors post-fix

---

## Tech Stack

- Runtime: Node.js + TypeScript via `npx tsx src/index.ts`
- Framework: Fastify (port 3001)
- ORM: Prisma v5.22
- Database: PostgreSQL (DATABASE_URL in .env)
- Queue: BullMQ + Redis (Redis OFFLINE — enableOfflineQueue:false, graceful fallback)
- Auth: JWT via @fastify/jwt (JWT_SECRET butuh env var sebelum prod)
- Package mgr: npm, "type": "commonjs"
- Frontend: Next.js 16.2.9 App Router (src/app/) port 3000
- Backend entry: src/index.ts (~1625+ baris, belum dipecah ke controllers)
- Frontend dir: C:/Users/OMNIBOOK/instajob-frontend
- Backend dir: C:/Users/OMNIBOOK/Desktop/instajob-backend

## Critical Bugs

### BLOCKER: debug-user-id hardcoded (src/index.ts line 692-727)
- Security risk: siapapun bisa akses data user lain
- WAJIB fix sebelum production deploy
- Fix: reactivate fastify.authenticate di semua endpoint
- Status: BELUM DIFIX

### node_modules in git
- .gitignore belum exclude node_modules/
- Status: BELUM DIFIX

## Database
- 25+ model di prisma/schema.prisma
- Seed: debug@instajob.test (subscriptionType: free)
- npx prisma db push untuk dev (bukan migrate)
- migration_lock masih sqlite — perlu fresh migration untuk prod
