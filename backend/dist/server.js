"use strict";
/**
 * SpamRescue API Server
 * Fastify-based REST API with JWT authentication
 */
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildApp = buildApp;
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const helmet_1 = __importDefault(require("@fastify/helmet"));
const jwt_1 = __importDefault(require("@fastify/jwt"));
const cookie_1 = __importDefault(require("@fastify/cookie"));
const rate_limit_1 = __importDefault(require("@fastify/rate-limit"));
const compress_1 = __importDefault(require("@fastify/compress"));
const config_1 = require("./lib/config");
const prisma_1 = require("./lib/prisma");
const logger_1 = require("./lib/logger");
const redis_1 = require("./lib/redis");
const plan_service_1 = require("./services/plan.service");
// Import routes
const routes_1 = require("./api/health/routes");
const routes_2 = require("./api/auth/routes");
const routes_3 = require("./api/mailboxes/routes");
const schedule_routes_1 = __importDefault(require("./api/mailboxes/schedule.routes"));
const routes_4 = require("./api/messages/routes");
const routes_5 = require("./api/users/routes");
const context_routes_1 = require("./api/users/context.routes");
const routes_6 = __importDefault(require("./api/webhooks/routes"));
const routes_7 = __importDefault(require("./api/reputation/routes"));
const routes_8 = __importDefault(require("./api/waitlist/routes"));
const routes_9 = require("./api/learning/routes");
const routes_10 = require("./api/classification/routes");
const preferences_routes_1 = require("./api/classification/preferences.routes");
const routes_11 = __importDefault(require("./api/notifications/routes"));
const routes_12 = __importDefault(require("./api/analytics/routes"));
const routes_13 = __importDefault(require("./api/billing/routes"));
const routes_14 = require("./api/tags/routes");
const routes_15 = __importDefault(require("./api/tagging/routes"));
const plans_routes_1 = __importDefault(require("./api/admin/plans.routes"));
const subscriptions_routes_1 = __importDefault(require("./api/admin/subscriptions.routes"));
const users_routes_1 = __importDefault(require("./api/admin/users.routes"));
const analytics_routes_1 = __importDefault(require("./api/admin/analytics.routes"));
const settings_routes_1 = require("./api/admin/settings.routes");
const audit_routes_1 = __importDefault(require("./api/admin/audit.routes"));
const email_templates_routes_1 = require("./api/admin/email-templates.routes");
const notification_settings_routes_1 = require("./api/admin/notification-settings.routes");
const quota_routes_1 = require("./api/admin/quota.routes");
const queue_debug_routes_1 = require("./api/admin/queue-debug.routes");
const stripe_routes_1 = __importDefault(require("./api/webhooks/stripe.routes"));
const payment_routes_1 = __importDefault(require("./api/webhooks/payment.routes"));
const unsubscribe_1 = require("./api/unsubscribe");
const routes_16 = require("./api/ml/routes");
const routes_17 = require("./api/feedback/routes");
const routes_18 = require("./api/mfa/routes");
const contact_routes_1 = require("./api/contact.routes");
// Import middleware
const https_middleware_1 = require("./middleware/https.middleware");
const timeout_1 = require("./middleware/timeout");
// Import payment provider factory
const PaymentProviderFactory_1 = require("./services/payment/PaymentProviderFactory");
// Import cron service
const cron_service_1 = require("./services/cron.service");
// ML system initialization is loaded lazily (dynamic import) to prevent
// @tensorflow/tfjs-node from crashing the server on startup if native
// binaries are missing or there's insufficient memory.
// Import event loop monitor
const event_loop_monitor_1 = require("./lib/event-loop-monitor");
// ML retraining queue is loaded lazily to avoid pulling in @tensorflow/tfjs-node
// via: ml-retraining-queue → ml-retraining-scheduler → ml-training → tfjs-node
// Import scan queue (initializes on import)
const scan_queue_service_1 = require("./services/scan-queue.service");
/**
 * Build Fastify application
 */
async function buildApp() {
    const app = (0, fastify_1.default)({
        logger: logger_1.logger,
        trustProxy: true,
        requestIdHeader: 'x-request-id',
        requestIdLogLabel: 'reqId',
    });
    // ============================================================================
    // Security Middleware
    // ============================================================================
    // Helmet - Security headers
    await app.register(helmet_1.default, {
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                scriptSrc: ["'self'"],
                imgSrc: ["'self'", 'data:', 'https:'],
                connectSrc: ["'self'"],
                fontSrc: ["'self'"],
                objectSrc: ["'none'"],
                mediaSrc: ["'self'"],
                frameSrc: ["'none'"],
                frameAncestors: ["'none'"],
                baseUri: ["'self'"],
                formAction: ["'self'"],
            },
        },
        crossOriginEmbedderPolicy: false,
        // Clickjacking protection
        frameguard: { action: 'deny' },
        // Prevent MIME type sniffing
        noSniff: true,
        // HSTS - force HTTPS
        hsts: {
            maxAge: 63072000,
            includeSubDomains: true,
            preload: true,
        },
        // Referrer policy
        referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    });
    // Response Compression - Improve performance by compressing responses
    await app.register(compress_1.default, {
        global: true,
        threshold: 1024, // Only compress responses larger than 1KB
        encodings: ['gzip', 'deflate'], // Support both gzip and deflate
        inflateIfDeflated: true,
        removeContentLengthHeader: true,
    });
    // HTTPS Enforcement - redirect to HTTPS based on configuration
    if (config_1.config.env === 'production' || config_1.config.forceHttps) {
        app.addHook('onRequest', https_middleware_1.httpsEnforcementMiddleware);
    }
    // CORS
    await app.register(cors_1.default, {
        origin: config_1.config.env === 'development'
            ? (origin, cb) => {
                // In development, allow all localhost origins and file:// protocol
                if (!origin || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1')) {
                    cb(null, true);
                }
                else {
                    cb(new Error('Not allowed by CORS'), false);
                }
            }
            : config_1.config.cors.origins,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    });
    // Rate Limiting (Per-Plan Dynamic Limits)
    // Note: Using in-memory for rate limiting (Upstash Redis is REST-based, doesn't support redis protocol)
    // For distributed rate limiting, use ioredis with Upstash Redis Protocol
    // In development, use very high limits to avoid blocking during testing
    const isDevelopment = config_1.config.env === 'development';
    await app.register(rate_limit_1.default, {
        max: async (request, key) => {
            // In development, use very high limits
            if (isDevelopment) {
                return 10000; // Essentially unlimited in dev
            }
            try {
                // Extract userId from JWT token if authenticated
                const authHeader = request.headers.authorization;
                if (!authHeader || !authHeader.startsWith('Bearer ')) {
                    // Unauthenticated users get base limit
                    return 100; // 100 req/min for unauthenticated
                }
                // Verify JWT and get userId
                const token = authHeader.substring(7);
                const decoded = app.jwt.verify(token);
                const userId = decoded.userId;
                // Get user's plan limit
                const apiRateLimit = await plan_service_1.planService.getFeatureLimit(userId, 'api_rate_limit_requests_per_minute');
                // Use the higher of plan limit or 200 (ensure good UX even for free plans)
                const effectiveLimit = apiRateLimit ? Math.max(apiRateLimit, 200) : 200;
                return effectiveLimit;
            }
            catch (error) {
                // If JWT verification fails or any error, use base limit
                return 100; // Base limit for invalid tokens
            }
        },
        timeWindow: '1 minute', // Per minute
        keyGenerator: (request) => {
            // Use userId as key if authenticated, otherwise use IP
            try {
                const authHeader = request.headers.authorization;
                if (authHeader && authHeader.startsWith('Bearer ')) {
                    const token = authHeader.substring(7);
                    const decoded = app.jwt.verify(token);
                    return `user:${decoded.userId}`;
                }
            }
            catch (error) {
                // Fall through to IP-based limiting
            }
            return request.ip;
        },
    });
    console.log(`✅ Rate limiting: ${isDevelopment ? 'DISABLED (development mode)' : 'Per-plan dynamic limits'} (${(0, redis_1.isRedisAvailable)() ? 'Redis available for caching' : 'no Redis'})`);
    // Cookie support (for refresh tokens)
    await app.register(cookie_1.default, {
        secret: config_1.config.jwt.refreshSecret,
        parseOptions: {
            httpOnly: true,
            secure: config_1.config.env === 'production',
            sameSite: 'strict',
        },
    });
    // JWT authentication
    // NOTE: cookie fallback was removed to prevent cross-user data leaks.
    // The refreshToken cookie is read directly by /api/auth/refresh endpoint.
    // All other routes require the Authorization header (from localStorage).
    await app.register(jwt_1.default, {
        secret: config_1.config.jwt.accessSecret,
        sign: {
            // Development: 24 hours, Production: 12 hours
            expiresIn: config_1.config.env === 'production' ? '12h' : '24h',
        },
    });
    // Add authentication decorator with userId validation
    // CRITICAL: Prisma treats `undefined` in where clauses as "no filter",
    // so we MUST ensure userId is always a valid string before any query runs.
    app.decorate('authenticate', async (request, reply) => {
        try {
            await request.jwtVerify();
            // SECURITY: Validate userId exists in JWT payload
            const userId = request.user?.userId;
            if (!userId || typeof userId !== 'string') {
                app.log.error(`[Auth] JWT verified but userId missing or invalid: ${JSON.stringify(request.user)}`);
                return reply.status(401).send({
                    success: false,
                    error: {
                        code: 'UNAUTHORIZED',
                        message: 'Invalid token: missing user identity',
                    },
                });
            }
        }
        catch (err) {
            return reply.status(401).send({
                success: false,
                error: {
                    code: 'UNAUTHORIZED',
                    message: 'Invalid or missing authentication token',
                },
            });
        }
    });
    // Add Prisma instance to Fastify
    app.decorate('prisma', prisma_1.prisma);
    // ============================================================================
    // Request Timeout Handling
    // ============================================================================
    // Global timeout for all requests (60 seconds)
    // Individual routes can override with their own timeout middleware
    const timeout = (0, timeout_1.globalTimeoutHook)(60000);
    app.addHook('onRequest', timeout.onRequest);
    // ============================================================================
    // Cache Control for Authenticated Responses
    // ============================================================================
    // SECURITY: Prevent proxies, CDNs, and browsers from caching authenticated API
    // responses. Without this, one user's data could be served to another user.
    app.addHook('onSend', async (request, reply) => {
        // Only add cache-control to authenticated API responses
        if (request.user?.userId && request.url.startsWith('/api/')) {
            reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
            reply.header('Pragma', 'no-cache');
            reply.header('Vary', 'Authorization, Cookie');
        }
    });
    // ============================================================================
    // Health Check
    // ============================================================================
    app.get('/health', async (request, reply) => {
        try {
            // Check database connection
            await prisma_1.prisma.$queryRaw `SELECT 1`;
            // Check Redis connection (if configured)
            const redisStatus = await (0, redis_1.redisHealthCheck)();
            const isHealthy = true && ((0, redis_1.isRedisAvailable)() ? redisStatus.healthy : true);
            return reply.status(isHealthy ? 200 : 503).send({
                status: isHealthy ? 'healthy' : 'degraded',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                environment: config_1.config.env,
                services: {
                    database: 'healthy',
                    redis: (0, redis_1.isRedisAvailable)()
                        ? redisStatus.healthy
                            ? `healthy (${redisStatus.latency}ms)`
                            : 'unhealthy'
                        : 'not_configured',
                },
            });
        }
        catch (error) {
            request.log.error('Health check failed:', error);
            return reply.status(503).send({
                status: 'unhealthy',
                error: 'Database connection failed',
            });
        }
    });
    // ============================================================================
    // API Routes
    // ============================================================================
    // Health check routes (no authentication required)
    await app.register(routes_1.healthRoutes, { prefix: '/api' });
    await app.register(routes_2.authRoutes, { prefix: '/api/auth' });
    await app.register(routes_3.mailboxRoutes, { prefix: '/api/mailboxes' });
    await app.register(schedule_routes_1.default, { prefix: '/api/mailboxes' });
    await app.register(routes_4.messageRoutes, { prefix: '/api/messages' });
    await app.register(routes_5.userRoutes, { prefix: '/api/users' });
    await app.register(context_routes_1.userContextRoutes, { prefix: '/api/users' });
    await app.register(routes_6.default, { prefix: '/api/webhooks' });
    await app.register(routes_7.default, { prefix: '/api/reputation' });
    await app.register(routes_8.default, { prefix: '/api/waitlist' });
    await app.register(routes_9.learningRoutes, { prefix: '/api/learning' });
    await app.register(routes_10.classificationRoutes, { prefix: '/api/classification' });
    await app.register(preferences_routes_1.classificationPreferencesRoutes, { prefix: '/api/classification/preferences' });
    await app.register(routes_11.default, { prefix: '/api/notifications' });
    await app.register(routes_12.default);
    await app.register(routes_16.mlRoutes, { prefix: '/api/ml' });
    await app.register(routes_17.feedbackRoutes, { prefix: '/api/feedback' });
    await app.register(routes_18.mfaRoutes, { prefix: '/api/mfa' });
    // Register tags routes under both API and root paths to match frontend expectations
    await app.register(routes_14.tagRoutes, { prefix: '/api/tags' });
    // Also register the legacy-style tagging routes to match frontend TaggingService expectations
    await app.register(routes_15.default);
    // Unsubscribe Routes
    await app.register(unsubscribe_1.unsubscribeRoutes, { prefix: '/api' });
    // Contact Routes
    await app.register(contact_routes_1.contactRoutes, { prefix: '/api' });
    // Create a simple redirect for root-level tag requests to API-level endpoints
    app.get('/tags', {
        preHandler: [app.authenticate] // Apply same auth as API routes
    }, async (request, reply) => {
        // Proxy to the API route
        const response = await app.inject({
            method: 'GET',
            url: '/api/tags',
            headers: request.headers,
            query: request.query,
            payload: request.body,
        });
        return reply.status(response.statusCode).send(response.json());
    });
    app.post('/tags', {
        preHandler: [app.authenticate]
    }, async (request, reply) => {
        const response = await app.inject({
            method: 'POST',
            url: '/api/tags',
            headers: request.headers,
            query: request.query,
            payload: request.body,
        });
        return reply.status(response.statusCode).send(response.json());
    });
    app.patch('/tags/:tagId', {
        preHandler: [app.authenticate]
    }, async (request, reply) => {
        const response = await app.inject({
            method: 'PATCH',
            url: `/api/tags/${request.params.tagId}`,
            headers: request.headers,
            query: request.query,
            payload: request.body,
        });
        return reply.status(response.statusCode).send(response.json());
    });
    app.delete('/tags/:tagId', {
        preHandler: [app.authenticate]
    }, async (request, reply) => {
        const response = await app.inject({
            method: 'DELETE',
            url: `/api/tags/${request.params.tagId}`,
            headers: request.headers,
            query: request.query,
            payload: request.body,
        });
        return reply.status(response.statusCode).send(response.json());
    });
    app.post('/tags/:tagId/assign/:messageId', {
        preHandler: [app.authenticate]
    }, async (request, reply) => {
        const response = await app.inject({
            method: 'POST',
            url: `/api/tags/${request.params.tagId}/assign/${request.params.messageId}`,
            headers: request.headers,
            query: request.query,
            payload: request.body,
        });
        return reply.status(response.statusCode).send(response.json());
    });
    app.delete('/tags/:tagId/remove/:messageId', {
        preHandler: [app.authenticate]
    }, async (request, reply) => {
        const response = await app.inject({
            method: 'DELETE',
            url: `/api/tags/${request.params.tagId}/remove/${request.params.messageId}`,
            headers: request.headers,
            query: request.query,
            payload: request.body,
        });
        return reply.status(response.statusCode).send(response.json());
    });
    app.get('/tags/:tagId/messages', {
        preHandler: [app.authenticate]
    }, async (request, reply) => {
        const response = await app.inject({
            method: 'GET',
            url: `/api/tags/${request.params.tagId}/messages`,
            headers: request.headers,
            query: request.query,
            payload: request.body,
        });
        return reply.status(response.statusCode).send(response.json());
    });
    // Billing & Subscription Routes
    await app.register(routes_13.default, { prefix: '/api/billing' });
    // Admin Routes
    await app.register(plans_routes_1.default, { prefix: '/api/admin' });
    await app.register(subscriptions_routes_1.default, { prefix: '/api/admin' });
    await app.register(users_routes_1.default, { prefix: '/api/admin' });
    await app.register(analytics_routes_1.default, { prefix: '/api/admin' });
    await app.register(settings_routes_1.adminSettingsRoutes, { prefix: '/api/admin' });
    await app.register(audit_routes_1.default, { prefix: '/api/admin' });
    await app.register(email_templates_routes_1.emailTemplatesRoutes, { prefix: '/api/admin/email-templates' });
    await app.register(notification_settings_routes_1.notificationSettingsRoutes, { prefix: '/api/admin/notification-settings' });
    await app.register(quota_routes_1.quotaRoutes, { prefix: '/api/admin/quota' });
    await app.register(queue_debug_routes_1.queueDebugRoutes, { prefix: '/api/admin' });
    // Payment Webhooks (Unified - supports all providers)
    await app.register(payment_routes_1.default, { prefix: '/api/webhooks' });
    // Stripe Webhook (Legacy - maintained for backwards compatibility)
    await app.register(stripe_routes_1.default, { prefix: '/api/webhooks' });
    // ============================================================================
    // Error Handling
    // ============================================================================
    app.setErrorHandler((error, request, reply) => {
        request.log.error({
            err: error,
            reqId: request.id,
            url: request.url,
            method: request.method,
        });
        // Validation errors
        if (error.validation) {
            return reply.status(400).send({
                error: 'VALIDATION_ERROR',
                message: 'Invalid request data',
                details: error.validation,
            });
        }
        // JWT errors
        if (error.message === 'Authorization token expired') {
            return reply.status(401).send({
                error: 'TOKEN_EXPIRED',
                message: 'Access token expired. Please refresh.',
            });
        }
        if (error.message.includes('Authorization')) {
            return reply.status(401).send({
                error: 'UNAUTHORIZED',
                message: 'Invalid or missing authentication token',
            });
        }
        // Rate limit errors
        if (error.statusCode === 429) {
            return reply.status(429).send({
                error: 'RATE_LIMIT_EXCEEDED',
                message: 'Too many requests. Please try again later.',
            });
        }
        // Default error response
        const statusCode = error.statusCode || 500;
        const message = config_1.config.env === 'production' ? 'Internal server error' : error.message;
        return reply.status(statusCode).send({
            error: 'INTERNAL_ERROR',
            message,
        });
    });
    // ============================================================================
    // Graceful Shutdown
    // ============================================================================
    const gracefulShutdown = async () => {
        console.log('Shutting down gracefully...');
        // Shutdown cron jobs
        (0, cron_service_1.shutdownCronJobs)();
        // Stop event loop monitor
        (0, event_loop_monitor_1.stopEventLoopMonitor)();
        await app.close();
        await prisma_1.prisma.$disconnect();
        console.log('Server shut down successfully');
        process.exit(0);
    };
    process.on('SIGINT', gracefulShutdown);
    process.on('SIGTERM', gracefulShutdown);
    return app;
}
/**
 * Start server
 */
async function start() {
    try {
        // Initialize payment providers (optional)
        try {
            await PaymentProviderFactory_1.PaymentProviderFactory.initialize();
            const availableProviders = PaymentProviderFactory_1.PaymentProviderFactory.getAvailableProviders();
            const defaultProvider = PaymentProviderFactory_1.PaymentProviderFactory.getDefaultProviderType();
            console.log(`💳 Payment providers initialized: ${availableProviders.join(', ')} (default: ${defaultProvider})`);
        }
        catch (error) {
            console.warn('⚠️  No payment providers configured. Payment features will be disabled.');
            console.warn('   To enable payments, add STRIPE_SECRET_KEY or LEMONSQUEEZY_API_KEY to environment variables.');
        }
        const app = await buildApp();
        await app.listen({
            port: config_1.config.port,
            host: config_1.config.host,
        });
        app.log.info(`🚀 Server running at http://${config_1.config.host}:${config_1.config.port}`);
        app.log.info(`📊 Environment: ${config_1.config.env}`);
        app.log.info(`🔐 JWT enabled: ${!!config_1.config.jwt.accessSecret}`);
        // Initialize ML system (lazy import to prevent @tensorflow/tfjs-node from crashing server)
        try {
            const { initializeMLSystem } = await Promise.resolve().then(() => __importStar(require('./services/ml-integration.service')));
            await initializeMLSystem();
            app.log.info(`🤖 ML system initialized`);
        }
        catch (mlError) {
            app.log.warn(`⚠️  ML system failed to initialize (non-critical): ${mlError.message}`);
        }
        // Initialize cron jobs for scheduled scans
        await (0, cron_service_1.initializeCronJobs)();
        app.log.info(`⏰ Cron jobs initialized`);
        // Start event loop monitor
        (0, event_loop_monitor_1.startEventLoopMonitor)();
        app.log.info(`📊 Event loop monitor started`);
        // ML retraining is now scheduled via cron in initializeCronJobs() (every 2 hours)
        // No BullMQ/Redis required — retrainingWorker() is called directly
        // Log scan queue status (initializes on import)
        if (scan_queue_service_1.scanQueue) {
            const queueStats = await (0, scan_queue_service_1.getQueueStats)();
            app.log.info(`📬 Scan queue initialized successfully (waiting: ${queueStats.waiting}, active: ${queueStats.active})`);
        }
        else {
            app.log.warn(`⚠️  Scan queue disabled - Redis not configured. Scans will run synchronously.`);
        }
    }
    catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}
// ============================================================================
// Global exception handlers — prevent silent crashes (OWASP A10:2025)
// ============================================================================
process.on('unhandledRejection', (reason) => {
    // Log the rejection without exposing internals to any HTTP response
    const message = reason instanceof Error ? reason.message : String(reason);
    console.error('[unhandledRejection] Unhandled promise rejection:', message);
    // Do NOT exit — let Fastify continue serving other requests
});
process.on('uncaughtException', (error) => {
    console.error('[uncaughtException] Uncaught exception:', error.message);
    // Exit with error code so the process manager (Docker/Railway) restarts the server
    process.exit(1);
});
// Start server if this file is run directly
if (require.main === module) {
    start();
}
