/**
 * jobScoutWaterfall.ts
 * 3-Layer Scout Engine (waterfall fallback):
 *   Layer 3 — Local Parser  : DB cache check (zero cost)
 *   Layer 1 — CSE Free      : Google Custom Search API (free, 100 req/day)
 *   Layer 4 — CSE Paid      : Google CSE paid (last resort)
 * 
 * NOTE: Layer 2 DDGS disabled — endpoint unreliable/rate-limited
 */

import axios from 'axios';
import { PrismaClient } from '@prisma/client';
import { checkScoutCache, updateScoutCache, recordScoutRun } from './scoutCacheService';
import { parseATSJob, isATSUrl } from './atsParserService';

const prisma = new PrismaClient();

// ─── Circuit Breaker State (in-memory, per-process) ─────────────────────────
// DDGS disabled — not used in main waterfall, but kept for layer2_ddgs_retry backup
let ddgsFailCount = 0;
let ddgsCooldownUntil = 0;
const DDGS_MAX_FAIL = 3;
const DDGS_COOLDOWN_MS = 30 * 60 * 1000; // 30 min

// ─── Email Extractor ─────────────────────────────────────────────────────────
const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

function extractEmails(text: string): string[] {
  if (!text) return [];
  const found = text.match(EMAIL_RE) || [];
  // Filter obvious false positives (example.com, sentry, etc.)
  return found.filter(e =>
    !e.includes('example') &&
    !e.includes('sentry') &&
    !e.includes('noreply') &&
    !e.includes('no-reply') &&
    !e.includes('github') &&
    !e.endsWith('.png') &&
    !e.endsWith('.jpg')
  );
}

// ─── Shared upsert helper ─────────────────────────────────────────────────────
interface ScoutedJob {
  title: string;
  company: string;
  location: string;
  description: string;
  sourceUrl?: string;
  recruiterEmail?: string;
  remote?: boolean;
  salaryMin?: number;
  salaryMax?: number;
  industry?: string;
  tags?: string[];
  postedAt?: Date;
}

async function upsertJob(j: ScoutedJob): Promise<boolean> {
  const existing = await prisma.job.findFirst({
    where: { title: j.title, company: j.company },
  });
  if (existing) {
    // Update recruiterEmail if newly found
    if (!existing.recruiterEmail && j.recruiterEmail) {
      await prisma.job.update({
        where: { id: existing.id },
        data: { recruiterEmail: j.recruiterEmail },
      });
    }
    return false; // not new
  }
  
  // Try to parse ATS URL if available
  let parsedData: any = null;
  if (j.sourceUrl && isATSUrl(j.sourceUrl)) {
    parsedData = await parseATSJob(j.sourceUrl);
    if (parsedData) {
      // Merge parsed data with scraped data (parsed has priority)
      j = { ...j, ...parsedData };
    }
  }
  
  await prisma.job.create({
    data: {
      title: j.title,
      company: j.company,
      location: j.location || 'Indonesia',
      description: j.description?.slice(0, 2000) || '',
      sourceUrl: j.sourceUrl || null,
      recruiterEmail: j.recruiterEmail || null,
      remote: j.remote ?? false,
      salaryMin: j.salaryMin ?? null,
      salaryMax: j.salaryMax ?? null,
      industry: j.industry || null,
      tags: JSON.stringify(j.tags || []),
      postedAt: j.postedAt || new Date(),
      postedDate: j.postedAt || new Date(),
    },
  });
  return true;
}

// ─── Layer 3: Local Parser ────────────────────────────────────────────────────
// Check if query already has fresh results in DB (< 6 hours old)
async function layer3_localCheck(query: string): Promise<boolean> {
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const count = await prisma.job.count({
    where: {
      postedAt: { gte: since },
      OR: [
        { title: { contains: query.split(' ')[0], mode: 'insensitive' } },
        { description: { contains: query.split(' ')[0], mode: 'insensitive' } },
      ],
    },
  });
  return count > 0;
}

// ─── Layer 1: Google CSE Free ────────────────────────────────────────────────
async function layer1_cse(query: string, limit = 10): Promise<number> {
  const apiKey = process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_CX;
  if (!apiKey || !cx) return 0;

  const q = `${query} lowongan kerja HRD email`;
  const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(q)}&num=${Math.min(limit, 10)}`;

  const { data } = await axios.get(url, { timeout: 10000 });
  const items: any[] = data.items || [];
  let inserted = 0;
  for (const item of items) {
    const snippet = (item.snippet || '') + ' ' + (item.title || '');
    const emails = extractEmails(snippet);
    const ok = await upsertJob({
      title: item.title || query,
      company: item.displayLink || 'Unknown',
      location: 'Indonesia',
      description: item.snippet || '',
      sourceUrl: item.link,
      recruiterEmail: emails[0],
    });
    if (ok) inserted++;
  }
  return inserted;
}

// ─── Layer 2: DDGS Primary ───────────────────────────────────────────────────
// DISABLED — DuckDuckGo HTML endpoint unreliable/rate-limited
// Fallback to CSE Layer 1 + Layer 4 instead
async function layer2_ddgs(query: string, limit = 10): Promise<number> {
  console.log(`[Scout L2-DDGS] DISABLED — skipped`);
  return 0;
}

// ─── Layer 2 Alternative: DDGS via Axios with proper headers (experimental) ──
// NOTE: Kept for future resurrection if DDG endpoint becomes stable
async function layer2_ddgs_retry(query: string, limit = 10): Promise<number> {
  const now = Date.now();
  if (ddgsCooldownUntil > now) {
    console.log(`[Scout DDGS-Retry] cooldown active, skip`);
    return 0;
  }

  const retries = [1000, 3000, 8000, 15000];
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Accept-Encoding': 'gzip, deflate',
    'DNT': '1',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Referer': 'https://duckduckgo.com/',
    'Cache-Control': 'max-age=0',
  };

  for (let attempt = 0; attempt < retries.length; attempt++) {
    try {
      // Random delay to avoid rate-limit
      const delayMs = Math.random() * 500;
      await new Promise(r => setTimeout(r, delayMs));

      const q = encodeURIComponent(`${query} lowongan kerja email HRD site:*.id OR site:linkedin.com`);
      const { data } = await axios.get(
        `https://html.duckduckgo.com/html/?q=${q}&t=h_&ia=web`,
        {
          timeout: retries[attempt],
          headers,
          maxRedirects: 5,
          validateStatus: () => true, // Accept any status
        }
      );

      if (!data || data.length < 100) {
        throw new Error(`Empty response from DDG (${data?.length || 0} bytes)`);
      }

      // Extract results from DDG HTML (simple regex — no Cheerio dependency)
      const titleRe = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

      const titles: { url: string; title: string }[] = [];
      let m;
      while ((m = titleRe.exec(data)) !== null) {
        titles.push({ url: m[1], title: m[2].trim().replace(/<[^>]+>/g, '') });
        if (titles.length >= limit) break;
      }

      const snippets: string[] = [];
      while ((m = snippetRe.exec(data)) !== null) {
        snippets.push(m[1].trim().replace(/<[^>]+>/g, ' '));
      }

      if (titles.length === 0) {
        throw new Error('No results extracted from DDG HTML');
      }

      ddgsFailCount = 0; // reset on success

      let inserted = 0;
      for (let i = 0; i < titles.length; i++) {
        const snip = snippets[i] || '';
        const emails = extractEmails(snip);
        const ok = await upsertJob({
          title: titles[i].title || query,
          company: new URL(titles[i].url.startsWith('http') ? titles[i].url : 'https://example.com').hostname || 'Unknown',
          location: 'Indonesia',
          description: snip,
          sourceUrl: titles[i].url,
          recruiterEmail: emails[0],
        });
        if (ok) inserted++;
      }
      
      console.log(`[Scout DDGS-Retry] success: ${titles.length} results, ${inserted} inserted`);
      return inserted;
    } catch (err: any) {
      console.warn(`[Scout DDGS-Retry] attempt ${attempt + 1}/${retries.length} failed: ${err.message}`);
      if (attempt < retries.length - 1) {
        await new Promise(r => setTimeout(r, retries[attempt]));
      }
    }
  }

  // All retries failed → circuit breaker
  ddgsFailCount++;
  if (ddgsFailCount >= DDGS_MAX_FAIL) {
    ddgsCooldownUntil = Date.now() + DDGS_COOLDOWN_MS;
    console.warn(`[Scout DDGS-Retry] circuit breaker open, cooldown 30min`);
    ddgsFailCount = 0;
  }
  return 0;
}

// ─── Layer 4: Google CSE Paid ─────────────────────────────────────────────────
async function layer4_csePaid(query: string, limit = 10): Promise<number> {
  const apiKey = process.env.GOOGLE_CSE_PAID_API_KEY || process.env.GOOGLE_CSE_API_KEY;
  const cx = process.env.GOOGLE_CSE_PAID_CX || process.env.GOOGLE_CSE_CX;
  if (!apiKey || !cx) return 0;

  // Same as layer1 but with paid quota — targeted email harvest query
  const q = `${query} rekrutmen "kirim lamaran" "email" HRD`;
  const url = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=${encodeURIComponent(q)}&num=${Math.min(limit, 10)}`;

  try {
    const { data } = await axios.get(url, { timeout: 10000 });
    const items: any[] = data.items || [];
    let inserted = 0;
    for (const item of items) {
      const snippet = (item.snippet || '') + ' ' + (item.title || '');
      const emails = extractEmails(snippet);
      const ok = await upsertJob({
        title: item.title || query,
        company: item.displayLink || 'Unknown',
        location: 'Indonesia',
        description: item.snippet || '',
        sourceUrl: item.link,
        recruiterEmail: emails[0],
      });
      if (ok) inserted++;
    }
    return inserted;
  } catch (err: any) {
    console.warn(`[Scout CSE Paid] failed: ${err.message}`);
    return 0;
  }
}

// ─── Main Waterfall ───────────────────────────────────────────────────────────
export async function scoutJobsWaterfall(query: string, limit = 10, params?: { role: string; location: string; workType?: string }): Promise<number> {
  const startTime = Date.now();
  let total = 0;

  // ─── Query Dedup Check (ScoutCache) ────────────────────────────────────────
  if (params) {
    const { needsScan, cacheEntry } = await checkScoutCache(params);
    if (!needsScan) {
      console.log(`[Scout Cache HIT] '${query}' scanned ${Math.round((Date.now() - cacheEntry.lastScannedAt.getTime()) / 1000 / 60)}min ago, skip`);
      return cacheEntry.resultCount;
    }
  }

  // Layer 3: Local check — skip if fresh data exists
  const hasFresh = await layer3_localCheck(query);
  if (hasFresh) {
    console.log(`[Scout L3] '${query}' fresh in DB, skip`);
    if (params) await updateScoutCache(params, 0);
    return 0;
  }

  // Layer 1: CSE Free
  try {
    const n = await layer1_cse(query, limit);
    total += n;
    console.log(`[Scout L1-CSE] '${query}' → ${n} inserted`);
    await recordScoutRun({ query, layer: 'L1-CSE', jobsFound: n, jobsInserted: n, success: true, durationMs: Date.now() - startTime });
  } catch (err: any) {
    console.warn(`[Scout L1-CSE] failed: ${err.message}`);
    await recordScoutRun({ query, layer: 'L1-CSE', jobsFound: 0, jobsInserted: 0, success: false, errorMessage: err.message, durationMs: Date.now() - startTime });
  }

  // Layer 4: CSE Paid — only if L1 returned 0 (L2 DDGS experimental retry enabled)
  // NOTE: L2 DDGS retry will be attempted, but expected to fail due to DDG rate-limiting
  const startL2 = Date.now();
  try {
    const n = await layer2_ddgs_retry(query, limit);
    total += n;
    console.log(`[Scout L2-DDGS-Retry] '${query}' → ${n} inserted`);
    await recordScoutRun({ query, layer: 'L2-DDGS-Retry', jobsFound: n, jobsInserted: n, success: n > 0, durationMs: Date.now() - startL2 });
  } catch (err: any) {
    console.error(`[Scout L2-DDGS-Retry] error:`, err.message);
    await recordScoutRun({ query, layer: 'L2-DDGS-Retry', jobsFound: 0, jobsInserted: 0, success: false, errorMessage: err.message, durationMs: Date.now() - startL2 });
  }

  // Layer 4: CSE Paid — only if L1+L2 returned 0
  if (total === 0) {
    try {
      const n = await layer4_csePaid(query, limit);
      total += n;
      console.log(`[Scout L4-CSEPaid] '${query}' → ${n} inserted`);
      await recordScoutRun({ query, layer: 'L4-CSEPaid', jobsFound: n, jobsInserted: n, success: true, durationMs: Date.now() - startTime });
    } catch (err: any) {
      console.warn(`[Scout L4-CSEPaid] failed: ${err.message}`);
      await recordScoutRun({ query, layer: 'L4-CSEPaid', jobsFound: 0, jobsInserted: 0, success: false, errorMessage: err.message, durationMs: Date.now() - startTime });
    }
  }

  // Update cache with result count
  if (params) {
    await updateScoutCache(params, total);
  }

  return total;
}

// Keep backward compat — cron still calls scoutJobsFromRemotive as fallback
export { scoutJobsWaterfall as default, layer2_ddgs_retry };
