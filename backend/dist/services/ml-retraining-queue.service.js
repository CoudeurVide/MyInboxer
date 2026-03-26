"use strict";
/**
 * ML Retraining Queue Service
 * Uses BullMQ when available, falls back to direct execution via cron
 * ML retraining is scheduled via node-cron in cron.service.ts (every 2 hours)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.mlWorker = exports.retrainingQueueEvents = exports.retrainingQueue = void 0;
exports.scheduleMLRetraining = scheduleMLRetraining;
exports.triggerMLRetraining = triggerMLRetraining;
exports.getMLQueueStats = getMLQueueStats;
const logger_1 = require("../lib/logger");
const ml_retraining_scheduler_service_1 = require("./ml-retraining-scheduler.service");
// BullMQ is optional — only used if BULLMQ_ENABLED=true and Redis TCP is configured
const BULLMQ_ENABLED = process.env.BULLMQ_ENABLED === 'true';
const REDIS_HOST = process.env.REDIS_HOST;
const REDIS_CONFIGURED = BULLMQ_ENABLED && !!REDIS_HOST && REDIS_HOST !== 'localhost';
let retrainingQueue = null;
exports.retrainingQueue = retrainingQueue;
let retrainingQueueEvents = null;
exports.retrainingQueueEvents = retrainingQueueEvents;
let mlWorker = null;
exports.mlWorker = mlWorker;
// Only import and initialize BullMQ if explicitly enabled
if (REDIS_CONFIGURED) {
    try {
        const { Queue, Worker, QueueEvents } = require('bullmq');
        const REDIS_USE_TLS = process.env.REDIS_TLS === 'true';
        const REDIS_CONNECTION = {
            host: REDIS_HOST,
            port: parseInt(process.env.REDIS_PORT || '6379'),
            password: process.env.REDIS_PASSWORD,
            ...(REDIS_USE_TLS && {
                tls: { rejectUnauthorized: false },
            }),
            maxRetriesPerRequest: null,
            enableReadyCheck: false,
        };
        exports.retrainingQueue = retrainingQueue = new Queue('ml-retraining', {
            connection: REDIS_CONNECTION,
            defaultJobOptions: {
                attempts: 3,
                backoff: { type: 'exponential', delay: 60000 },
                removeOnComplete: { age: 7 * 24 * 3600, count: 100 },
                removeOnFail: { age: 14 * 24 * 3600 },
            },
        });
        exports.retrainingQueueEvents = retrainingQueueEvents = new QueueEvents('ml-retraining', {
            connection: REDIS_CONNECTION,
        });
        exports.mlWorker = mlWorker = new Worker('ml-retraining', async (job) => {
            logger_1.logger.info(`[ML Queue] Starting retraining job ${job.id}`);
            const startTime = Date.now();
            await job.updateProgress(10);
            await (0, ml_retraining_scheduler_service_1.retrainingWorker)();
            await job.updateProgress(100);
            logger_1.logger.info(`[ML Queue] Retraining completed in ${Date.now() - startTime}ms`);
            return { success: true, duration: Date.now() - startTime };
        }, {
            connection: REDIS_CONNECTION,
            concurrency: 1,
            limiter: { max: 1, duration: 3600000 },
        });
        logger_1.logger.info('[ML Queue] BullMQ retraining queue initialized');
    }
    catch (error) {
        logger_1.logger.warn(`[ML Queue] BullMQ init failed: ${error.message}. Using cron-based scheduling.`);
        exports.retrainingQueue = retrainingQueue = null;
    }
}
else {
    logger_1.logger.info('[ML Queue] ML retraining runs via cron (every 2 hours). BullMQ not required.');
}
/**
 * Schedule ML retraining (BullMQ repeatable job)
 * Only used when BullMQ is enabled. Otherwise, cron.service.ts handles scheduling.
 */
async function scheduleMLRetraining() {
    if (!retrainingQueue) {
        // Not an error — cron handles scheduling when BullMQ is disabled
        return;
    }
    try {
        await retrainingQueue.add('retraining', { triggeredBy: 'schedule', timestamp: new Date().toISOString() }, {
            repeat: { pattern: '0 */2 * * *' },
            jobId: 'ml-retraining-scheduled',
        });
        logger_1.logger.info('[ML Queue] ML retraining scheduled via BullMQ (every 2 hours)');
    }
    catch (error) {
        logger_1.logger.error('[ML Queue] Failed to schedule ML retraining:', error);
    }
}
/**
 * Trigger manual ML retraining
 * Works with or without BullMQ — falls back to direct execution
 */
async function triggerMLRetraining() {
    // If BullMQ is available, use the queue
    if (retrainingQueue) {
        const job = await retrainingQueue.add('retraining', {
            triggeredBy: 'manual',
            timestamp: new Date().toISOString(),
        });
        logger_1.logger.info(`[ML Queue] Manual retraining triggered via BullMQ (job: ${job.id})`);
        return { jobId: job.id, success: true };
    }
    // Fallback: run retraining directly (non-blocking)
    logger_1.logger.info('[ML Queue] Manual retraining triggered (direct execution, no BullMQ)');
    const result = await (0, ml_retraining_scheduler_service_1.manualRetrain)('Manual trigger via API');
    return { jobId: result.jobId, success: result.success };
}
/**
 * Get queue statistics
 */
async function getMLQueueStats() {
    if (!retrainingQueue) {
        return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
    }
    const [waiting, active, completed, failed, delayed] = await Promise.all([
        retrainingQueue.getWaitingCount(),
        retrainingQueue.getActiveCount(),
        retrainingQueue.getCompletedCount(),
        retrainingQueue.getFailedCount(),
        retrainingQueue.getDelayedCount(),
    ]);
    return { waiting, active, completed, failed, delayed };
}
// Graceful shutdown
process.on('SIGTERM', async () => {
    if (mlWorker)
        await mlWorker.close();
    if (retrainingQueue)
        await retrainingQueue.close();
    if (retrainingQueueEvents)
        await retrainingQueueEvents.close();
});
