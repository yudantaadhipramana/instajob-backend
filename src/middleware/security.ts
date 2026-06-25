import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import rateLimit from '@fastify/rate-limit';

// ── 1. Rate Limiting ──────────────────────────────────────────────
// ponytail: per-IP rate limit only. Add Redis store + per-user limits when using >1 instance.
export async function registerRateLimit(fastify: FastifyInstance) {
  await fastify.register(rateLimit, {
    max: 120,            // 120 req/min global default
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, ctx) => ({
      error: 'Too many requests',
      statusCode: 429,
      retryAfter: Math.ceil(ctx.ttl / 1000),
    }),
    keyGenerator: (req) => req.ip || req.socket.remoteAddress || 'unknown',
  });
}

// Stricter limiter for auth endpoints (brute-force protection)
export const authRateLimit = {
  max: 10,
  timeWindow: '1 minute',
  keyGenerator: (req: FastifyRequest) => req.ip || req.socket.remoteAddress || 'unknown',
};

// ── 2. Input Validation Helpers ───────────────────────────────────
// Generic body validator — lightweight JSON Schema approach via Fastify's built-in.
// Ponytail: migrate to per-route `schema` for full 422 detail when needed.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_STRING_LEN = 5000;   // sane max for any string field
const MAX_ARRAY_LEN  = 200;
const UUID_RE        = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lightweight body sanitizer — strips null bytes, trims strings, enforces length. */
export function sanitizeBody(body: any): any {
  if (!body || typeof body !== 'object') return body;
  if (Array.isArray(body)) return body.map(sanitizeBody);

  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(body)) {
    if (typeof v === 'string') {
      // strip null bytes, trim, enforce length
      let s = v.replace(/\0/g, '').trim();
      if (s.length > MAX_STRING_LEN) s = s.slice(0, MAX_STRING_LEN);
      clean[k] = s;
    } else if (Array.isArray(v)) {
      clean[k] = v.length > MAX_ARRAY_LEN ? v.slice(0, MAX_ARRAY_LEN) : v;
    } else {
      clean[k] = v;
    }
  }
  return clean;
}

/** PreHandler hook: sanitize body for all POST/PUT/PATCH routes. */
export async function inputSanitizeHook(req: FastifyRequest, _reply: FastifyReply) {
  if (req.body && typeof req.body === 'object') {
    (req as any).body = sanitizeBody(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    // Sanitize query strings too
    const q = req.query as Record<string, any>;
    for (const [k, v] of Object.entries(q)) {
      if (typeof v === 'string' && v.length > 1000) {
        q[k] = v.slice(0, 1000);
      }
    }
  }
}

/** PreHandler hook: validate common auth-related fields. */
export async function authValidationHook(req: FastifyRequest, reply: FastifyReply) {
  const url = req.url;

  // Validate login/register bodies
  if (url === '/api/auth/register' || url === '/api/auth/login') {
    const { email, password } = (req.body as any) || {};
    if (!email || !password) {
      return reply.code(400).send({ error: 'Email and password are required' });
    }
    if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
      return reply.code(400).send({ error: 'Invalid email format' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return reply.code(400).send({ error: 'Password must be at least 6 characters' });
    }
    if (password.length > 128) {
      return reply.code(400).send({ error: 'Password too long' });
    }
  }

  // Validate UUID route params (e.g. /api/jobs/:id, /api/ai/match-score/:jobId)
  const uuidParamMatch = url.match(/\/:([a-zA-Z]+Id|id)\b/);
  if (uuidParamMatch) {
    const params = req.params as Record<string, any>;
    for (const val of Object.values(params)) {
      if (typeof val === 'string' && !UUID_RE.test(val) && val.length > 0) {
        return reply.code(400).send({ error: 'Invalid parameter format' });
      }
    }
  }
}

// ── 3. Security Headers ───────────────────────────────────────────
export async function securityHeadersHook(_req: FastifyRequest, reply: FastifyReply) {
  reply.header('X-Content-Type-Options', 'nosniff');
  reply.header('X-Frame-Options', 'DENY');
  reply.header('X-XSS-Protection', '1; mode=block');
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}
