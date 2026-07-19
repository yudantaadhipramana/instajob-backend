# InstaJob Deployment Safety Protocol

**Purpose:** Zero-regression deployment workflow untuk InstaJob MVP  
**Last updated:** 2025-05-17

---

## Pre-Deploy Checklist

### 1. Build Verification (MANDATORY)

```bash
cd /c/Users/OMNIBOOK/Desktop/instajob-backend
npm run build
```

**Expected output:**
```
> build
> tsc
```

**If errors:**
- Fix TypeScript errors BEFORE push
- Common issues:
  - Prisma client out of sync → `npx prisma generate`
  - Missing type imports → add to top of file
  - Duplicate route → check `git diff` for repeated `fastify.get/post`

**Never push jika build fail.**

---

### 2. Duplicate Route Check

**Pattern:**
```bash
grep -n "fastify.get.*route-name" src/index.ts
```

**Expected:** 1 match per route

**If 2+ matches:**
- Delete old route (usually earlier line number)
- Commit dengan message: `fix: remove duplicate {route-name} route`

**Example:**
```bash
# Before commit
grep -n "skill-gap" src/index.ts
# 1958: fastify.get('/api/ai/skill-gap/:jobId', ...
# 2008: fastify.get('/api/ai/skill-gap/:jobId', ...

# Delete line 1958-1980 (old route)
# Commit fix
```

---

### 3. Prisma Schema Changes

**If schema changed (`prisma/schema.prisma`):**

```bash
# Generate Prisma client (local)
npx prisma generate

# Commit schema change
git add prisma/schema.prisma
git commit -m "feat(schema): add {ModelName} model"

# Push ke Railway (migration auto-run)
git push origin main
railway up --detach
```

**Railway auto-run migration** jika:
- `prisma/schema.prisma` changed
- Railway deployment triggered

**Manual migration (kalau perlu):**
```bash
railway run npx prisma migrate deploy
```

**Gotcha:** Local DB mati → migration lokal tidak bisa. Pakai Railway prod DB saja.

---

### 4. Environment Variables Check

**Required env vars (Railway):**

| Variable | Purpose | Set in Railway Dashboard |
|----------|---------|-------------------------|
| `DATABASE_URL` | PostgreSQL connection | Auto-generated |
| `JWT_SECRET` | JWT signing key | Manual (generate with `openssl rand -hex 32`) |
| `COOKIE_SECRET` | Cookie signing | Optional (fallback ke JWT_SECRET) |
| `GOOGLE_CLIENT_ID` | OAuth client ID | Google Cloud Console |
| `GOOGLE_CLIENT_SECRET` | OAuth client secret | Google Cloud Console |
| `GOOGLE_REDIRECT_URI` | OAuth callback | `https://api.instajob.id/api/integrations/gmail/callback` |
| `DEEPSEEK_API_KEY` | AI match scoring | DeepSeek platform |
| `OPENAI_API_KEY` | AI cover letter | OpenAI platform |
| `NODE_ENV` | Environment | `production` |

**Check current values:**
```bash
railway variables
```

**Update:**
```bash
railway variables set KEY=value
```

---

## Deploy Workflow

### Standard Deploy

```bash
# 1. Build check
npm run build

# 2. Duplicate route check
grep -n "fastify.get\|fastify.post" src/index.ts | grep -v "//" | sort | uniq -d

# 3. Commit
git add -A
git commit -m "feat(scope): description"
git push origin main

# 4. Trigger Railway deploy (if not auto-triggered)
railway up --detach
```

---

### Emergency Rollback

**Scenario:** Deploy crash production

**Steps:**
```bash
# 1. Find last working commit
git log --oneline -10

# 2. Revert to last working commit
git revert <commit-sha>
git push origin main

# 3. Railway auto-deploy reverted commit
```

**Or force-deploy previous commit:**
```bash
# Reset to previous commit (DESTRUCTIVE — use dengan hati-hati)
git reset --hard <commit-sha>
git push origin main --force
```

**Rollback time:** ~2-3 menit (Railway build + deploy)

---

## Post-Deploy Verification

### 1. Health Check

```bash
# Backend
curl -I https://api.instajob.id/api/jobs
# Expected: HTTP/2 200

# Frontend
curl -I https://instajob.id
# Expected: HTTP/2 200
```

---

### 2. Auth Flow Test

```bash
# Python test script
python3 << 'EOF'
import requests

base = "https://api.instajob.id"
s = requests.Session()

# Test register
r = s.post(f"{base}/api/auth/register", json={
    "email": f"test_{int(__import__('time').time())}@test.com",
    "password": "StrongP@ss123!",
    "fullName": "Test User"
})
print(f"Register: {r.status_code}")
assert r.status_code == 201, r.text

# Test cookie auth
r2 = s.get(f"{base}/api/auth/me")
print(f"Auth me: {r2.status_code}")
assert r2.status_code == 200, r2.text

print("✅ Auth flow OK")
EOF
```

**Expected output:**
```
Register: 201
Auth me: 200
✅ Auth flow OK
```

---

### 3. Railway Status Check

```bash
railway status
```

**Expected:**
```
status:        ● Online
deployment ID: <uuid>
```

**If "● Crashed":**
```bash
# Check logs
railway logs --deployment <deployment-id> | grep -iE "error|fail|crash" | tail -30
```

---

## Common Deployment Errors

### Error 1: FST_ERR_DUPLICATED_ROUTE

**Message:**
```
FST_ERR_DUPLICATED_ROUTE: Method 'GET' already declared for route '/api/...'
```

**Cause:** Route defined 2x di `index.ts`

**Fix:**
```bash
# Find duplicate
grep -n "route-name" src/index.ts

# Delete earlier occurrence
# Commit fix
git add src/index.ts && git commit -m "fix: remove duplicate route" && git push
```

---

### Error 2: Prisma Client Out of Sync

**Message:**
```
Property 'fieldName' does not exist on type 'Model'
```

**Cause:** Schema updated tapi Prisma client belum regenerate

**Fix:**
```bash
npx prisma generate
npm run build  # Verify
git add -A && git commit -m "fix: regenerate Prisma client" && git push
```

---

### Error 3: Environment Variable Missing

**Message:**
```
Error: JWT_SECRET env var required in production
```

**Cause:** Env var not set in Railway

**Fix:**
```bash
railway variables set JWT_SECRET=$(openssl rand -hex 32)
```

**Verify:**
```bash
railway variables | grep JWT_SECRET
```

---

### Error 4: Database Migration Failed

**Message (Railway logs):**
```
Prisma schema validation error
```

**Cause:** Schema drift between local & prod, atau migration conflict

**Fix:**
```bash
# Check migration status
railway run npx prisma migrate status

# If failed, reset migration (DESTRUCTIVE — backup DB first)
railway run npx prisma migrate reset --force
```

**Prevention:** Always test schema changes di staging environment dulu

---

## Monitoring

### Railway Logs

```bash
# Live tail
railway logs

# Filter errors
railway logs | grep -iE "error|fail|exception" | tail -50

# Specific deployment
railway logs --deployment <deployment-id>
```

---

### Cron Job Status

```bash
hermes cronjob list
```

**Expected:**
```
CSE 403 Monitor      | every 30m | active | last run: <timestamp>
Gmail Reply Tracker  | every 15m | active | last run: <timestamp>
```

**If "inactive":**
```bash
hermes cronjob run <job-id>
```

---

## Safety Rules

### Rule 1: Never Force Push to main

**Except:** Emergency rollback with explicit user confirmation

**Reason:** Force push rewrite history → teammate confused

---

### Rule 2: Always Build Before Push

**Command:** `npm run build`

**Reason:** Catch TypeScript errors sebelum deploy

---

### Rule 3: Duplicate Route Check

**Command:** `grep -n "fastify.get\|fastify.post" src/index.ts | sort | uniq -d`

**Reason:** Fastify crash if duplicate route

---

### Rule 4: Test Auth Flow Post-Deploy

**Script:** Python test script diatas

**Reason:** Auth is critical path — ensure tidak rusak

---

### Rule 5: Check Railway Status After Deploy

**Command:** `railway status`

**Reason:** Pastikan deployment "● Online", bukan "● Crashed"

---

## Rollback Decision Tree

```
Deploy crashed?
│
├─ YES → Is it critical (auth/API down)?
│         │
│         ├─ YES → Immediate rollback:
│         │         1. git revert <commit>
│         │         2. git push
│         │         3. Verify rollback success
│         │         4. Investigate root cause
│         │
│         └─ NO → Debug first:
│                   1. railway logs --deployment <id>
│                   2. Identify error
│                   3. Fix + push (slower recovery)
│
└─ NO → Continue normal workflow
```

---

## Contact & Escalation

**If deployment blocked >30 menit:**
1. Check Railway status page: https://status.railway.app
2. Check Google Cloud status (CSE, OAuth): https://status.cloud.google.com
3. Escalate ke project lead dengan error logs

---

## References

- Railway CLI docs: https://docs.railway.app/develop/cli
- Prisma migration docs: https://www.prisma.io/docs/concepts/components/prisma-migrate
- Fastify error codes: https://fastify.dev/docs/latest/Reference/Errors/

---

**END OF DOCUMENT**
