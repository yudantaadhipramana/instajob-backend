import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';

const prisma = new PrismaClient();

interface RegisterBody {
  email: string;
  password: string;
  fullName?: string;
}

interface LoginBody {
  email: string;
  password: string;
}

const RegisterBodySchema = z.object({
  email: z.string().email({ message: "Invalid email format" }),
  password: z.string().min(6, { message: "Password must be at least 6 characters" }).max(72, { message: "Password is too long" }),
  fullName: z.string().min(1, { message: "Full name is required" }).max(100).optional(),
});

const LoginBodySchema = z.object({
  email: z.string().email({ message: "Invalid email format" }),
  password: z.string().min(1, { message: "Password is required" }),
});

export async function authRoutes(fastify: FastifyInstance) {
  // Register
  fastify.post('/api/auth/register', async (req: FastifyRequest<{ Body: RegisterBody }>, reply: FastifyReply) => {
    try {
      const validationResult = RegisterBodySchema.safeParse(req.body);
      if (validationResult.success === false) {
        const errors = validationResult.error.issues.map(e => e.message).join(', ');
        return reply.code(400).send({ error: errors });
      }
      const { email, password, fullName } = validationResult.data;

      // Cek email sudah terdaftar
      const existing = await prisma.user.findUnique({ where: { email } });
      if (existing) {
        return reply.code(409).send({ error: 'Email already registered' });
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 10);

      // Buat user
      const user = await prisma.user.create({
        data: {
          email,
          passwordHash,
          fullName: fullName || email.split('@')[0],
          referralCode: 'REF_' + Date.now().toString(36).toUpperCase()
        }
      });

      // Generate JWT token
      const token = fastify.jwt.sign({ 
        userId: user.id, 
        email: user.email 
      });

      return reply.code(201).send({
        token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          subscriptionType: user.subscriptionType
        }
      });
    } catch (err) {
      console.error('Register error:', err);
      return reply.code(500).send({ error: 'Registration failed' });
    }
  });

  // Login
  fastify.post('/api/auth/login', async (req: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) => {
    try {
      const validationResult = LoginBodySchema.safeParse(req.body);
      if (validationResult.success === false) {
        const errors = validationResult.error.issues.map(e => e.message).join(', ');
        return reply.code(400).send({ error: errors });
      }
      const { email, password } = validationResult.data;

      // Cari user
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) {
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      // Verify password
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        return reply.code(401).send({ error: 'Invalid credentials' });
      }

      // Generate token
      const token = fastify.jwt.sign({ 
        userId: user.id, 
        email: user.email 
      });

      return reply.send({
        token,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          subscriptionType: user.subscriptionType
        }
      });
    } catch (err) {
      console.error('Login error:', err);
      return reply.code(500).send({ error: 'Login failed' });
    }
  });

  // Verify token (untuk testing)
  fastify.get('/api/auth/me', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      await req.jwtVerify();
      const decoded = req.user as any;

      const user = await prisma.user.findUnique({ 
        where: { id: decoded.userId },
        include: { profile: true }
      });

      if (!user) {
        return reply.code(404).send({ error: 'User not found' });
      }

      return reply.send({
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        subscriptionType: user.subscriptionType,
        profile: user.profile
      });
    } catch (err) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  // Google Sign-In (credential from @react-oauth/google)
  fastify.post('/api/auth/google', async (req: any, reply: any) => {
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
      const token = (fastify as any).jwt.sign({ userId: user.id, email: user.email });
      return reply.send({ token, user: { id: user.id, email: user.email, fullName: user.fullName, subscriptionType: user.subscriptionType } });
    } catch (err: any) {
      console.error('Google auth error:', err);
      return reply.code(401).send({ error: 'Google authentication failed' });
    }
  });
  // end authRoutes
}
