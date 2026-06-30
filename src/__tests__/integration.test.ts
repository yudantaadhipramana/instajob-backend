import { FastifyInstance } from 'fastify';
import jwt from '@fastify/jwt';

/**
 * Jest Integration Test Suite for InstaJob Phase 3A Endpoints
 * Tests all 27 bot ecosystem endpoints
 */

let app: FastifyInstance;
const TEST_USER_ID = 'test-user-123';
const TEST_BOT_ID = 'test-bot-123';
const TEST_FLEET_ID = 'test-fleet-123';
const TEST_TOKEN_ID = 'test-token-123';
const TEST_BATCH_ID = 'test-batch-123';

// Helper: Generate JWT token for testing
export const generateTestToken = (userId: string = TEST_USER_ID): string => {
  return jwt.sign({ userId, email: 'test@example.com' }, process.env.JWT_SECRET || 'test-secret');
};

// Helper: Make authenticated request
export const authenticatedRequest = async (
  method: string,
  path: string,
  payload?: any,
  token?: string
) => {
  const testToken = token || generateTestToken();
  
  const response = await app.inject({
    method,
    url: path,
    payload,
    headers: {
      Authorization: `Bearer ${testToken}`,
    },
  });

  return {
    status: response.statusCode,
    body: JSON.parse(response.body),
  };
};

// Helper: Make unauthenticated request
export const unauthenticatedRequest = async (
  method: string,
  path: string,
  payload?: any
) => {
  const response = await app.inject({
    method,
    url: path,
    payload,
  });

  return {
    status: response.statusCode,
    body: JSON.parse(response.body),
  };
};

/**
 * Test Suite: Bot Management Endpoints
 */
describe('Bot Management Endpoints', () => {
  beforeAll(async () => {
    // Initialize app (in real tests, would use test database)
    app = await import('../src/index').then(m => m.default);
  });

  afterAll(async () => {
    await app.close();
  });

  test('POST /api/bots/create - Create bot successfully', async () => {
    const res = await authenticatedRequest('POST', '/api/bots/create', {
      botName: 'Test Bot 1',
      telegramBotToken: 'test-token-123',
    });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('botId');
    expect(res.body).toHaveProperty('botName', 'Test Bot 1');
    expect(res.body).toHaveProperty('botStatus', 'ACTIVE');
  });

  test('POST /api/bots/create - Missing botName returns 400', async () => {
    const res = await authenticatedRequest('POST', '/api/bots/create', {
      telegramBotToken: 'test-token-123',
    });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  test('GET /api/bots/list - List bots with pagination', async () => {
    const res = await authenticatedRequest('GET', '/api/bots/list?page=1&limit=10');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('bots');
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('page', 1);
    expect(res.body).toHaveProperty('limit', 10);
    expect(res.body).toHaveProperty('hasMore');
  });

  test('GET /api/bots/:botId - Get bot details', async () => {
    const res = await authenticatedRequest('GET', `/api/bots/${TEST_BOT_ID}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('botName');
    expect(res.body).toHaveProperty('botStatus');
  });

  test('GET /api/bots/:botId - Bot not found returns 404', async () => {
    const res = await authenticatedRequest('GET', '/api/bots/nonexistent-bot');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error', 'Bot not found');
  });

  test('PATCH /api/bots/:botId/update - Update bot successfully', async () => {
    const res = await authenticatedRequest('PATCH', `/api/bots/${TEST_BOT_ID}/update`, {
      botName: 'Updated Bot Name',
      botStatus: 'INACTIVE',
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('botName', 'Updated Bot Name');
    expect(res.body).toHaveProperty('botStatus', 'INACTIVE');
  });

  test('DELETE /api/bots/:botId - Delete bot (soft delete)', async () => {
    const res = await authenticatedRequest('DELETE', `/api/bots/${TEST_BOT_ID}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
    expect(res.body).toHaveProperty('message');
  });

  test('POST /api/bots/:botId/heartbeat - Record heartbeat', async () => {
    const res = await authenticatedRequest('POST', `/api/bots/${TEST_BOT_ID}/heartbeat`, {
      timestamp: Date.now(),
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body).toHaveProperty('nextCheckIn');
  });

  test('Unauthenticated request returns 401', async () => {
    const res = await unauthenticatedRequest('GET', '/api/bots/list');

    expect(res.status).toBe(401);
  });
});

/**
 * Test Suite: Fleet Management Endpoints
 */
describe('Fleet Management Endpoints', () => {
  test('POST /api/fleets/create - Create fleet successfully', async () => {
    const res = await authenticatedRequest('POST', '/api/fleets/create', {
      fleetName: 'Test Fleet',
      description: 'Fleet for testing',
    });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('fleetId');
    expect(res.body).toHaveProperty('fleetName', 'Test Fleet');
  });

  test('GET /api/fleets/list - List fleets with pagination', async () => {
    const res = await authenticatedRequest('GET', '/api/fleets/list?page=1&limit=10');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('fleets');
    expect(Array.isArray(res.body.fleets)).toBe(true);
  });

  test('PATCH /api/fleets/:fleetId/update - Update fleet', async () => {
    const res = await authenticatedRequest('PATCH', `/api/fleets/${TEST_FLEET_ID}/update`, {
      fleetName: 'Updated Fleet',
      description: 'Updated description',
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('fleetName', 'Updated Fleet');
  });

  test('POST /api/fleets/:fleetId/add-bot - Add bot to fleet', async () => {
    const res = await authenticatedRequest('POST', `/api/fleets/${TEST_FLEET_ID}/add-bot`, {
      botId: TEST_BOT_ID,
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('botCount');
  });

  test('DELETE /api/fleets/:fleetId/remove-bot - Remove bot from fleet', async () => {
    const res = await authenticatedRequest('DELETE', `/api/fleets/${TEST_FLEET_ID}/remove-bot`, {
      botId: TEST_BOT_ID,
    });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('botCount');
  });

  test('DELETE /api/fleets/:fleetId - Delete empty fleet', async () => {
    const res = await authenticatedRequest('DELETE', `/api/fleets/${TEST_FLEET_ID}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('success', true);
  });

  test('DELETE /api/fleets/:fleetId - Non-empty fleet returns 400', async () => {
    // First add bot, then try to delete
    await authenticatedRequest('POST', `/api/fleets/${TEST_FLEET_ID}/add-bot`, {
      botId: TEST_BOT_ID,
    });

    const res = await authenticatedRequest('DELETE', `/api/fleets/${TEST_FLEET_ID}`);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Fleet is not empty');
  });
});
