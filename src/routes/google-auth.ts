import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { OAuth2Client } from 'google-auth-library';

const prisma = new PrismaClient();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

interface GoogleAuthRequest {
  token: string;
}

export async function googleAuthRoutes(app: FastifyInstance) {
  app.post('/api/auth/google', async (request: FastifyRequest<{ Body: GoogleAuthRequest }>, reply: FastifyReply) => {
    try {
      const { token } = request.body;

      const ticket = await googleClient.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });

      const payload = ticket.getPayload();
      if (!payload) {
        return reply.status(401).send({ message: 'Invalid Google token' });
      }

      const { email, name, sub: googleId } = payload;

      let user = await prisma.user.findUnique({
        where: { email },
      });

      if (!user) {
        user = await prisma.user.create({
          data: {
            email: email!,
            fullName: name || '',
            password: '',
            googleId,
            avatarUrl: payload.picture,
            emailVerified: true,
          },
        });
      } else if (!user.googleId) {
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            googleId,
            avatarUrl: user.avatarUrl || payload.picture,
            emailVerified: true,
          },
        });
      }

      const jwtToken = app.jwt.sign(
        { userId: user.id, email: user.email },
        { expiresIn: '7d' }
      );

      return reply.send({
        token: jwtToken,
        user: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          avatarUrl: user.avatarUrl,
        },
      });
    } catch (error) {
      console.error('Google auth error:', error);
      return reply.status(500).send({ message: 'Google authentication failed' });
    }
  });
}
