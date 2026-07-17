/**
 * atsParserService.ts
 * Layer 3 Local Parser — extract job details from ATS platform URLs
 * Supports: Greenhouse, Ashby, Lever
 * 
 * Usage: When waterfall finds a job URL, parse it before upserting to extract:
 * - Title, company, location, description
 * - Apply URL, recruiter email (from page content)
 * - Remote/hybrid indicator
 */

import axios from 'axios';
import * as crypto from 'crypto';

// ─── URL Detection ─────────────────────────────────────────────────────────────

export function isGreenhouseUrl(url: string): boolean {
  return url.includes('greenhouse.io') || url.includes('boards.greenhouse.io');
}

export function isAshbyUrl(url: string): boolean {
  return url.includes('ashbyhq.com') || url.includes('jobs.ashbyhq.com');
}

export function isLeverUrl(url: string): boolean {
  return url.includes('lever.co') || url.includes('jobs.lever.co');
}

export function isATSUrl(url: string): boolean {
  return isGreenhouseUrl(url) || isAshbyUrl(url) || isLeverUrl(url);
}

// ─── Email Extractor ───────────────────────────────────────────────────────────

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;

function extractEmails(text: string): string[] {
  if (!text) return [];
  const found = text.match(EMAIL_RE) || [];
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

// ─── Job Data Interface ────────────────────────────────────────────────────────

export interface ParsedJob {
  title: string;
  company: string;
  location: string;
  description: string;
  sourceUrl: string;
  applyUrl?: string;
  recruiterEmail?: string;
  remote: boolean;
  salaryMin?: number;
  salaryMax?: number;
}

// ─── Greenhouse Parser ─────────────────────────────────────────────────────────

async function parseGreenhouse(url: string): Promise<ParsedJob | null> {
  try {
    const { data } = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; InstaJobBot/1.0)' },
    });

    // Greenhouse typically embeds JSON-LD structured data
    const jsonLdMatch = data.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (jsonLdMatch) {
      const jsonData = JSON.parse(jsonLdMatch[1]);
      if (jsonData['@type'] === 'JobPosting') {
        const location = jsonData.jobLocation?.address?.addressLocality || 'Remote';
        const remote = location.toLowerCase().includes('remote') || 
                       jsonData.jobLocation?.address?.addressRegion?.toLowerCase().includes('remote');
        
        return {
          title: jsonData.title || 'Unknown',
          company: jsonData.hiringOrganization?.name || new URL(url).hostname,
          location,
          description: jsonData.description?.slice(0, 2000) || '',
          sourceUrl: url,
          applyUrl: jsonData.directApply || url,
          recruiterEmail: extractEmails(data)[0],
          remote: remote || false,
          salaryMin: jsonData.baseSalary?.value?.minValue,
          salaryMax: jsonData.baseSalary?.value?.maxValue,
        };
      }
    }

    // Fallback: regex parsing if no JSON-LD
    const titleMatch = data.match(/<h1[^>]*class="app-title"[^>]*>([\s\S]*?)<\/h1>/);
    const companyMatch = data.match(/<span[^>]*class="company-name"[^>]*>([\s\S]*?)<\/span>/);
    const descMatch = data.match(/<div[^>]*id="content"[^>]*>([\s\S]*?)<\/div>/);

    if (titleMatch) {
      return {
        title: titleMatch[1].trim().replace(/<[^>]+>/g, ''),
        company: companyMatch ? companyMatch[1].trim() : new URL(url).hostname,
        location: 'Indonesia',
        description: descMatch ? descMatch[1].slice(0, 2000).replace(/<[^>]+>/g, ' ').trim() : '',
        sourceUrl: url,
        recruiterEmail: extractEmails(data)[0],
        remote: data.toLowerCase().includes('remote'),
      };
    }

    return null;
  } catch (err) {
    console.warn(`[ATS Greenhouse] parse failed: ${err}`);
    return null;
  }
}

// ─── Ashby Parser ──────────────────────────────────────────────────────────────

async function parseAshby(url: string): Promise<ParsedJob | null> {
  try {
    const { data } = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; InstaJobBot/1.0)' },
    });

    // Ashby typically has structured meta tags
    const titleMatch = data.match(/<meta property="og:title" content="(.*?)"/);
    const descMatch = data.match(/<meta property="og:description" content="(.*?)"/);
    const companyMatch = data.match(/<meta property="og:site_name" content="(.*?)"/);

    if (titleMatch) {
      return {
        title: titleMatch[1].trim(),
        company: companyMatch ? companyMatch[1].trim() : new URL(url).hostname,
        location: 'Indonesia',
        description: descMatch ? descMatch[1].slice(0, 2000) : '',
        sourceUrl: url,
        recruiterEmail: extractEmails(data)[0],
        remote: data.toLowerCase().includes('remote') || data.toLowerCase().includes('work from home'),
      };
    }

    return null;
  } catch (err) {
    console.warn(`[ATS Ashby] parse failed: ${err}`);
    return null;
  }
}

// ─── Lever Parser ──────────────────────────────────────────────────────────────

async function parseLever(url: string): Promise<ParsedJob | null> {
  try {
    const { data } = await axios.get(url, {
      timeout: 10000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; InstaJobBot/1.0)' },
    });

    // Lever has posting-headline, posting-categories, posting-description
    const titleMatch = data.match(/<h2[^>]*class="posting-headline"[^>]*>([\s\S]*?)<\/h2>/);
    const locationMatch = data.match(/<div[^>]*class="location"[^>]*>([\s\S]*?)<\/div>/);
    const descMatch = data.match(/<div[^>]*class="posting-description"[^>]*>([\s\S]*?)<\/div>/);
    const companyMatch = data.match(/<a[^>]*class="main-logo"[^>]*title="(.*?)"/);

    if (titleMatch) {
      const location = locationMatch ? locationMatch[1].trim().replace(/<[^>]+>/g, '') : 'Indonesia';
      return {
        title: titleMatch[1].trim().replace(/<[^>]+>/g, ''),
        company: companyMatch ? companyMatch[1].trim() : new URL(url).hostname,
        location,
        description: descMatch ? descMatch[1].slice(0, 2000).replace(/<[^>]+>/g, ' ').trim() : '',
        sourceUrl: url,
        applyUrl: url.replace('/jobs/', '/jobs/apply/'),
        recruiterEmail: extractEmails(data)[0],
        remote: location.toLowerCase().includes('remote') || data.toLowerCase().includes('remote'),
      };
    }

    return null;
  } catch (err) {
    console.warn(`[ATS Lever] parse failed: ${err}`);
    return null;
  }
}

// ─── Main Parse Function ───────────────────────────────────────────────────────

export async function parseATSJob(url: string): Promise<ParsedJob | null> {
  if (!isATSUrl(url)) {
    return null;
  }

  if (isGreenhouseUrl(url)) {
    return parseGreenhouse(url);
  }

  if (isAshbyUrl(url)) {
    return parseAshby(url);
  }

  if (isLeverUrl(url)) {
    return parseLever(url);
  }

  return null;
}

// ─── Batch Parse (for waterfall integration) ───────────────────────────────────

export async function parseATSJobsBatch(urls: string[]): Promise<ParsedJob[]> {
  const atsUrls = urls.filter(isATSUrl);
  const results = await Promise.allSettled(atsUrls.map(parseATSJob));
  
  return results
    .filter(r => r.status === 'fulfilled' && r.value !== null)
    .map(r => (r as PromiseFulfilledResult<ParsedJob>).value);
}
