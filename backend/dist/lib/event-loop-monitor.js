"use strict";
/**
 * Event Loop Monitor
 * Monitors Node.js event loop lag and reports performance issues
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.startEventLoopMonitor = startEventLoopMonitor;
exports.stopEventLoopMonitor = stopEventLoopMonitor;
exports.getEventLoopStats = getEventLoopStats;
const logger_1 = require("./logger");
const LAG_THRESHOLD_MS = 100; // Warn if event loop lag exceeds 100ms
const CRITICAL_LAG_MS = 500; // Critical alert if lag exceeds 500ms
const CHECK_INTERVAL_MS = 5000; // Check every 5 seconds
let monitorInterval = null;
let lagHistory = [];
const MAX_HISTORY = 12; // Keep last 60 seconds of data (12 * 5s)
/**
 * Calculate event loop lag
 */
function measureEventLoopLag() {
    return new Promise((resolve) => {
        const start = Date.now();
        setImmediate(() => {
            const lag = Date.now() - start;
            resolve(lag);
        });
    });
}
/**
 * Start monitoring event loop
 */
function startEventLoopMonitor() {
    if (monitorInterval) {
        logger_1.logger.warn('[Event Loop Monitor] Already running');
        return;
    }
    logger_1.logger.info('[Event Loop Monitor] Starting...');
    monitorInterval = setInterval(async () => {
        try {
            const lag = await measureEventLoopLag();
            // Add to history
            lagHistory.push(lag);
            if (lagHistory.length > MAX_HISTORY) {
                lagHistory.shift();
            }
            // Calculate average lag
            const avgLag = lagHistory.reduce((a, b) => a + b, 0) / lagHistory.length;
            // Log warnings based on lag
            // Only log warnings and errors - removed debug logging for production
            if (lag >= CRITICAL_LAG_MS) {
                logger_1.logger.error(`[Event Loop Monitor] CRITICAL LAG: ${lag}ms (avg: ${avgLag.toFixed(1)}ms) - Heavy blocking detected!`);
                logger_1.logger.error('[Event Loop Monitor] Consider moving heavy operations to background workers');
            }
            else if (lag >= LAG_THRESHOLD_MS) {
                logger_1.logger.warn(`[Event Loop Monitor] Event loop lag: ${lag}ms (avg: ${avgLag.toFixed(1)}ms)`);
            }
            // Healthy status is no longer logged - reduces production log noise
            // Use GET /api/health endpoint to check event loop stats if needed
        }
        catch (error) {
            logger_1.logger.error('[Event Loop Monitor] Error measuring lag:', error);
        }
    }, CHECK_INTERVAL_MS);
    logger_1.logger.info(`[Event Loop Monitor] Started (checking every ${CHECK_INTERVAL_MS}ms)`);
}
/**
 * Stop monitoring event loop
 */
function stopEventLoopMonitor() {
    if (monitorInterval) {
        clearInterval(monitorInterval);
        monitorInterval = null;
        logger_1.logger.info('[Event Loop Monitor] Stopped');
    }
}
/**
 * Get current lag statistics
 */
function getEventLoopStats() {
    if (lagHistory.length === 0) {
        return {
            currentLag: 0,
            avgLag: 0,
            maxLag: 0,
            minLag: 0,
            history: [],
        };
    }
    return {
        currentLag: lagHistory[lagHistory.length - 1],
        avgLag: lagHistory.reduce((a, b) => a + b, 0) / lagHistory.length,
        maxLag: Math.max(...lagHistory),
        minLag: Math.min(...lagHistory),
        history: [...lagHistory],
    };
}
// Graceful shutdown
process.on('SIGTERM', () => {
    stopEventLoopMonitor();
});
process.on('SIGINT', () => {
    stopEventLoopMonitor();
});
