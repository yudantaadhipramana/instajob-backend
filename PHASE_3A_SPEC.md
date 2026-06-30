# PHASE 3A: ENDPOINTS SPECIFICATION (InstaJob Bot Ecosystem)

## Overview
Phase 3A implements 30+ REST API endpoints untuk bot management, job discovery, subscription handling, dan fleet orchestration.

---

## DATABASE SCHEMA UPDATES

### New Models Required:

#### 1. BotProfile
- botId (String, unique, primary)
- botName (String)
- telegramBotToken (String, encrypted)
- botStatus (ACTIVE | INACTIVE | SUSPENDED)
- ownerUserId (String, FK to User)
- createdAt (DateTime)
- updatedAt (DateTime)
- lastHeartbeat (DateTime)

#### 2. BotFleet
- fleetId (String, unique, primary)
- fleetName (String)
- description (String?)
- ownerUserId (String, FK to User)
- bots (BotProfile[], relation)
- createdAt (DateTime)
- updatedAt (DateTime)

#### 3. SubscriptionToken
- tokenId (String, unique, primary)
- userId (String, FK to User)
- tokenHash (String, encrypted)
- scopes (String[]) - ["job_discovery", "bot_control", "analytics"]
- expiresAt (DateTime)
- isRevoked (Boolean)
- createdAt (DateTime)
- revokedAt (DateTime?)

#### 4. JobBatch
- batchId (String, unique, primary)
- botId (String, FK to BotProfile)
- userId (String, FK to User)
- jobIds (String[]) - array of job IDs from Job model
- status (PENDING | PROCESSING | COMPLETED | FAILED)
- createdAt (DateTime)
- completedAt (DateTime?)

#### 5. BotAnalytics
- analyticsId (String, unique, primary)
- botId (String, FK to BotProfile)
- date (DateTime)
- jobsDiscovered (Int)
- jobsApplied (Int)
- successRate (Float) - 0-1
- averageTimePerJob (Int) - milliseconds

---

## API ENDPOINTS (30+)

### BOT MANAGEMENT (8 endpoints)

**1. POST /api/bots/create**
- Create new bot profile
- Request: { botName, telegramBotToken }
- Response: { botId, botName, botStatus, createdAt }

**2. GET /api/bots/list**
- List all bots for authenticated user
- Query: ?page=1&limit=20
- Response: { bots: BotProfile[], total, hasMore }

**3. GET /api/bots/:botId**
- Get bot profile details
- Response: BotProfile + lastHeartbeat + fleet info

**4. PATCH /api/bots/:botId/update**
- Update bot profile
- Request: { botName?, botStatus? }
- Response: BotProfile (updated)

**5. DELETE /api/bots/:botId**
- Delete bot (soft delete, mark SUSPENDED)
- Response: { success, message }

**6. POST /api/bots/:botId/heartbeat**
- Record bot heartbeat
- Request: { timestamp }
- Response: { status: "ok", nextCheckIn }

**7. POST /api/bots/:botId/status**
- Set bot status (ACTIVE, INACTIVE, SUSPENDED)
- Request: { status, reason? }
- Response: { botId, status, timestamp }

**8. GET /api/bots/:botId/analytics**
- Get bot performance analytics
- Query: ?startDate=2026-06-01&endDate=2026-06-30
- Response: { botId, totalJobs, successRate, avgTime }

---

### FLEET MANAGEMENT (6 endpoints)

**9. POST /api/fleets/create**
- Create bot fleet
- Request: { fleetName, description? }
- Response: { fleetId, fleetName, ownerUserId, createdAt }

**10. GET /api/fleets/list**
- List all fleets for user
- Response: { fleets: BotFleet[], total }

**11. PATCH /api/fleets/:fleetId/update**
- Update fleet info
- Request: { fleetName?, description? }
- Response: BotFleet (updated)

**12. POST /api/fleets/:fleetId/add-bot**
- Add bot to fleet
- Request: { botId }
- Response: { fleetId, botCount, bots }

**13. DELETE /api/fleets/:fleetId/remove-bot**
- Remove bot from fleet
- Request: { botId }
- Response: { fleetId, botCount, bots }

**14. DELETE /api/fleets/:fleetId**
- Delete fleet (only if empty)
- Response: { success, message }

---

### SUBSCRIPTION & TOKEN MANAGEMENT (6 endpoints)

**15. POST /api/tokens/create**
- Create subscription token (7-day JWT)
- Request: { scopes: ["job_discovery", "bot_control"] }
- Response: { token, expiresAt, scopes }

**16. GET /api/tokens/list**
- List active tokens for user
- Response: { tokens: SubscriptionToken[], total }

**17. POST /api/tokens/:tokenId/validate**
- Validate token (check expiry, scope, revoke status)
- Request: { token }
- Response: { valid: boolean, scopes, expiresAt }

**18. POST /api/tokens/:tokenId/revoke**
- Revoke token immediately
- Response: { success, message, revokedAt }

**19. POST /api/tokens/:tokenId/refresh**
- Refresh token (extend 7 days)
- Response: { token, expiresAt }

**20. DELETE /api/tokens/:tokenId**
- Delete token record
- Response: { success, message }

---

### JOB DISCOVERY & BATCH (7 endpoints)

**21. POST /api/jobs/discover**
- Discover jobs matching user preferences
- Request: { keywords, locations, salaryMin?, salaryMax? }
- Response: { jobs: Job[], count, timestamp }

**22. POST /api/jobs/batch-apply**
- Apply bot to multiple jobs in batch
- Request: { botId, jobIds: [id1, id2, ...], autoApply: true }
- Response: { batchId, status, jobCount, createdAt }

**23. GET /api/jobs/batches/:batchId**
- Get batch status & results
- Response: { batchId, status, jobIds, successCount, failedCount }

**24. GET /api/jobs/batches/bot/:botId**
- List all batches for bot
- Query: ?status=COMPLETED&limit=20
- Response: { batches: JobBatch[], total }

**25. POST /api/jobs/search**
- Advanced job search with filters
- Request: { query, filters: { industry, level, type } }
- Response: { jobs: Job[], count, facets }

**26. GET /api/jobs/:jobId/details**
- Get detailed job info
- Response: Job + relatedJobs + applicationHistory

**27. POST /api/jobs/:jobId/save**
- Save job for later (add to SavedJob)
- Response: { jobId, savedAt }

---

### ANALYTICS & REPORTING (3 endpoints)

**28. GET /api/analytics/dashboard**
- Get aggregated bot analytics
- Query: ?period=7days|30days|all
- Response: { totalBots, totalJobs, successRate, trends }

**29. GET /api/analytics/bot/:botId/report**
- Generate detailed bot report
- Query: ?startDate=2026-06-01&endDate=2026-06-30&format=json|csv
- Response: { botId, metrics, timeline, export }

**30. POST /api/analytics/export**
- Export analytics data
- Request: { format: "csv"|"json", dateRange }
- Response: { downloadUrl, expiresIn }

---

## AUTHENTICATION & AUTHORIZATION

All endpoints require:
- JWT token in Authorization header
- Scopes validation (bot_control, job_discovery, analytics)
- Rate limiting: 100 req/min per user

---

## ERROR HANDLING

Standard error responses:
```json
{
  "error": "Error type",
  "message": "Human readable message",
  "statusCode": 400,
  "timestamp": "2026-06-30T07:35:35.901Z",
  "details": {}
}
```

---

## PHASE 3A IMPLEMENTATION ORDER

1. **Week 1:** Database schema + BotProfile, BotFleet models
2. **Week 2:** Bot management endpoints (1-8)
3. **Week 3:** Fleet + Token endpoints (9-20)
4. **Week 4:** Job discovery + Analytics endpoints (21-30)

---

## DEPENDENCIES

- Prisma ORM (schema migration)
- JWT for token generation/validation
- Redis for rate limiting
- PostgreSQL 13 (Railway)

---

## TESTING STRATEGY

- Jest unit tests for each endpoint
- Integration tests with PostgreSQL
- E2E tests with full flow
- Load testing for batch operations

---

**Status:** Phase 3A spec complete. Ready for implementation.
**Next:** Prisma schema migration + database model creation.
