import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { OAuth2Client } from 'google-auth-library';
import { getOrCreateGoogleUser, findUserByEmail, createUser } from '../lib/db';
import * as bcrypt from 'bcrypt';

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

interface GoogleTokenPayload {
  email: string;
  name: string;
  picture?: string;
  email_verified?: boolean;
  sub: string;
}

interface LoginResponse {
  token: string;
  user: {
    id: string;
    email: string;
    fullName: string;
    googleId?: string;
    avatarUrl?: string;
  };
}

export async function googleAuthRoutes(fastify: FastifyInstance) {
  // Google OAuth endpoint
  fastify.post<{ Body: { token: string } }>(
    '/api/auth/google',
    async (request: FastifyRequest<{ Body: { token: string } }>, reply: FastifyReply) => {
      try {
        const { token } = request.body;
        
        console.log('Google auth request received:', {
          hasToken: !!token,
          tokenLength: token?.length,
          tokenPreview: token?.substring(0, 20) + '...',
        });

        if (!token) {
          return reply.code(400).send({ error: 'Token is required' });
        }

        const ticket = await client.verifyIdToken({
          idToken: token,
          audience: process.env.GOOGLE_CLIENT_ID,
        });

        const payload = ticket.getPayload() as GoogleTokenPayload;

        if (!payload?.email) {
          return reply.code(401).send({ error: 'Invalid token payload' });
        }

        const user = await getOrCreateGoogleUser({
          email: payload.email,
          fullName: payload.name,
          googleId: payload.sub,
          avatarUrl: payload.picture,
        });

        const jwtToken = (fastify as any).jwt.sign(
          {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
          },
          { expiresIn: '7d' }
        );

        return reply.code(200).send({
          token: jwtToken,
          user: {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
            googleId: user.googleId,
            avatarUrl: user.avatarUrl,
          },
        } as LoginResponse);
      } catch (error: any) {
        console.error('Google auth error:', {
          message: error?.message,
          code: error?.code,
          type: error?.constructor?.name,
          stack: error?.stack?.split('\n').slice(0, 3),
        });
        return reply.code(401).send({ 
          error: 'Authentication failed',
          details: error?.message || 'Unknown error'
        });
      }
    }
  );

  // Manual registration endpoint
  fastify.post<{ Body: { fullName: string; email: string; password: string } }>(
    '/api/auth/register',
    async (request: FastifyRequest<{ Body: { fullName: string; email: string; password: string } }>, reply: FastifyReply) => {
      try {
        const { fullName, email, password } = request.body;
        
        console.log('Registration request received:', { email, hasPassword: !!password });

        if (!fullName || !email || !password) {
          return reply.code(400).send({ message: 'All fields are required' });
        }

        // Check if user already exists
        const existingUser = await findUserByEmail(email);
        if (existingUser) {
          return reply.code(400).send({ message: 'Email already registered' });
        }

        // Hash password
        const saltRounds = 10;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Create user
        const user = await createUser({
          fullName,
          email,
          password: hashedPassword,
        });

        // Generate JWT token
        const jwtToken = (fastify as any).jwt.sign(
          {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
          },
          { expiresIn: '7d' }
        );

        return reply.code(201).send({
          token: jwtToken,
          user: {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
          },
        } as LoginResponse);
      } catch (error: any) {
        console.error('Registration error:', error);
        return reply.code(500).send({ message: 'Registration failed' });
      }
    }
  );

  // Login endpoint
  fastify.post<{ Body: { email: string; password: string } }>(
    '/api/auth/login',
    async (request: FastifyRequest<{ Body: { email: string; password: string } }>, reply: FastifyReply) => {
      try {
        const { email, password } = request.body;
        
        console.log('Login request received:', { email });

        if (!email || !password) {
          return reply.code(400).send({ message: 'Email and password are required' });
        }

        // Find user by email
        const user = await findUserByEmail(email);
        if (!user) {
          return reply.code(401).send({ message: 'Invalid email or password' });
        }

        // Verify password
        const passwordMatch = await bcrypt.compare(password, user.passwordHash || user.password || '');
        if (!passwordMatch) {
          return reply.code(401).send({ message: 'Invalid email or password' });
        }

        // Generate JWT token
        const jwtToken = (fastify as any).jwt.sign(
          {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
          },
          { expiresIn: '7d' }
        );

        return reply.code(200).send({
          token: jwtToken,
          user: {
            id: user.id,
            email: user.email,
            fullName: user.fullName,
          },
        } as LoginResponse);
      } catch (error: any) {
        console.error('Login error:', error);
        return reply.code(500).send({ message: 'Login failed' });
      }
    }
  );
}
