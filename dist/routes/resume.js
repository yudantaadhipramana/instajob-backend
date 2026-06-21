"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.resumeRoutes = resumeRoutes;
exports.subscriptionRoutes = subscriptionRoutes;
const pg_1 = require("pg");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const pool = new pg_1.Pool({ connectionString: process.env.DATABASE_URL });
const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'resumes');
// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}
async function resumeRoutes(fastify) {
    // POST /api/user/resume - Upload resume (multipart/form-data)
    fastify.post('/api/user/resume', async (request, reply) => {
        try {
            const userId = request.user?.id;
            if (!userId) {
                return reply.code(401).send({ message: 'Unauthorized' });
            }
            const body = request.body;
            const { filename, file } = body;
            if (!file || !filename) {
                return reply.code(400).send({ message: 'No file uploaded' });
            }
            const buffer = Buffer.isBuffer(file) ? file : Buffer.from(file);
            // Check file size (max 5MB)
            if (buffer.length > 5 * 1024 * 1024) {
                return reply.code(400).send({ message: 'File too large (max 5MB)' });
            }
            // Validate PDF
            const header = buffer.toString('utf8', 0, 4);
            if (header !== '%PDF') {
                return reply.code(400).send({ message: 'Only PDF files allowed' });
            }
            // Save file
            const safeFilename = `${userId}_${Date.now()}.pdf`;
            const filepath = path.join(UPLOAD_DIR, safeFilename);
            fs.writeFileSync(filepath, buffer);
            // Update user profile with resume URL
            await pool.query(`INSERT INTO "UserProfiles" ("userId", "resumeUrl")
           VALUES ($1, $2)
           ON CONFLICT ("userId") DO UPDATE SET
             "resumeUrl" = EXCLUDED."resumeUrl",
             "updatedAt" = CURRENT_TIMESTAMP`, [userId, `/uploads/resumes/${safeFilename}`]);
            return reply.send({
                message: 'Resume uploaded successfully',
                filename: safeFilename,
                url: `/uploads/resumes/${safeFilename}`
            });
        }
        catch (error) {
            console.error('Resume upload error:', error);
            return reply.code(500).send({ message: 'Failed to upload resume' });
        }
    });
    // GET /api/user/resume - Download resume
    fastify.get('/api/user/resume', async (request, reply) => {
        try {
            const userId = request.user?.id;
            if (!userId) {
                return reply.code(401).send({ message: 'Unauthorized' });
            }
            const profile = await pool.query('SELECT "resumeUrl" FROM "UserProfiles" WHERE "userId" = $1', [userId]);
            if (!profile.rows[0]?.resumeUrl) {
                return reply.code(404).send({ message: 'No resume found' });
            }
            const resumeUrl = profile.rows[0].resumeUrl;
            const filename = path.basename(resumeUrl);
            const filepath = path.join(UPLOAD_DIR, filename);
            if (!fs.existsSync(filepath)) {
                return reply.code(404).send({ message: 'Resume file not found' });
            }
            return reply
                .header('Content-Type', 'application/pdf')
                .header('Content-Disposition', `attachment; filename="${filename}"`)
                .send(fs.createReadStream(filepath));
        }
        catch (error) {
            console.error('Resume download error:', error);
            return reply.code(500).send({ message: 'Failed to download resume' });
        }
    });
    // DELETE /api/user/resume - Delete resume
    fastify.delete('/api/user/resume', async (request, reply) => {
        try {
            const userId = request.user?.id;
            if (!userId) {
                return reply.code(401).send({ message: 'Unauthorized' });
            }
            const profile = await pool.query('SELECT "resumeUrl" FROM "UserProfiles" WHERE "userId" = $1', [userId]);
            if (profile.rows[0]?.resumeUrl) {
                const resumeUrl = profile.rows[0].resumeUrl;
                const filename = path.basename(resumeUrl);
                const filepath = path.join(UPLOAD_DIR, filename);
                if (fs.existsSync(filepath)) {
                    fs.unlinkSync(filepath);
                }
                await pool.query('UPDATE "UserProfiles" SET "resumeUrl" = NULL WHERE "userId" = $1', [userId]);
            }
            return reply.send({ message: 'Resume deleted successfully' });
        }
        catch (error) {
            console.error('Resume delete error:', error);
            return reply.code(500).send({ message: 'Failed to delete resume' });
        }
    });
}
async function subscriptionRoutes(fastify) {
    // GET /api/subscription - Get subscription
    fastify.get('/api/subscription', async (request, reply) => {
        try {
            const userId = request.user?.id;
            if (!userId) {
                return reply.code(401).send({ message: 'Unauthorized' });
            }
            const result = await pool.query('SELECT * FROM "Subscriptions" WHERE "userId" = $1', [userId]);
            if (result.rows.length === 0) {
                return reply.send({
                    plan: 'free',
                    features: 'Basic job search, 10 applications per day',
                    expiresAt: null
                });
            }
            return reply.send(result.rows[0]);
        }
        catch (error) {
            console.error('Get subscription error:', error);
            return reply.code(500).send({ message: 'Failed to fetch subscription' });
        }
    });
    // POST /api/subscription - Create/upgrade subscription
    fastify.post('/api/subscription', async (request, reply) => {
        try {
            const userId = request.user?.id;
            if (!userId) {
                return reply.code(401).send({ message: 'Unauthorized' });
            }
            const { plan } = request.body;
            if (!['free', 'premium'].includes(plan)) {
                return reply.code(400).send({ message: 'Invalid plan' });
            }
            const expiresAt = plan === 'premium'
                ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
                : null;
            const features = plan === 'premium'
                ? 'Unlimited applications, Advanced filters, Priority support, Auto-apply'
                : 'Basic job search, 10 applications per day';
            const result = await pool.query(`INSERT INTO "Subscriptions" ("userId", plan, "expiresAt", features)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT ("userId") DO UPDATE SET
             plan = EXCLUDED.plan,
             "expiresAt" = EXCLUDED."expiresAt",
             features = EXCLUDED.features,
             "updatedAt" = CURRENT_TIMESTAMP
           RETURNING *`, [userId, plan, expiresAt, features]);
            return reply.send(result.rows[0]);
        }
        catch (error) {
            console.error('Update subscription error:', error);
            return reply.code(500).send({ message: 'Failed to update subscription' });
        }
    });
}
//# sourceMappingURL=resume.js.map