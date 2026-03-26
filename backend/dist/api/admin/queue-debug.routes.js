"use strict";
/**
 * Queue Debug Routes
 * Admin endpoint to check queue health and status
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.queueDebugRoutes = void 0;
const scan_queue_service_1 = require("../../services/scan-queue.service");
const ml_retraining_queue_service_1 = require("../../services/ml-retraining-queue.service");
const queueDebugRoutes = async (app) => {
    /**
     * GET /api/admin/queue-debug - Get detailed queue status
     */
    app.get('/queue-debug', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            // Check environment variables
            const redisConfig = {
                host: process.env.REDIS_HOST || 'NOT_SET',
                port: process.env.REDIS_PORT || 'NOT_SET',
                hasPassword: !!process.env.REDIS_PASSWORD,
            };
            // Check scan queue status
            const scanQueueStatus = {
                queueExists: !!scan_queue_service_1.scanQueue,
                workerExists: !!scan_queue_service_1.scanWorker,
                stats: scan_queue_service_1.scanQueue ? await (0, scan_queue_service_1.getQueueStats)() : null,
            };
            // Check ML queue status
            const mlQueueStatus = {
                queueExists: !!ml_retraining_queue_service_1.retrainingQueue,
                workerExists: !!ml_retraining_queue_service_1.mlWorker,
                stats: ml_retraining_queue_service_1.retrainingQueue ? await (0, ml_retraining_queue_service_1.getMLQueueStats)() : null,
            };
            // Try to get active/waiting jobs details
            let scanJobs = null;
            if (scan_queue_service_1.scanQueue) {
                try {
                    const [waiting, active, delayed] = await Promise.all([
                        scan_queue_service_1.scanQueue.getWaiting(),
                        scan_queue_service_1.scanQueue.getActive(),
                        scan_queue_service_1.scanQueue.getDelayed(),
                    ]);
                    scanJobs = {
                        waiting: waiting.length,
                        active: active.length,
                        delayed: delayed.length,
                        waitingJobs: waiting.slice(0, 5).map(j => ({
                            id: j.id,
                            data: j.data,
                            timestamp: j.timestamp,
                        })),
                        activeJobs: active.slice(0, 5).map(j => ({
                            id: j.id,
                            data: j.data,
                            timestamp: j.timestamp,
                            progress: j.progress,
                        })),
                    };
                }
                catch (err) {
                    scanJobs = { error: err.message };
                }
            }
            return reply.status(200).send({
                success: true,
                data: {
                    timestamp: new Date().toISOString(),
                    redis: redisConfig,
                    scanQueue: {
                        ...scanQueueStatus,
                        jobs: scanJobs,
                    },
                    mlQueue: mlQueueStatus,
                    diagnosis: {
                        scanQueueWorking: scanQueueStatus.queueExists && scanQueueStatus.workerExists,
                        mlQueueWorking: mlQueueStatus.queueExists && mlQueueStatus.workerExists,
                        redisConfigured: redisConfig.host !== 'NOT_SET' && redisConfig.host !== 'localhost',
                    },
                },
            });
        }
        catch (error) {
            console.error('[Queue Debug] Error:', error);
            return reply.status(500).send({
                success: false,
                error: 'Failed to get queue status',
                details: error.message,
            });
        }
    });
};
exports.queueDebugRoutes = queueDebugRoutes;
