/**
 * Jest Integration Tests for InstaJob Phase 3A Endpoints
 * Basic smoke tests to verify all endpoints are reachable
 */

import axios from 'axios';

const API_URL = process.env.API_URL || 'https://instajob-backend-production.up.railway.app';
const TEST_TOKEN = process.env.TEST_TOKEN || 'test-jwt-token';

describe('Phase 3A Endpoints - Smoke Tests', () => {
  // Helper: Make API call with auth
  const apiCall = (method: string, endpoint: string, data?: any) => {
    return axios({
      method,
      url: `${API_URL}${endpoint}`,
      data,
      headers: {
        'Authorization': `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json',
      },
      validateStatus: () => true, // Don't throw on any status
    });
  };

  describe('Bot Management - Endpoints Exist', () => {
    test('POST /api/bots/create - Endpoint responds', async () => {
      const res = await apiCall('POST', '/api/bots/create', {
        botName: 'Test Bot',
      });
      // Should return 201 (success) or 400/401 (validation/auth), NOT 404
      expect(res.status).not.toBe(404);
    });

    test('GET /api/bots/list - Endpoint responds', async () => {
      const res = await apiCall('GET', '/api/bots/list');
      expect(res.status).not.toBe(404);
    });

    test('POST /api/bots/:botId/heartbeat - Endpoint responds', async () => {
      const res = await apiCall('POST', '/api/bots/test-bot-id/heartbeat', {
        timestamp: Date.now(),
      });
      expect(res.status).not.toBe(404);
    });
  });

  describe('Fleet Management - Endpoints Exist', () => {
    test('POST /api/fleets/create - Endpoint responds', async () => {
      const res = await apiCall('POST', '/api/fleets/create', {
        fleetName: 'Test Fleet',
      });
      expect(res.status).not.toBe(404);
    });

    test('GET /api/fleets/list - Endpoint responds', async () => {
      const res = await apiCall('GET', '/api/fleets/list');
      expect(res.status).not.toBe(404);
    });

    test('POST /api/fleets/:fleetId/add-bot - Endpoint responds', async () => {
      const res = await apiCall('POST', '/api/fleets/test-fleet-id/add-bot', {
        botId: 'test-bot-id',
      });
      expect(res.status).not.toBe(404);
    });
  });

  describe('Token Management - Endpoints Exist', () => {
    test('POST /api/tokens/create - Endpoint responds', async () => {
      const res = await apiCall('POST', '/api/tokens/create', {
        scopes: ['job_discovery'],
      });
      expect(res.status).not.toBe(404);
    });

    test('GET /api/tokens/list - Endpoint responds', async () => {
      const res = await apiCall('GET', '/api/tokens/list');
      expect(res.status).not.toBe(404);
    });

    test('POST /api/tokens/:tokenId/validate - Endpoint responds', async () => {
      const res = await apiCall('POST', '/api/tokens/test-token-id/validate', {
        token: 'test-token',
      });
      expect(res.status).not.toBe(404);
    });
  });

  describe('Job Discovery - Endpoints Exist', () => {
    test('POST /api/jobs/discover - Endpoint responds', async () => {
      const res = await apiCall('POST', '/api/jobs/discover', {
        keywords: ['React'],
        locations: ['Remote'],
      });
      expect(res.status).not.toBe(404);
    });

    test('POST /api/jobs/batch-apply - Endpoint responds', async () => {
      const res = await apiCall('POST', '/api/jobs/batch-apply', {
        botId: 'test-bot-id',
        jobIds: ['job-1', 'job-2'],
      });
      expect(res.status).not.toBe(404);
    });

    test('GET /api/jobs/:jobId/details - Endpoint responds', async () => {
      const res = await apiCall('GET', '/api/jobs/test-job-id/details');
      expect(res.status).not.toBe(404);
    });

    test('POST /api/jobs/:jobId/save - Endpoint responds', async () => {
      const res = await apiCall('POST', '/api/jobs/test-job-id/save');
      expect(res.status).not.toBe(404);
    });
  });

  describe('Analytics - Endpoints Exist', () => {
    test('GET /api/analytics/dashboard - Endpoint responds', async () => {
      const res = await apiCall('GET', '/api/analytics/dashboard');
      expect(res.status).not.toBe(404);
    });

    test('GET /api/analytics/bot/:botId/report - Endpoint responds', async () => {
      const res = await apiCall('GET', '/api/analytics/bot/test-bot-id/report');
      expect(res.status).not.toBe(404);
    });

    test('POST /api/analytics/export - Endpoint responds', async () => {
      const res = await apiCall('POST', '/api/analytics/export', {
        format: 'json',
      });
      expect(res.status).not.toBe(404);
    });
  });

  describe('Health Check', () => {
    test('GET /health - Server is responsive', async () => {
      const res = await apiCall('GET', '/health');
      expect(res.status).toBe(200);
      expect(res.data).toHaveProperty('status', 'ok');
    });
  });
});
