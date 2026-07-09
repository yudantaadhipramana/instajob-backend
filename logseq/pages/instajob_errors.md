project:: InstaJob
tags:: instajob, errors, debugging
date:: 2026-07-09
updated:: 2026-07-09

# InstaJob — Error History & Solutions

## Error 1: 500 PUT /api/user/profile — P2003 Foreign Key
- Status: RESOLVED
- Tanggal: 7 Juli 2026
- Gejala: PUT /api/user/profile return 500, log Prisma P2003
- Akar: User belum di-seed, tabel Users kosong, FK user_id tidak bisa direfer
- Solusi: Seed user debug@instajob.test (subscriptionType: free) via prisma/seed.js (CommonJS)
- Verifikasi: curl /api/user/profile 200 OK

## Error 2: Redis ECONNREFUSED — BullMQ offline
- Status: RESOLVED (workaround)
- Tanggal: 7 Juli 2026
- Gejala: Server crash saat startup karena Redis tidak berjalan
- Akar: Redis service tidak aktif di mesin development
- Solusi: enableOfflineQueue: false di semua BullMQ Queue constructor
- Verifikasi: npm run build exit 0, server startup tanpa error
- Catatan: Queue masih tidak berfungsi, butuh Redis aktif untuk production

## Error 3: Prisma migration_lock sqlite conflict
- Status: WORKAROUND ACTIVE
- Tanggal: 7 Juli 2026
- Gejala: npx prisma migrate dev gagal — migration history conflict
- Akar: migration_lock.toml masih berisi "sqlite" tapi DATABASE_URL pakai PostgreSQL
- Solusi: Gunakan npx prisma db push (bypass migration history) untuk dev
- Catatan: WAJIB buat fresh migration untuk production deploy

## Error 4: hardcoded debug-user-id di production path
- Status: OPEN (CRITICAL BUG)
- Tanggal: Teridentifikasi 7 Juli 2026
- Lokasi: src/index.ts line 692-727
- Gejala: Semua endpoint return data user "debug-user-id" tanpa auth check
- Akar: Auth bypass sengaja dibuat saat dev untuk skip JWT verification
- Risiko: Security risk CRITICAL — siapapun bisa akses data user lain
- Fix diperlukan: Reactivate fastify.authenticate di semua endpoint, hapus hardcoded fallback
- Blocker untuk production: YES

## Error 5: npm run build — tsx compile warning unused imports
- Status: RESOLVED
- Tanggal: 7 Juli 2026
- Gejala: Build warning unused import di beberapa file
- Solusi: Hapus unused imports, build exit 0

## KNOWN ERRORS SESI 9 JULI 2026 (Baru ditemukan via brainstorming)

## Error 6: Multi-location Preference — query explosion risk
- Status: PLANNED FIX
- Gejala: Setiap user bisa set multiple location → N×M query combinations
- Risiko: 10.000 user × 3 lokasi = query volume jauh lebih besar dari perlu
- Fix: Hapus multi-location, ganti single location field
- Status: LOCKED DECISION, belum dieksekusi

## Error 7: /api/jobs trigger scraping real-time (arsitektur salah)
- Status: PLANNED FIX
- Gejala: GET /api/jobs bisa trigger scraping langsung, bukan dari DB lokal
- Risiko: Setiap request user bisa trigger DDGS query — boros, lambat, rate-limit risk
- Fix: /api/jobs HANYA baca dari DB lokal. Scraping hanya via Scout Engine cron/queue
- Status: LOCKED DECISION

## Error 8: DDGS crash — tidak ada recovery mechanism
- Status: PLANNED FIX
- Gejala: Jika DDGS crash/timeout, seluruh Scout Engine berhenti
- Fix: Circuit breaker — retry 3x (2s/5s/15s), mark unhealthy 30 menit, fallback ke CSE paid
- Status: LOCKED, belum diimplementasi

## Error 9: Auto-Apply run tidak punya snapshot Preference
- Status: PLANNED FIX
- Gejala: Jika user edit Preference saat Auto-Apply running, filter berubah di tengah run
- Fix: Snapshot Preference saat Start diklik, simpan di AutoApplyRun.snapshotPreference
- Status: LOCKED DECISION

## DEBUGGING PATTERNS YANG TERBUKTI BEKERJA

### Pattern: Prisma FK Error
1. Check apakah seed data ada: npx prisma studio atau prisma db seed
2. Pastikan referenced user/entity exist sebelum FK operation
3. Jika dev: gunakan debug-user-id workaround sementara

### Pattern: Port EADDRINUSE
1. Cari proses: netstat -ano | grep 3001
2. Kill: taskkill /PID <pid> /F (Windows) atau kill -9 <pid>
3. Jangan jalankan 2 server sekaligus

### Pattern: Build error TypeScript
1. npm run build untuk lihat semua error sekaligus
2. Fix error satu per satu dari atas ke bawah (dependency chain)
3. Jangan jalankan server tanpa build exit 0 dulu

### Pattern: Prisma schema change
1. Edit schema.prisma
2. npx prisma generate (update client)
3. npx prisma db push (sync ke DB, dev only)
4. Restart server
