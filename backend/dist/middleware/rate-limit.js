"use strict";
/**
 * Rate Limiting Middleware
 * Protects API endpoints from abuse and controls costs
 * Uses Redis for distributed rate limiting across instances
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.webhookRateLimiter = exports.readRateLimiter = exports.apiRateLimiter = exports.expensiveRateLimiter = exports.authRateLimiter = exports.RateLimitPresets = void 0;
exports.createRateLimiter = createRateLimiter;
const redis_1 = require("../lib/redis");
const logger_1 = require("../lib/logger");
// Rate limit configurations for different endpoints
exports.RateLimitPresets = {
    // Strict limits for authentication endpoints
    AUTH: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        maxRequests: 5, // 5 attempts per 15 minutes
        keyPrefix: 'rl:auth',
        message: 'Too many authentication attempts. Please try again later.',
    },
    // Moderate limits for expensive operations (AI classification, scanning)
    EXPENSIVE: {
        windowMs: 60 * 1000, // 1 minute
        maxRequests: 10, // 10 requests per minute
        keyPrefix: 'rl:expensive',
        message: 'Rate limit exceeded for this operation. Please slow down.',
    },
    // General API limits
    API: {
        windowMs: 60 * 1000, // 1 minute
        maxRequests: 60, // 60 requests per minute
        keyPrefix: 'rl:api',
        message: 'Too many requests. Please try again later.',
    },
    // Lenient limits for read operations
    READ: {
        windowMs: 60 * 1000, // 1 minute
        maxRequests: 120, // 120 requests per minute
        keyPrefix: 'rl:read',
        message: 'Too many requests. Please try again later.',
    },
    // Webhook endpoints (external triggers)
    WEBHOOK: {
        windowMs: 60 * 1000, // 1 minute
        maxRequests: 30, // 30 requests per minute
        keyPrefix: 'rl:webhook',
        message: 'Webhook rate limit exceeded.',
    },
};
/**
 * Create rate limit middleware
 */
function createRateLimiter(config) {
    const { windowMs, maxRequests, keyPrefix = 'rl', skipSuccessfulRequests = false, skipFailedRequests = false, message = 'Too many requests. Please try again later.', } = config;
    return async (request, reply) => {
        try {
            // If Redis is not available, skip rate limiting
            if (!redis_1.redis) {
                logger_1.logger.warn('[Rate Limit] Redis not configured, skipping rate limit check');
                return;
            }
            // Get identifier (user ID or IP address)
            const userId = request.userId;
            const identifier = userId || request.ip || 'anonymous';
            // Create Redis key
            const key = `${keyPrefix}:${identifier}`;
            const now = Date.now();
            const windowStart = now - windowMs;
            // Remove old entries outside the window
            await redis_1.redis.zremrangebyscore(key, 0, windowStart);
            // Count current requests in window
            const requestCount = await redis_1.redis.zcard(key);
            // Check if limit exceeded
            if (requestCount >= maxRequests) {
                const oldestRequest = await redis_1.redis.zrange(key, 0, 0);
                const resetTime = oldestRequest.length > 0
                    ? parseInt(oldestRequest[0]) + windowMs
                    : now + windowMs;
                const retryAfter = Math.ceil((resetTime - now) / 1000);
                // Set rate limit headers
                reply.header('X-RateLimit-Limit', maxRequests);
                reply.header('X-RateLimit-Remaining', 0);
                reply.header('X-RateLimit-Reset', Math.ceil(resetTime / 1000));
                reply.header('Retry-After', retryAfter);
                logger_1.logger.warn(`[Rate Limit] Blocked request from ${identifier} on ${request.url}`);
                return reply.status(429).send({
                    error: 'Too Many Requests',
                    message,
                    retryAfter,
                });
            }
            // Create unique request identifier
            const requestKey = `${now}-${Math.random()}`;
            // Add current request to window (Upstash Redis format)
            await redis_1.redis.zadd(key, { score: now, member: requestKey });
            // Set TTL to window duration
            await redis_1.redis.expire(key, Math.ceil(windowMs / 1000));
            // Set rate limit headers
            const remaining = maxRequests - requestCount - 1;
            reply.header('X-RateLimit-Limit', maxRequests);
            reply.header('X-RateLimit-Remaining', Math.max(0, remaining));
            reply.header('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000));
            // Optionally skip counting on response
            if (skipSuccessfulRequests || skipFailedRequests) {
                reply.raw.on('finish', async () => {
                    const shouldSkip = (skipSuccessfulRequests && reply.statusCode < 400) ||
                        (skipFailedRequests && reply.statusCode >= 400);
                    if (shouldSkip) {
                        try {
                            // Remove the request from the count
                            await redis_1.redis.zrem(key, requestKey);
                        }
                        catch (error) {
                            logger_1.logger.error('[Rate Limit] Failed to remove request from count:', error);
                        }
                    }
                });
            }
        }
        catch (error) {
            // If Redis fails, log error but don't block the request
            logger_1.logger.error('[Rate Limit] Redis error:', error);
            // Continue with the request
        }
    };
}
/**
 * Rate limiter for authentication endpoints
 */
exports.authRateLimiter = createRateLimiter(exports.RateLimitPresets.AUTH);
/**
 * Rate limiter for expensive operations (AI, scanning)
 */
exports.expensiveRateLimiter = createRateLimiter(exports.RateLimitPresets.EXPENSIVE);
/**
 * General API rate limiter
 */
exports.apiRateLimiter = createRateLimiter(exports.RateLimitPresets.API);
/**
 * Rate limiter for read operations
 */
exports.readRateLimiter = createRateLimiter(exports.RateLimitPresets.READ);
/**
 * Rate limiter for webhook endpoints
 */
exports.webhookRateLimiter = createRateLimiter(exports.RateLimitPresets.WEBHOOK);
