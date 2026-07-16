/**
 * jobScoutWaterfall.ts
 * 4-Layer Scout Engine (waterfall fallback):
 *   Layer 3 — Local Parser  : DB cache check (zero cost)
 *   Layer 1 — CSE Free      : Google Custom Search API (free, 100 req/day)
 *   Layer 2 — DDGS Primary  : DuckDuckGo HTML search (free, circuit breaker)
 *   Layer 4 — CSE Paid      : Google CSE paid (last resort)
 */

import axios from 'axios';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─── Circuit Breaker State (in-memory, per-process) ─────────────────────────
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
async function layer2_ddgs(query: string, limit = 10): Promise<number> {
  const now = Date.now();
  if (ddgsCooldownUntil > now) {
    console.log(`[Scout DDGS] cooldown active, skip`);
    return 0;
  }

  const retries = [2000, 5000, 15000];
  for (let attempt = 0; attempt < retries.length; attempt++) {
    try {
      const q = encodeURIComponent(`${query} lowongan kerja email HRD site:*.id OR site:linkedin.com`);
      const { data } = await axios.get(
        `https://html.duckduckgo.com/html/?q=${q}`,
        {
          timeout: 12000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; InstaJobBot/1.0)',
            'Accept': 'text/html',
          },
        }
      );

      // Extract results from DDG HTML (simple regex — no Cheerio dependency)
      const titleRe = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
      const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([^<]+)<\/a>/g;

      const titles: { url: string; title: string }[] = [];
      let m;
      while ((m = titleRe.exec(data)) !== null) {
        titles.push({ url: m[1], title: m[2].trim() });
        if (titles.length >= limit) break;
      }

      const snippets: string[] = [];
      while ((m = snippetRe.exec(data)) !== null) {
        snippets.push(m[1].trim());
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
      return inserted;
    } catch (err: any) {
      console.warn(`[Scout DDGS] attempt ${attempt + 1} failed: ${err.message}`);
      if (attempt < retries.length - 1) {
        await new Promise(r => setTimeout(r, retries[attempt]));
      }
    }
  }

  // All retries failed → circuit breaker
  ddgsFailCount++;
  if (ddgsFailCount >= DDGS_MAX_FAIL) {
    ddgsCooldownUntil = Date.now() + DDGS_COOLDOWN_MS;
    console.warn(`[Scout DDGS] circuit breaker open, cooldown 30min`);
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
export async function scoutJobsWaterfall(query: string, limit = 10): Promise<number> {
  // Layer 3: Local check — skip if fresh data exists
  const hasFresh = await layer3_localCheck(query);
  if (hasFresh) {
    console.log(`[Scout L3] '${query}' fresh in DB, skip`);
    return 0;
  }

  let total = 0;

  // Layer 1: CSE Free
  try {
    const n = await layer1_cse(query, limit);
    total += n;
    console.log(`[Scout L1-CSE] '${query}' → ${n} inserted`);
  } catch (err: any) {
    console.warn(`[Scout L1-CSE] failed: ${err.message}`);
  }

  // Layer 2: DDGS (always try, independent of L1)
  try {
    const n = await layer2_ddgs(query, limit);
    total += n;
    console.log(`[Scout L2-DDGS] '${query}' → ${n} inserted`);
  } catch (err: any) {
    console.warn(`[Scout L2-DDGS] failed: ${err.message}`);
  }

  // Layer 4: CSE Paid — only if both L1+L2 returned 0
  if (total === 0) {
    try {
      const n = await layer4_csePaid(query, limit);
      total += n;
      console.log(`[Scout L4-CSEPaid] '${query}' → ${n} inserted`);
    } catch (err: any) {
      console.warn(`[Scout L4-CSEPaid] failed: ${err.message}`);
    }
  }

  return total;
}

// Keep backward compat — cron still calls scoutJobsFromRemotive as fallback
export { scoutJobsWaterfall as default };
