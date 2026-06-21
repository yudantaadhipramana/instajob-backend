"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.jobRoutes = jobRoutes;
const pg_1 = require("pg");
const pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL
});
async function jobRoutes(fastify) {
    // GET /api/jobs - List jobs with search, filter, pagination
    fastify.get('/api/jobs', async (request, reply) => {
        try {
            const query = request.query;
            const page = parseInt(query.page || '1');
            const limit = parseInt(query.limit || '10');
            const offset = (page - 1) * limit;
            let whereClause = 'WHERE 1=1';
            const params = [];
            let paramIndex = 1;
            if (query.search) {
                whereClause += ` AND (title ILIKE $${paramIndex} OR company ILIKE $${paramIndex} OR description ILIKE $${paramIndex})`;
                params.push(`%${query.search}%`);
                paramIndex++;
            }
            if (query.remote === 'true') {
                whereClause += ` AND remote = true`;
            }
            if (query.location) {
                whereClause += ` AND location ILIKE $${paramIndex}`;
                params.push(`%${query.location}%`);
                paramIndex++;
            }
            if (query.salaryMin) {
                whereClause += ` AND salary_max >= $${paramIndex}`;
                params.push(parseInt(query.salaryMin));
                paramIndex++;
            }
            if (query.salaryMax) {
                whereClause += ` AND salary_min <= $${paramIndex}`;
                params.push(parseInt(query.salaryMax));
                paramIndex++;
            }
            const countResult = await pool.query(`SELECT COUNT(*) FROM "Job" ${whereClause}`, params);
            const total = parseInt(countResult.rows[0].count);
            const result = await pool.query(`SELECT * FROM "Job" ${whereClause} ORDER BY "postedAt" DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`, [...params, limit, offset]);
            return reply.send({
                jobs: result.rows,
                pagination: {
                    page,
                    limit,
                    total,
                    totalPages: Math.ceil(total / limit)
                }
            });
        }
        catch (error) {
            console.error('Jobs error:', error);
            return reply.code(500).send({ message: 'Failed to fetch jobs' });
        }
    });
    // GET /api/jobs/:id - Get job details
    fastify.get('/api/jobs/:id', async (request, reply) => {
        try {
            const { id } = request.params;
            const result = await pool.query(`SELECT * FROM "Job" WHERE id = $1`, [id]);
            if (result.rows.length === 0) {
                return reply.code(404).send({ message: 'Job not found' });
            }
            return reply.send(result.rows[0]);
        }
        catch (error) {
            console.error('Job detail error:', error);
            return reply.code(500).send({ message: 'Failed to fetch job details' });
        }
    });
    // GET /api/jobs/search/:query - Full-text search
    fastify.get('/api/jobs/search/:query', async (request, reply) => {
        try {
            const { query: searchTerm } = request.params;
            const result = await pool.query(`SELECT * FROM "Job" 
         WHERE title ILIKE $1 OR company ILIKE $1 OR description ILIKE $1 OR location ILIKE $1
         ORDER BY "postedAt" DESC LIMIT 20`, [`%${searchTerm}%`]);
            return reply.send({ jobs: result.rows, total: result.rows.length });
        }
        catch (error) {
            console.error('Search error:', error);
            return reply.code(500).send({ message: 'Search failed' });
        }
    });
}
//# sourceMappingURL=jobs.js.map