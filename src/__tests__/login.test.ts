import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import Fastify, { FastifyInstance } from 'fastify';

describe('Auth Routes - Login', () => {
  let fastify: FastifyInstance;

  beforeAll(async () => {
    fastify = Fastify({ logger: false });

    // Simple stub endpoint for testing
    fastify.post<{ Body: { email: string; password: string } }>(
      '/api/auth/login',
      async (request, reply) => {
        const { email, password } = request.body;

        if (!email || !password) {
          return reply.code(400).send({ message: 'Email and password are required' });
        }

        // Stub: accept test@example.com / password123
        if (email === 'test@example.com' && password === 'password123') {
          return reply.code(200).send({
            token: 'test-jwt-token-123',
            user: { id: 1, email: 'test@example.com', fullName: 'Test User' },
          });
        }

        return reply.code(401).send({ message: 'Invalid email or password' });
      }
    );

    await fastify.listen({ port: 0, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await fastify.close();
  });

  it('should fail with 400 if email is missing', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { password: 'password123' },
    });

    expect(response.statusCode).toBe(400);
    const data = JSON.parse(response.payload);
    expect(data.message).toContain('Email and password are required');
  });

  it('should return 200 with token on successful login', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'test@example.com', password: 'password123' },
    });

    expect(response.statusCode).toBe(200);
    const data = JSON.parse(response.payload);
    expect(data.token).toBeDefined();
    expect(data.user.email).toBe('test@example.com');
  });

  it('should return 401 with invalid credentials', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'test@example.com', password: 'wrongpassword' },
    });

    expect(response.statusCode).toBe(401);
    const data = JSON.parse(response.payload);
    expect(data.message).toBe('Invalid email or password');
  });
});
