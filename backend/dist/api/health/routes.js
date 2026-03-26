"use strict";
/**
 * Health Check Routes
 * Provides system health and readiness checks for monitoring
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.healthRoutes = void 0;
const prisma_1 = require("../../lib/prisma");
const redis_1 = require("../../lib/redis");
const event_loop_monitor_1 = require("../../lib/event-loop-monitor");
const ml_retraining_queue_service_1 = require("../../services/ml-retraining-queue.service");
const os_1 = __importDefault(require("os"));
const healthRoutes = async (app) => {
    /**
     * GET /api/health - Basic health check
     * Returns 200 if system is operational, 503 if degraded/unhealthy
     */
    app.get('/health', async (request, reply) => {
        const startTime = Date.now();
        const checks = {
            database: await checkDatabase(),
            redis: await checkRedis(),
            eventLoop: checkEventLoop(),
            memory: checkMemory(),
            mlQueue: await checkMLQueue(),
        };
        // Determine overall status
        const statuses = Object.values(checks).map((c) => c.status);
        const hasUnhealthy = statuses.includes('unhealthy');
        const hasDegraded = statuses.includes('degraded');
        const overallStatus = hasUnhealthy
            ? 'unhealthy'
            : hasDegraded
                ? 'degraded'
                : 'healthy';
        const response = {
            status: overallStatus,
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            checks,
        };
        const statusCode = overallStatus === 'healthy' ? 200 : 503;
        return reply.status(statusCode).send(response);
    });
    /**
     * GET /api/health/ready - Readiness check
     * Returns 200 if system is ready to accept traffic
     */
    app.get('/health/ready', async (request, reply) => {
        try {
            // Check critical dependencies
            const dbCheck = await checkDatabase();
            const redisCheck = await checkRedis();
            const isReady = dbCheck.status !== 'unhealthy' && redisCheck.status !== 'unhealthy';
            if (isReady) {
                return reply.status(200).send({
                    ready: true,
                    timestamp: new Date().toISOString(),
                });
            }
            else {
                return reply.status(503).send({
                    ready: false,
                    timestamp: new Date().toISOString(),
                    issues: {
                        database: dbCheck.status,
                        redis: redisCheck.status,
                    },
                });
            }
        }
        catch (error) {
            return reply.status(503).send({
                ready: false,
                timestamp: new Date().toISOString(),
                error: error.message,
            });
        }
    });
    /**
     * GET /api/health/live - Liveness check
     * Returns 200 if process is alive (for Kubernetes liveness probe)
     */
    app.get('/health/live', async (request, reply) => {
        return reply.status(200).send({
            alive: true,
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
        });
    });
};
exports.healthRoutes = healthRoutes;
/**
 * Check database connectivity and performance
 */
async function checkDatabase() {
    const startTime = Date.now();
    try {
        // Simple query to test database connection
        await prisma_1.prisma.$queryRaw `SELECT 1`;
        const responseTime = Date.now() - startTime;
        // Check response time thresholds
        if (responseTime > 1000) {
            return {
                status: 'unhealthy',
                message: 'Database response time too slow',
                responseTime,
            };
        }
        else if (responseTime > 500) {
            return {
                status: 'degraded',
                message: 'Database response time degraded',
                responseTime,
            };
        }
        return {
            status: 'healthy',
            responseTime,
        };
    }
    catch (error) {
        return {
            status: 'unhealthy',
            message: `Database connection failed: ${error.message}`,
            responseTime: Date.now() - startTime,
        };
    }
}
/**
 * Check Redis connectivity and performance
 */
async function checkRedis() {
    const startTime = Date.now();
    // Check if Redis is configured
    if (!redis_1.redis) {
        return {
            status: 'unhealthy',
            message: 'Redis not configured',
            responseTime: 0,
        };
    }
    try {
        // Ping Redis
        await redis_1.redis.ping();
        const responseTime = Date.now() - startTime;
        // Check response time thresholds
        if (responseTime > 500) {
            return {
                status: 'unhealthy',
                message: 'Redis response time too slow',
                responseTime,
            };
        }
        else if (responseTime > 200) {
            return {
                status: 'degraded',
                message: 'Redis response time degraded',
                responseTime,
            };
        }
        return {
            status: 'healthy',
            responseTime,
        };
    }
    catch (error) {
        return {
            status: 'unhealthy',
            message: `Redis connection failed: ${error.message}`,
            responseTime: Date.now() - startTime,
        };
    }
}
/**
 * Check event loop health
 */
function checkEventLoop() {
    try {
        const stats = (0, event_loop_monitor_1.getEventLoopStats)();
        // Check for event loop blocking
        if (stats.avgLag > 500) {
            return {
                status: 'unhealthy',
                message: 'Event loop severely blocked',
                details: {
                    currentLag: stats.currentLag,
                    avgLag: stats.avgLag,
                    maxLag: stats.maxLag,
                },
            };
        }
        else if (stats.avgLag > 100) {
            return {
                status: 'degraded',
                message: 'Event loop experiencing lag',
                details: {
                    currentLag: stats.currentLag,
                    avgLag: stats.avgLag,
                    maxLag: stats.maxLag,
                },
            };
        }
        return {
            status: 'healthy',
            details: {
                currentLag: stats.currentLag,
                avgLag: stats.avgLag,
            },
        };
    }
    catch (error) {
        return {
            status: 'degraded',
            message: 'Event loop monitoring unavailable',
        };
    }
}
/**
 * Check memory usage
 */
function checkMemory() {
    const memUsage = process.memoryUsage();
    const totalMem = os_1.default.totalmem();
    const freeMem = os_1.default.freemem();
    const usedMem = totalMem - freeMem;
    const memPercentage = (usedMem / totalMem) * 100;
    // Heap usage check
    const heapPercentage = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    if (memPercentage > 90 || heapPercentage > 90) {
        return {
            status: 'unhealthy',
            message: 'Memory usage critical',
            details: {
                heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
                heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
                heapPercentage: Math.round(heapPercentage),
                systemMemPercentage: Math.round(memPercentage),
            },
        };
    }
    else if (memPercentage > 75 || heapPercentage > 75) {
        return {
            status: 'degraded',
            message: 'Memory usage high',
            details: {
                heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
                heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
                heapPercentage: Math.round(heapPercentage),
                systemMemPercentage: Math.round(memPercentage),
            },
        };
    }
    return {
        status: 'healthy',
        details: {
            heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
            heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
            heapPercentage: Math.round(heapPercentage),
        },
    };
}
/**
 * Check ML queue health
 */
async function checkMLQueue() {
    try {
        const stats = await (0, ml_retraining_queue_service_1.getMLQueueStats)();
        // Check for stuck jobs
        if (stats.failed > 10) {
            return {
                status: 'degraded',
                message: 'ML queue has failed jobs',
                details: stats,
            };
        }
        // Check for excessive queue depth
        if (stats.waiting > 5) {
            return {
                status: 'degraded',
                message: 'ML queue backlog detected',
                details: stats,
            };
        }
        return {
            status: 'healthy',
            details: stats,
        };
    }
    catch (error) {
        return {
            status: 'degraded',
            message: 'ML queue monitoring unavailable',
        };
    }
}
