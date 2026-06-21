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
exports.googleAuthRoutes = googleAuthRoutes;
const google_auth_library_1 = require("google-auth-library");
const db_1 = require("../lib/db");
const bcrypt = __importStar(require("bcrypt"));
const client = new google_auth_library_1.OAuth2Client(process.env.GOOGLE_CLIENT_ID);
async function googleAuthRoutes(fastify) {
    // Google OAuth endpoint
    fastify.post('/api/auth/google', async (request, reply) => {
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
            const payload = ticket.getPayload();
            if (!payload?.email) {
                return reply.code(401).send({ error: 'Invalid token payload' });
            }
            const user = await (0, db_1.getOrCreateGoogleUser)({
                email: payload.email,
                fullName: payload.name,
                googleId: payload.sub,
                avatarUrl: payload.picture,
            });
            const jwtToken = fastify.jwt.sign({
                id: user.id,
                email: user.email,
                fullName: user.fullName,
            }, { expiresIn: '7d' });
            return reply.code(200).send({
                token: jwtToken,
                user: {
                    id: user.id,
                    email: user.email,
                    fullName: user.fullName,
                    googleId: user.googleId,
                    avatarUrl: user.avatarUrl,
                },
            });
        }
        catch (error) {
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
    });
    // Manual registration endpoint
    fastify.post('/api/auth/register', async (request, reply) => {
        try {
            const { fullName, email, password } = request.body;
            console.log('Registration request received:', { email, hasPassword: !!password });
            if (!fullName || !email || !password) {
                return reply.code(400).send({ message: 'All fields are required' });
            }
            // Check if user already exists
            const existingUser = await (0, db_1.findUserByEmail)(email);
            if (existingUser) {
                return reply.code(400).send({ message: 'Email already registered' });
            }
            // Hash password
            const saltRounds = 10;
            const hashedPassword = await bcrypt.hash(password, saltRounds);
            // Create user
            const user = await (0, db_1.createUser)({
                fullName,
                email,
                password: hashedPassword,
            });
            // Generate JWT token
            const jwtToken = fastify.jwt.sign({
                id: user.id,
                email: user.email,
                fullName: user.fullName,
            }, { expiresIn: '7d' });
            return reply.code(201).send({
                token: jwtToken,
                user: {
                    id: user.id,
                    email: user.email,
                    fullName: user.fullName,
                },
            });
        }
        catch (error) {
            console.error('Registration error:', error);
            return reply.code(500).send({ message: 'Registration failed' });
        }
    });
    // Login endpoint
    fastify.post('/api/auth/login', async (request, reply) => {
        try {
            const { email, password } = request.body;
            console.log('Login request received:', { email });
            if (!email || !password) {
                return reply.code(400).send({ message: 'Email and password are required' });
            }
            // Find user by email
            const user = await (0, db_1.findUserByEmail)(email);
            if (!user) {
                return reply.code(401).send({ message: 'Invalid email or password' });
            }
            // Verify password
            const passwordMatch = await bcrypt.compare(password, user.password || '');
            if (!passwordMatch) {
                return reply.code(401).send({ message: 'Invalid email or password' });
            }
            // Generate JWT token
            const jwtToken = fastify.jwt.sign({
                id: user.id,
                email: user.email,
                fullName: user.fullName,
            }, { expiresIn: '7d' });
            return reply.code(200).send({
                token: jwtToken,
                user: {
                    id: user.id,
                    email: user.email,
                    fullName: user.fullName,
                },
            });
        }
        catch (error) {
            console.error('Login error:', error);
            return reply.code(500).send({ message: 'Login failed' });
        }
    });
}
//# sourceMappingURL=auth.js.map