import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function dashboardRoutes(fastify: FastifyInstance) {
  // JWT verification hook for all dashboard routes
  fastify.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  // GET /api/dashboard/stats - Get user dashboard stats
  fastify.get('/api/dashboard/stats', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = (request as any).user?.id;
      if (!userId) {
        return reply.code(401).send({ message: 'Unauthorized' });
      }
      
      const totalJobs = await pool.query('SELECT COUNT(*) FROM "Job"');
      const applications = await pool.query(
        'SELECT COUNT(*) FROM "Application" WHERE "userId" = $1',
        [userId]
      );
      const appliedToday = await pool.query(
        `SELECT COUNT(*) FROM "Application" 
         WHERE "userId" = $1 AND DATE("appliedAt") = CURRENT_DATE`,
        [userId]
      );
      const pending = await pool.query(
        `SELECT COUNT(*) FROM "Application" 
         WHERE "userId" = $1 AND status = 'pending'`,
        [userId]
      );
      const accepted = await pool.query(
        `SELECT COUNT(*) FROM "Application" 
         WHERE "userId" = $1 AND status = 'accepted'`,
        [userId]
      );
      const recent = await pool.query(
        `SELECT a.*, j.title as "jobTitle", j.company 
         FROM "Application" a 
         JOIN "Job" j ON a."jobId" = j.id 
         WHERE a."userId" = $1 
         ORDER BY a."appliedAt" DESC LIMIT 5`,
        [userId]
      );
      
      return reply.send({
        totalJobs: parseInt(totalJobs.rows[0].count),
        totalApplied: parseInt(applications.rows[0].count),
        appliedToday: parseInt(appliedToday.rows[0].count),
        pendingApplications: parseInt(pending.rows[0].count),
        acceptedApplications: parseInt(accepted.rows[0].count),
        recentApplications: recent.rows
      });
    } catch (error) {
      console.error('Dashboard stats error:', error);
      return reply.code(500).send({ message: 'Failed to fetch dashboard stats' });
    }
  });
}

export async function userRoutes(fastify: FastifyInstance) {
  // JWT verification hook for all user routes
  fastify.addHook('onRequest', async (request, reply) => {
    try {
      await request.jwtVerify();
    } catch (err) {
      reply.code(401).send({ error: 'Unauthorized' });
    }
  });

  // GET /api/user/profile - Get user profile
  fastify.get('/api/user/profile', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = (request as any).user?.id;
      if (!userId) {
        return reply.code(401).send({ message: 'Unauthorized' });
      }
      
      const user = await pool.query('SELECT id, email, "fullName" FROM "User" WHERE id = $1', [userId]);
      if (user.rows.length === 0) {
        return reply.code(404).send({ message: 'User not found' });
      }
      
      const profile = await pool.query('SELECT * FROM "UserProfile" WHERE "userId" = $1', [userId]);
      
      return reply.send({
        user: user.rows[0],
        profile: profile.rows[0] || null
      });
    } catch (error) {
      console.error('Get profile error:', error);
      return reply.code(500).send({ message: 'Failed to fetch profile' });
    }
  });
  
  // PUT /api/user/profile - Update user profile
  fastify.put('/api/user/profile', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = (request as any).user?.id;
      if (!userId) {
        return reply.code(401).send({ message: 'Unauthorized' });
      }
      
      const { fullName, bio, skills, experience, location } = request.body as any;
      
      // Update user name
      if (fullName) {
        await pool.query('UPDATE "User" SET "fullName" = $1 WHERE id = $2', [fullName, userId]);
      }
      
      // Upsert profile
      const result = await pool.query(
        `INSERT INTO "UserProfile" ("userId", bio, skills, experience, location)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT ("userId") DO UPDATE SET
           bio = EXCLUDED.bio,
           skills = EXCLUDED.skills,
           experience = EXCLUDED.experience,
           location = EXCLUDED.location,
           "updatedAt" = CURRENT_TIMESTAMP
         RETURNING *`,
        [userId, bio || '', skills || '', experience || '', location || '']
      );
      
      return reply.send(result.rows[0]);
    } catch (error) {
      console.error('Update profile error:', error);
      return reply.code(500).send({ message: 'Failed to update profile' });
    }
  });
  
  // GET /api/user/settings - Get user settings
  fastify.get('/api/user/settings', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = (request as any).user?.id;
      if (!userId) {
        return reply.code(401).send({ message: 'Unauthorized' });
      }
      
      const subscription = await pool.query(
        'SELECT * FROM "Subscription" WHERE "userId" = $1',
        [userId]
      );
      
      return reply.send({
        settings: {
          emailNotifications: true,
          weeklyDigest: true
        },
        subscription: subscription.rows[0] || { plan: 'free' }
      });
    } catch (error) {
      console.error('Get settings error:', error);
      return reply.code(500).send({ message: 'Failed to fetch settings' });
    }
  });
  
  // PUT /api/user/settings - Update user settings
  fastify.put('/api/user/settings', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const userId = (request as any).user?.id;
      if (!userId) {
        return reply.code(401).send({ message: 'Unauthorized' });
      }
      
      const { emailNotifications, weeklyDigest } = request.body as any;
      
      return reply.send({
        message: 'Settings updated',
        settings: { emailNotifications, weeklyDigest }
      });
    } catch (error) {
      console.error('Update settings error:', error);
      return reply.code(500).send({ message: 'Failed to update settings' });
    }
  });
}