"use strict";
/**
 * Request Timeout Middleware
 * Prevents requests from hanging indefinitely
 * Improves reliability and resource management
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.longRunningTimeout = exports.expensiveTimeout = exports.standardTimeout = exports.quickTimeout = exports.TimeoutPresets = void 0;
exports.createTimeout = createTimeout;
exports.globalTimeoutHook = globalTimeoutHook;
const logger_1 = require("../lib/logger");
// Timeout presets for different operation types
exports.TimeoutPresets = {
    // Quick operations (authentication, simple queries)
    QUICK: {
        timeout: 5000, // 5 seconds
        message: 'Request timeout - operation took too long',
    },
    // Standard API operations
    STANDARD: {
        timeout: 30000, // 30 seconds
        message: 'Request timeout - operation took too long',
    },
    // Expensive operations (scanning, analytics)
    EXPENSIVE: {
        timeout: 120000, // 2 minutes
        message: 'Operation timeout - this may take longer, please try again',
    },
    // Long-running operations (exports, bulk operations)
    LONG_RUNNING: {
        timeout: 300000, // 5 minutes
        message: 'Operation timeout - this is taking longer than expected',
    },
};
/**
 * Create timeout middleware with custom timeout duration
 */
function createTimeout(config) {
    const { timeout, message = 'Request timeout' } = config;
    return async (request, reply) => {
        // Set timeout for the request
        const timeoutId = setTimeout(() => {
            // Check if response already sent
            if (reply.sent) {
                return;
            }
            // Log timeout
            logger_1.logger.warn(`[Timeout] Request timed out after ${timeout}ms: ${request.method} ${request.url}`, {
                method: request.method,
                url: request.url,
                timeout,
                userId: request.userId,
            });
            // Send timeout response
            reply.code(504).send({
                error: 'Gateway Timeout',
                message,
                timeout: timeout / 1000, // Convert to seconds
            });
        }, timeout);
        // Clear timeout when response is sent or connection closes
        reply.raw.on('finish', () => {
            clearTimeout(timeoutId);
        });
        reply.raw.on('close', () => {
            clearTimeout(timeoutId);
        });
    };
}
/**
 * Quick timeout for fast operations (5s)
 */
exports.quickTimeout = createTimeout(exports.TimeoutPresets.QUICK);
/**
 * Standard timeout for normal API operations (30s)
 */
exports.standardTimeout = createTimeout(exports.TimeoutPresets.STANDARD);
/**
 * Expensive timeout for heavy operations (2min)
 */
exports.expensiveTimeout = createTimeout(exports.TimeoutPresets.EXPENSIVE);
/**
 * Long-running timeout for bulk operations (5min)
 */
exports.longRunningTimeout = createTimeout(exports.TimeoutPresets.LONG_RUNNING);
/**
 * Global request timeout hook
 * Can be registered globally on the Fastify instance
 */
function globalTimeoutHook(defaultTimeout = 30000) {
    return {
        onRequest: async (request, reply) => {
            // Skip timeout for health checks and static assets
            const skipPaths = ['/api/health', '/api/health/ready', '/api/health/live'];
            if (skipPaths.some((path) => request.url.startsWith(path))) {
                return;
            }
            // Set default timeout
            const timeoutId = setTimeout(() => {
                if (!reply.sent) {
                    logger_1.logger.warn(`[Global Timeout] Request timed out after ${defaultTimeout}ms: ${request.method} ${request.url}`, {
                        method: request.method,
                        url: request.url,
                        timeout: defaultTimeout,
                    });
                    reply.code(504).send({
                        error: 'Gateway Timeout',
                        message: 'Request timeout - operation took too long',
                        timeout: defaultTimeout / 1000,
                    });
                }
            }, defaultTimeout);
            // Clear timeout when done
            reply.raw.on('finish', () => {
                clearTimeout(timeoutId);
            });
            reply.raw.on('close', () => {
                clearTimeout(timeoutId);
            });
        },
    };
}
