"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const jwt_1 = __importDefault(require("@fastify/jwt"));
const auth_1 = require("./routes/auth");
const fastify = (0, fastify_1.default)({
    logger: true,
});
// Register plugins
fastify.register(cors_1.default, {
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3001', 'http://127.0.0.1:3001'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    exposedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
});
fastify.register(jwt_1.default, {
    secret: process.env.JWT_SECRET || 'your-secret-key-here',
});
// Health check
fastify.get('/health', async (request, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
});
// Register routes
fastify.register(auth_1.googleAuthRoutes);
// Import and register new routes
const jobs_1 = require("./routes/jobs");
const applications_1 = require("./routes/applications");
const user_1 = require("./routes/user");
const resume_1 = require("./routes/resume");
fastify.register(jobs_1.jobRoutes);
fastify.register(applications_1.applicationRoutes);
fastify.register(user_1.dashboardRoutes);
fastify.register(user_1.userRoutes);
fastify.register(resume_1.resumeRoutes);
fastify.register(resume_1.subscriptionRoutes);
// Start server
const start = async () => {
    try {
        const port = parseInt(process.env.PORT || '3001', 10);
        await fastify.listen({ port, host: '0.0.0.0' });
        console.log(`Server listening on port ${port}`);
    }
    catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};
start();
//# sourceMappingURL=index.js.map