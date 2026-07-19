import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { authRateLimit } from './middleware/security';

const prisma = new PrismaClient();

interface RegisterBody { email: string; password: string; fullName?: string; }
interface LoginBody { email: string; password: string; }

const RegisterBodySchema = z.object({
  email: z.string().email({ message: "Invalid email format" }),
  password: z.string().min(6, { message: "Password must be at least 6 characters" }).max(72, { message: "Password is too long" }),
  fullName: z.string().min(1, { message: "Full name is required" }).max(100).optional(),
});

const LoginBodySchema = z.object({
  email: z.string().email({ message: "Invalid email format" }),
  password: z.string().min(1, { message: "Password is required" }),
});

/** HaveIBeenPwned k-anonymity check — returns true if password appears in breach DB */
async function isPasswordPwned(password: string): Promise<boolean> {
  try {
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { 'Add-Padding': 'true' }
    });
    if (!res.ok) return false; // fail open — don't block on HIBP downtime
    const text = await res.text();
    return text.split('\r\n').some(line => line.split(':')[0] === suffix);
  } catch {
    return false; // fail open
  }
}

/** Set JWT as HTTP-only cookie + return token in body (dual-mode for compat) */
function sendAuthResponse(fastify: FastifyInstance, reply: FastifyReply, user: any) {
  const token = (fastify as any).jwt.sign({ userId: user.id, email: user.email });
  const isProd = process.env.NODE_ENV === 'production';

  reply.setCookie('token', token, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
  });

  return reply.send({
    token, // keep for clients still using localStorage
    user: { id: user.id, email: user.email, fullName: user.fullName, subscriptionType: user.subscriptionType }
  });
}

export async function authRoutes(fastify: FastifyInstance) {
  // Register
  fastify.post('/api/auth/register', { config: { rateLimit: authRateLimit } }, async (req: FastifyRequest<{ Body: RegisterBody }>, reply: FastifyReply) => {
    try {
      const v = RegisterBodySchema.safeParse(req.body);
      if (!v.success) return reply.code(400).send({ error: v.error.issues.map(e => e.message).join(', ') });
      const { email, password, fullName } = v.data;

      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) return reply.code(409).send({ error: 'Email already registered' });

      // HaveIBeenPwned check
      const pwned = await isPasswordPwned(password);
      if (pwned) return reply.code(400).send({ error: 'Password found in known data breaches. Please choose a different password.' });

      const passwordHash = await bcrypt.hash(password, 10);
      const user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          fullName: fullName || email.split('@')[0],
          referralCode: 'REF_' + Date.now().toString(36).toUpperCase()
        }
      });

      return sendAuthResponse(fastify, reply.code(201), user);
    } catch (err) {
      console.error('Register error:', err);
      return reply.code(500).send({ error: 'Registration failed' });
    }
  });

  // Login
  fastify.post('/api/auth/login', { config: { rateLimit: authRateLimit } }, async (req: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) => {
    try {
      const v = LoginBodySchema.safeParse(req.body);
      if (!v.success) return reply.code(400).send({ error: v.error.issues.map(e => e.message).join(', ') });
      const { email, password } = v.data;

      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) return reply.code(401).send({ error: 'Invalid credentials' });

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) return reply.code(401).send({ error: 'Invalid credentials' });

      return sendAuthResponse(fastify, reply, user);
    } catch (err) {
      console.error('Login error:', err);
      return reply.code(500).send({ error: 'Login failed' });
    }
  });

  // Logout — clear cookie
  fastify.post('/api/auth/logout', async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.clearCookie('token', { path: '/' });
    return reply.send({ success: true });
  });

  // Verify token
  fastify.get('/api/auth/me', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
      const decoded = req.user as any;
      const user = await prisma.user.findUnique({ where: { id: decoded.userId }, include: { profile: true } });
      if (!user) return reply.code(404).send({ error: 'User not found' });
      return reply.send({ id: user.id, email: user.email, fullName: user.fullName, subscriptionType: user.subscriptionType, profile: user.profile });
    } catch {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  // Google Sign-In
  fastify.post('/api/auth/google', { config: { rateLimit: authRateLimit } }, async (req: any, reply: any) => {
    try {
      const { credential } = req.body as { credential: string };
      if (!credential) return reply.code(400).send({ error: 'credential required' });
      const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
      const ticket = await client.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
      const payload = ticket.getPayload();
      if (!payload?.email) return reply.code(400).send({ error: 'Invalid Google token' });
      let user = await prisma.user.findUnique({ where: { email: payload.email } });
      if (!user) {
        user = await prisma.user.create({
          data: {
            email: payload.email,
            passwordHash: await bcrypt.hash(payload.sub!, 10),
            fullName: payload.name || payload.email.split('@')[0],
            referralCode: 'REF_' + Date.now().toString(36).toUpperCase()
          }
        });
      }
      return sendAuthResponse(fastify, reply, user);
    } catch (err: any) {
      console.error('Google auth error:', err);
      return reply.code(401).send({ error: 'Google authentication failed' });
    }
  });
}
