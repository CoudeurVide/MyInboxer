"use strict";
/**
 * Scan Queue Service
 * Manages email scan jobs using BullMQ for fair distribution and concurrency control
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanWorker = exports.scanQueueEvents = exports.scanQueue = void 0;
exports.enqueueScan = enqueueScan;
exports.getScanJobStatus = getScanJobStatus;
exports.getUserActiveScans = getUserActiveScans;
exports.cancelScan = cancelScan;
exports.getQueueStats = getQueueStats;
const bullmq_1 = require("bullmq");
const scanner_service_1 = require("./scanner.service");
const logger_1 = require("../lib/logger");
const prisma_1 = require("../lib/prisma");
// Queue configuration
const QUEUE_NAME = 'email-scans';
// Check if BullMQ-compatible Redis is configured
// BullMQ requires ioredis connection (not Upstash REST API)
// Only initialize if REDIS_HOST is explicitly set AND BULLMQ_ENABLED=true
// NOTE: BullMQ creates multiple persistent TCP connections per Queue/Worker/QueueEvents.
// This can exhaust Redis connection limits (especially on free tiers) and cause
// "ERR max number of clients reached" errors. The cron service handles scheduled scans
// directly via scanMailbox(), and manual scans fall back to synchronous mode,
// so BullMQ is optional.
const REDIS_HOST = process.env.REDIS_HOST;
const BULLMQ_ENABLED = process.env.BULLMQ_ENABLED === 'true';
const REDIS_CONFIGURED = BULLMQ_ENABLED && !!REDIS_HOST && REDIS_HOST !== 'localhost';
const REDIS_USE_TLS = process.env.REDIS_TLS === 'true';
const REDIS_CONNECTION = REDIS_CONFIGURED ? {
    host: REDIS_HOST,
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    ...(REDIS_USE_TLS && {
        tls: {
            // Redis Cloud may require TLS depending on configuration
            rejectUnauthorized: false, // Accept self-signed certificates
        },
    }),
    maxRetriesPerRequest: null, // Required for BullMQ
    enableReadyCheck: false,
} : null;
// Concurrency limits
const MAX_CONCURRENT_SCANS_PER_USER = 3;
const MAX_GLOBAL_CONCURRENT_SCANS = 50;
// Initialize queue (with error handling for when Redis is not available)
let scanQueue = null;
exports.scanQueue = scanQueue;
let scanQueueEvents = null;
exports.scanQueueEvents = scanQueueEvents;
let scanWorker = null;
exports.scanWorker = scanWorker;
if (REDIS_CONFIGURED && REDIS_CONNECTION) {
    try {
        exports.scanQueue = scanQueue = new bullmq_1.Queue(QUEUE_NAME, {
            connection: REDIS_CONNECTION,
            defaultJobOptions: {
                attempts: 3, // Retry failed jobs up to 3 times
                backoff: {
                    type: 'exponential',
                    delay: 5000, // Start with 5 seconds, then exponential backoff
                },
                removeOnComplete: {
                    age: 24 * 3600, // Keep completed jobs for 24 hours
                    count: 1000, // Keep max 1000 completed jobs
                },
                removeOnFail: {
                    age: 7 * 24 * 3600, // Keep failed jobs for 7 days
                },
            },
        });
        logger_1.logger.info('Scan queue initialized successfully');
    }
    catch (error) {
        logger_1.logger.warn('Failed to initialize scan queue (Redis may not be available):', error);
        exports.scanQueue = scanQueue = null;
    }
}
// Queue events for monitoring (only if queue initialized)
if (scanQueue) {
    try {
        exports.scanQueueEvents = scanQueueEvents = new bullmq_1.QueueEvents(QUEUE_NAME, {
            connection: REDIS_CONNECTION,
        });
    }
    catch (error) {
        logger_1.logger.warn('Failed to initialize scan queue:', error);
        exports.scanQueue = scanQueue = null;
        exports.scanQueueEvents = scanQueueEvents = null;
    }
}
else {
    logger_1.logger.info('⚠️  Redis not configured. Scan queue disabled. Scans will run synchronously.');
}
// Worker to process scan jobs (only if queue initialized)
if (scanQueue) {
    try {
        exports.scanWorker = scanWorker = new bullmq_1.Worker(QUEUE_NAME, async (job) => {
            const { mailboxId, userId, options } = job.data;
            const startTime = Date.now();
            logger_1.logger.info(`Starting scan job ${job.id} for mailbox ${mailboxId} (user: ${userId})`);
            try {
                // Update job progress
                await job.updateProgress(10);
                // Perform the scan
                const result = await (0, scanner_service_1.scanMailbox)(mailboxId, userId, options);
                // Check if scan encountered a FATAL error (error with no messages processed)
                // Partial errors (some messages failed) are acceptable and should not fail the job
                if (result.errors && result.errors.length > 0) {
                    // Check if it's a fatal error (starts with "Fatal error:")
                    const hasFatalError = result.errors.some(err => err.includes('Fatal error:'));
                    if (hasFatalError && result.scannedCount === 0) {
                        // Fatal error with no messages processed - fail the job
                        logger_1.logger.error(`Scan job ${job.id} for mailbox ${mailboxId} failed with fatal error: ${result.errors[0]}`);
                        throw new Error(result.errors[0]);
                    }
                    else {
                        // Partial errors - log but don't fail the job
                        logger_1.logger.warn(`Scan job ${job.id} for mailbox ${mailboxId} completed with ${result.errors.length} non-fatal errors. ` +
                            `Processed ${result.scannedCount} messages successfully.`);
                    }
                }
                // Update job progress
                await job.updateProgress(100);
                const duration = Date.now() - startTime;
                logger_1.logger.info(`Completed scan job ${job.id} for mailbox ${mailboxId}. ` +
                    `Scanned: ${result.scannedCount}, New: ${result.newMessages}, ` +
                    `Leads: ${result.leadFound}, Duration: ${duration}ms`);
                return {
                    ...result,
                    duration,
                };
            }
            catch (error) {
                logger_1.logger.error(`Scan job ${job.id} failed for mailbox ${mailboxId}:`, error);
                throw error; // Will trigger retry
            }
        }, {
            connection: REDIS_CONNECTION,
            concurrency: MAX_GLOBAL_CONCURRENT_SCANS, // Global concurrency limit
            limiter: {
                max: MAX_GLOBAL_CONCURRENT_SCANS,
                duration: 1000, // Process max N jobs per second
            },
        });
    }
    catch (error) {
        logger_1.logger.warn('Failed to initialize scan worker:', error);
        exports.scanWorker = scanWorker = null;
    }
}
/**
 * Add a scan job to the queue
 */
async function enqueueScan(mailboxId, userId, options) {
    if (!scanQueue) {
        throw new Error('Queue service is not available. Please ensure Redis is running.');
    }
    // Check if user already has too many scans in progress
    const userScansInProgress = await getUserActiveScanCount(userId);
    if (userScansInProgress >= MAX_CONCURRENT_SCANS_PER_USER) {
        throw new Error(`User has reached the maximum of ${MAX_CONCURRENT_SCANS_PER_USER} concurrent scans. ` +
            `Please wait for existing scans to complete.`);
    }
    // Add job to queue with user-specific job ID to prevent duplicates
    const jobId = `scan-${mailboxId}-${Date.now()}`;
    const job = await scanQueue.add('scan', {
        mailboxId,
        userId,
        options,
    }, {
        jobId,
        priority: 1, // Can be adjusted based on user plan
    });
    logger_1.logger.info(`Enqueued scan job ${job.id} for mailbox ${mailboxId} (user: ${userId})`);
    return job;
}
/**
 * Get the number of active scans for a user
 */
async function getUserActiveScanCount(userId) {
    if (!scanQueue)
        return 0;
    const activeJobs = await scanQueue.getJobs(['active', 'waiting', 'delayed']);
    return activeJobs.filter((job) => job.data.userId === userId).length;
}
/**
 * Get scan job status
 */
async function getScanJobStatus(jobId) {
    if (!scanQueue) {
        return { status: 'unknown', progress: 0, error: 'Queue service not available' };
    }
    const job = await scanQueue.getJob(jobId);
    if (!job) {
        return {
            status: 'unknown',
            progress: 0,
        };
    }
    const state = await job.getState();
    const progress = job.progress;
    const response = {
        status: state,
        progress: progress || 0,
    };
    if (state === 'completed') {
        response.result = job.returnvalue;
    }
    else if (state === 'failed') {
        response.error = job.failedReason;
    }
    return response;
}
/**
 * Get all active scan jobs for a user
 */
async function getUserActiveScans(userId) {
    if (!scanQueue)
        return [];
    const activeJobs = await scanQueue.getJobs(['active', 'waiting', 'delayed']);
    const userJobs = activeJobs.filter((job) => job.data.userId === userId);
    // Get mailbox emails for all active jobs
    const mailboxIds = userJobs.map(job => job.data.mailboxId);
    const mailboxes = await prisma_1.prisma.mailbox.findMany({
        where: { id: { in: mailboxIds } },
        select: { id: true, email_address: true },
    });
    const mailboxMap = new Map(mailboxes.map(m => [m.id, m.email_address]));
    return Promise.all(userJobs.map(async (job) => ({
        jobId: job.id,
        mailboxId: job.data.mailboxId,
        mailboxEmail: mailboxMap.get(job.data.mailboxId) || 'Unknown',
        status: await job.getState(),
        progress: job.progress || 0,
        createdAt: new Date(job.timestamp),
    })));
}
/**
 * Cancel a scan job
 */
async function cancelScan(jobId, userId) {
    if (!scanQueue)
        return false;
    const job = await scanQueue.getJob(jobId);
    if (!job) {
        return false;
    }
    // Verify the job belongs to the user
    if (job.data.userId !== userId) {
        throw new Error('Unauthorized: Cannot cancel another user\'s scan');
    }
    await job.remove();
    logger_1.logger.info(`Cancelled scan job ${jobId} by user ${userId}`);
    return true;
}
/**
 * Get queue statistics
 */
async function getQueueStats() {
    if (!scanQueue) {
        return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
    }
    const [waiting, active, completed, failed, delayed] = await Promise.all([
        scanQueue.getWaitingCount(),
        scanQueue.getActiveCount(),
        scanQueue.getCompletedCount(),
        scanQueue.getFailedCount(),
        scanQueue.getDelayedCount(),
    ]);
    return {
        waiting,
        active,
        completed,
        failed,
        delayed,
    };
}
// Event listeners for monitoring (only if initialized)
if (scanQueueEvents) {
    scanQueueEvents.on('completed', ({ jobId, returnvalue }) => {
        logger_1.logger.info(`Scan job ${jobId} completed successfully`, { result: returnvalue });
    });
    scanQueueEvents.on('failed', ({ jobId, failedReason }) => {
        logger_1.logger.error(`Scan job ${jobId} failed:`, failedReason);
    });
    scanQueueEvents.on('progress', ({ jobId, data }) => {
        logger_1.logger.debug(`Scan job ${jobId} progress: ${data}%`);
    });
}
// Worker event listeners (only if initialized)
if (scanWorker) {
    scanWorker.on('completed', (job) => {
        logger_1.logger.info(`Worker completed job ${job.id}`);
    });
    scanWorker.on('failed', (job, err) => {
        logger_1.logger.error(`Worker failed job ${job?.id}:`, err);
    });
}
// Graceful shutdown
process.on('SIGTERM', async () => {
    logger_1.logger.info('SIGTERM received, closing scan queue...');
    if (scanWorker)
        await scanWorker.close();
    if (scanQueue)
        await scanQueue.close();
    if (scanQueueEvents)
        await scanQueueEvents.close();
});
if (scanQueue) {
    logger_1.logger.info('Scan queue service initialized successfully');
}
else {
    logger_1.logger.warn('Scan queue service not initialized (Redis not available)');
}
