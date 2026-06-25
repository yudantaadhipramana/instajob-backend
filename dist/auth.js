"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRoutes = authRoutes;
const client_1 = require("@prisma/client");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const prisma = new client_1.PrismaClient();
async function authRoutes(fastify) {
    // Register
    fastify.post('/api/auth/register', async (req, reply) => {
        try {
            const { email, password, fullName } = req.body;
            // Validasi input ketat
            if (!email || !password) {
                return reply.code(400).send({ error: 'Email and password required' });
            }
            if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
                return reply.code(400).send({ error: 'Invalid email format' });
            }
            if (typeof password !== 'string' || password.length < 6) {
                return reply.code(400).send({ error: 'Password must be at least 6 characters' });
            }
            if (password.length > 72) { // bcrypt limit is 72 bytes
                return reply.code(400).send({ error: 'Password is too long' });
            }
            if (fullName && (typeof fullName !== 'string' || fullName.length > 100)) {
                return reply.code(400).send({ error: 'Invalid fullName' });
            }
            // Cek email sudah terdaftar
            const existing = await prisma.user.findUnique({ where: { email } });
            if (existing) {
                return reply.code(409).send({ error: 'Email already registered' });
            }
            // Hash password
            const passwordHash = await bcryptjs_1.default.hash(password, 10);
            // Buat user
            const user = await prisma.user.create({
                data: {
                    email,
                    passwordHash,
                    fullName: fullName || email.split('@')[0],
                    referralCode: 'REF_' + Date.now().toString(36).toUpperCase()
                }
            });
            // Generate JWT token
            const token = fastify.jwt.sign({
                userId: user.id,
                email: user.email
            });
            return reply.code(201).send({
                token,
                user: {
                    id: user.id,
                    email: user.email,
                    fullName: user.fullName,
                    subscriptionType: user.subscriptionType
                }
            });
        }
        catch (err) {
            console.error('Register error:', err);
            return reply.code(500).send({ error: 'Registration failed' });
        }
    });
    // Login
    fastify.post('/api/auth/login', async (req, reply) => {
        try {
            const { email, password } = req.body;
            if (!email || !password) {
                return reply.code(400).send({ error: 'Email and password required' });
            }
            if (typeof email !== 'string' || typeof password !== 'string') {
                return reply.code(400).send({ error: 'Invalid credentials format' });
            }
            // Cari user
            const user = await prisma.user.findUnique({ where: { email } });
            if (!user) {
                return reply.code(401).send({ error: 'Invalid credentials' });
            }
            // Verify password
            const valid = await bcryptjs_1.default.compare(password, user.passwordHash);
            if (!valid) {
                return reply.code(401).send({ error: 'Invalid credentials' });
            }
            // Generate token
            const token = fastify.jwt.sign({
                userId: user.id,
                email: user.email
            });
            return reply.send({
                token,
                user: {
                    id: user.id,
                    email: user.email,
                    fullName: user.fullName,
                    subscriptionType: user.subscriptionType
                }
            });
        }
        catch (err) {
            console.error('Login error:', err);
            return reply.code(500).send({ error: 'Login failed' });
        }
    });
    // Verify token (untuk testing)
    fastify.get('/api/auth/me', async (req, reply) => {
        try {
            await req.jwtVerify();
            const decoded = req.user;
            const user = await prisma.user.findUnique({
                where: { id: decoded.userId },
                include: { profile: true }
            });
            if (!user) {
                return reply.code(404).send({ error: 'User not found' });
            }
            return reply.send({
                id: user.id,
                email: user.email,
                fullName: user.fullName,
                subscriptionType: user.subscriptionType,
                profile: user.profile
            });
        }
        catch (err) {
            return reply.code(401).send({ error: 'Unauthorized' });
        }
    });
}
