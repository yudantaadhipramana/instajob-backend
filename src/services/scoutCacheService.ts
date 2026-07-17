/**
 * scoutCacheService.ts
 * Query deduplication layer — prevents 10,000 users with identical filters from triggering 10,000 searches.
 * Hash (role+location+workType) → check ScoutCache → if last scan < 24h, skip search (return cached count).
 */

import * as crypto from 'crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CACHE_TTL_HOURS = 24;

interface QueryParams {
  role: string;
  location: string;
  workType?: string; // remote/onsite/hybrid/any
}

/**
 * Normalize + hash query params → unique roleHash
 */
function hashQuery(params: QueryParams): string {
  const normalized = {
    role: params.role.trim().toLowerCase(),
    location: params.location.trim().toLowerCase(),
    workType: (params.workType || 'any').trim().toLowerCase(),
  };
  const key = `${normalized.role}|${normalized.location}|${normalized.workType}`;
  return crypto.createHash('sha256').update(key).digest('hex');
}

/**
 * Check if query needs scanning (cache miss or expired)
 * Returns: { needsScan: boolean, cacheEntry: ScoutCache | null }
 */
export async function checkScoutCache(params: QueryParams): Promise<{ needsScan: boolean; cacheEntry: any | null }> {
  const roleHash = hashQuery(params);
  const entry = await prisma.scoutCache.findUnique({ where: { roleHash } });

  if (!entry) {
    return { needsScan: true, cacheEntry: null };
  }

  const age = Date.now() - entry.lastScannedAt.getTime();
  const needsScan = age > CACHE_TTL_HOURS * 60 * 60 * 1000;

  return { needsScan, cacheEntry: entry };
}

/**
 * Update ScoutCache after waterfall scan
 */
export async function updateScoutCache(params: QueryParams, resultCount: number): Promise<void> {
  const roleHash = hashQuery(params);
  await prisma.scoutCache.upsert({
    where: { roleHash },
    create: {
      roleHash,
      role: params.role.trim(),
      location: params.location.trim(),
      workType: params.workType || 'any',
      lastScannedAt: new Date(),
      resultCount,
    },
    update: {
      lastScannedAt: new Date(),
      resultCount,
    },
  });
}

/**
 * Record ScoutRun metadata (observability)
 */
export async function recordScoutRun(data: {
  query: string;
  layer: string;
  jobsFound: number;
  jobsInserted: number;
  success: boolean;
  errorMessage?: string;
  durationMs?: number;
}): Promise<void> {
  await prisma.scoutRun.create({
    data: {
      ...data,
      finishedAt: new Date(),
    },
  });
}
