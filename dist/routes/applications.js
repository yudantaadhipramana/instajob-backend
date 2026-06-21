"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applicationRoutes = applicationRoutes;
const pg_1 = require("pg");
const pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL });
async function applicationRoutes(fastify) {
    // JWT verification hook for all application routes
    fastify.addHook('onRequest', async (request, reply) => {
        try {
            await request.jwtVerify();
        }
        catch (err) {
            reply.code(401).send({ error: 'Unauthorized' });
        }
    });
    // GET /api/applications - List user applications
    fastify.get('/api/applications', async (request, reply) => {
        try {
            const userId = request.user?.id;
            if (!userId) {
                return reply.code(401).send({ message: 'Unauthorized' });
            }
            const result = await pool.query(`SELECT a.*, j.title as "jobTitle", j.company, j.location 
         FROM "Application" a 
         JOIN "Job" j ON a."jobId" = j.id 
         WHERE a."userId" = $1 
         ORDER BY a."appliedAt" DESC`, [userId]);
            return reply.send({ applications: result.rows, total: result.rows.length });
        }
        catch (error) {
            console.error('Applications error:', error);
            return reply.code(500).send({ message: 'Failed to fetch applications' });
        }
    });
    // POST /api/applications - Create application
    fastify.post('/api/applications', async (request, reply) => {
        try {
            const userId = request.user?.id;
            if (!userId) {
                return reply.code(401).send({ message: 'Unauthorized' });
            }
            const { jobId, notes } = request.body;
            // Check if already applied
            const existing = await pool.query('SELECT id FROM "Application" WHERE "userId" = $1 AND "jobId" = $2', [userId, jobId]);
            if (existing.rows.length > 0) {
                return reply.code(400).send({ message: 'Already applied to this job' });
            }
            const result = await pool.query(`INSERT INTO "Application" ("userId", "jobId", notes) 
         VALUES ($1, $2, $3) RETURNING *`, [userId, jobId, notes || '']);
            return reply.code(201).send(result.rows[0]);
        }
        catch (error) {
            console.error('Create application error:', error);
            return reply.code(500).send({ message: 'Failed to create application' });
        }
    });
    // DELETE /api/applications/:id - Delete application
    fastify.delete('/api/applications/:id', async (request, reply) => {
        try {
            const userId = request.user?.id;
            if (!userId) {
                return reply.code(401).send({ message: 'Unauthorized' });
            }
            const { id } = request.params;
            await pool.query('DELETE FROM "Application" WHERE id = $1 AND "userId" = $2', [id, userId]);
            return reply.send({ message: 'Application deleted' });
        }
        catch (error) {
            console.error('Delete application error:', error);
            return reply.code(500).send({ message: 'Failed to delete application' });
        }
    });
}
//# sourceMappingURL=applications.js.map