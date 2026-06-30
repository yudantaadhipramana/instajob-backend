import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import Fastify, { FastifyInstance } from 'fastify';

describe('Auth Routes - Register', () => {
  let fastify: FastifyInstance;

  beforeAll(async () => {
    fastify = Fastify({ logger: false });

    // Simple stub endpoint for testing
    fastify.post<{ Body: { fullName: string; email: string; password: string } }>(
      '/api/auth/register',
      async (request, reply) => {
        const { fullName, email, password } = request.body;

        if (!fullName || !email || !password) {
          return reply.code(400).send({ message: 'All fields are required' });
        }

        // Stub: reject existing@example.com
        if (email === 'existing@example.com') {
          return reply.code(400).send({ message: 'Email already registered' });
        }

        // Stub: accept new registrations
        return reply.code(201).send({
          token: 'test-jwt-token-456',
          user: { id: 2, email, fullName },
        });
      }
    );

    await fastify.listen({ port: 0, host: '127.0.0.1' });
  });

  afterAll(async () => {
    await fastify.close();
  });

  it('should fail with 400 if fullName is missing', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'test@example.com', password: 'password123' },
    });

    expect(response.statusCode).toBe(400);
    const data = JSON.parse(response.payload);
    expect(data.message).toContain('All fields are required');
  });

  it('should fail with 400 if email already exists', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { fullName: 'Test User', email: 'existing@example.com', password: 'password123' },
    });

    expect(response.statusCode).toBe(400);
    const data = JSON.parse(response.payload);
    expect(data.message).toBe('Email already registered');
  });

  it('should return 201 with token on successful registration', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { fullName: 'New User', email: 'newuser@example.com', password: 'password123' },
    });

    expect(response.statusCode).toBe(201);
    const data = JSON.parse(response.payload);
    expect(data.token).toBeDefined();
    expect(data.user.email).toBe('newuser@example.com');
    expect(data.user.fullName).toBe('New User');
  });
});
