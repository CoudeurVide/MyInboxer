"use strict";
/**
 * ML Management Routes
 * Endpoints for model training, metrics, and monitoring
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.mlRoutes = void 0;
const zod_1 = require("zod");
const ml_training_service_1 = require("../../services/ml-training.service");
const ml_model_storage_service_1 = require("../../services/ml-model-storage.service");
const ml_accuracy_tracking_service_1 = require("../../services/ml-accuracy-tracking.service");
const ml_retraining_scheduler_service_1 = require("../../services/ml-retraining-scheduler.service");
/**
 * Request validation schemas
 */
const trainRequestSchema = zod_1.z.object({
    reason: zod_1.z.string().optional(),
});
const deployModelSchema = zod_1.z.object({
    trafficPercentage: zod_1.z.number().min(0).max(100).optional().default(100),
});
const accuracyQuerySchema = zod_1.z.object({
    modelId: zod_1.z.string().uuid().optional(),
    sinceDays: zod_1.z.string().regex(/^\d+$/).optional().transform(val => val ? parseInt(val, 10) : 30),
});
const trendQuerySchema = zod_1.z.object({
    modelId: zod_1.z.string().uuid(),
    days: zod_1.z.string().regex(/^\d+$/).optional().transform(val => val ? parseInt(val, 10) : 30),
});
const listModelsQuerySchema = zod_1.z.object({
    status: zod_1.z.enum(['training', 'deployed', 'archived']).optional(),
    limit: zod_1.z.string().regex(/^\d+$/).optional().transform(val => val ? parseInt(val, 10) : 10),
    offset: zod_1.z.string().regex(/^\d+$/).optional().transform(val => val ? parseInt(val, 10) : 0),
});
const jobsQuerySchema = zod_1.z.object({
    limit: zod_1.z.string().regex(/^\d+$/).optional().transform(val => val ? parseInt(val, 10) : 10),
});
const mlRoutes = async (app) => {
    // ============================================================================
    // Training Management
    // ============================================================================
    /**
     * POST /api/ml/train
     * Manually trigger model training
     */
    app.post('/train', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user.userId;
            const { reason } = trainRequestSchema.parse(request.body || {});
            app.log.info(`[ML API] Manual training triggered by user ${userId}`);
            const job = await (0, ml_retraining_scheduler_service_1.manualRetrain)(reason || 'Manual training via API', userId);
            return reply.send({
                success: job.success,
                jobId: job.jobId,
                message: 'Training job started in background',
                error: job.error,
            });
        }
        catch (error) {
            app.log.error('[ML API] Training failed:', error);
            return reply.status(500).send({
                success: false,
                error: error.message,
            });
        }
    });
    /**
     * GET /api/ml/training/stats
     * Get training data statistics
     */
    app.get('/training/stats', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const stats = await (0, ml_training_service_1.getTrainingStats)();
            return reply.send({
                success: true,
                data: stats,
            });
        }
        catch (error) {
            app.log.error('[ML API] Failed to get training stats:', error);
            return reply.status(500).send({
                success: false,
                error: error.message,
            });
        }
    });
    /**
     * GET /api/ml/training/jobs
     * Get training job history
     */
    app.get('/training/jobs', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const { limit } = jobsQuerySchema.parse(request.query);
            const jobs = await (0, ml_retraining_scheduler_service_1.getTrainingJobsStatus)(limit);
            return reply.send({
                success: true,
                data: jobs,
            });
        }
        catch (error) {
            app.log.error('[ML API] Failed to get training jobs:', error);
            return reply.status(500).send({
                success: false,
                error: error.message,
            });
        }
    });
    /**
     * POST /api/ml/training/jobs/:jobId/cancel
     * Cancel a running training job
     */
    app.post('/training/jobs/:jobId/cancel', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const { jobId } = request.params;
            await (0, ml_retraining_scheduler_service_1.cancelTrainingJob)(jobId);
            return reply.send({
                success: true,
                message: `Training job ${jobId} cancelled`,
            });
        }
        catch (error) {
            app.log.error('[ML API] Failed to cancel training job:', error);
            return reply.status(500).send({
                success: false,
                error: error.message,
            });
        }
    });
    /**
     * GET /api/ml/training/should-retrain
     * Check if retraining should be triggered
     */
    app.get('/training/should-retrain', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const check = await (0, ml_retraining_scheduler_service_1.shouldRetrain)();
            return reply.send({
                success: true,
                data: check,
            });
        }
        catch (error) {
            app.log.error('[ML API] Failed to check retrain status:', error);
            return reply.status(500).send({
                success: false,
                error: error.message,
            });
        }
    });
    // ============================================================================
    // Model Management
    // ============================================================================
    /**
     * GET /api/ml/models
     * List all models
     */
    app.get('/models', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const { status, limit, offset } = listModelsQuerySchema.parse(request.query);
            const models = await (0, ml_model_storage_service_1.listModels)({ status, limit, offset });
            return reply.send({
                success: true,
                data: models,
                pagination: {
                    limit,
                    offset,
                    total: models.length,
                },
            });
        }
        catch (error) {
            app.log.error('[ML API] Failed to list models:', error);
            return reply.status(500).send({
                success: false,
                error: error.message,
            });
        }
    });
    /**
     * GET /api/ml/models/:modelId
     * Get model details and performance
     */
    app.get('/models/:modelId', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const { modelId } = request.params;
            const performance = await (0, ml_model_storage_service_1.getModelPerformance)(modelId);
            return reply.send({
                success: true,
                data: performance,
            });
        }
        catch (error) {
            app.log.error('[ML API] Failed to get model performance:', error);
            return reply.status(500).send({
                success: false,
                error: error.message,
            });
        }
    });
    /**
     * POST /api/ml/models/:modelId/deploy
     * Deploy a model
     */
    app.post('/models/:modelId/deploy', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const { modelId } = request.params;
            const { trafficPercentage } = deployModelSchema.parse(request.body || {});
            await (0, ml_model_storage_service_1.deployModel)(modelId, trafficPercentage);
            return reply.send({
                success: true,
                message: `Model ${modelId} deployed successfully`,
            });
        }
        catch (error) {
            app.log.error('[ML API] Failed to deploy model:', error);
            return reply.status(500).send({
                success: false,
                error: error.message,
            });
        }
    });
    /**
     * POST /api/ml/models/:modelId/archive
     * Archive a model
     */
    app.post('/models/:modelId/archive', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const { modelId } = request.params;
            await (0, ml_model_storage_service_1.archiveModel)(modelId);
            return reply.send({
                success: true,
                message: `Model ${modelId} archived successfully`,
            });
        }
        catch (error) {
            app.log.error('[ML API] Failed to archive model:', error);
            return reply.status(500).send({
                success: false,
                error: error.message,
            });
        }
    });
    /**
     * GET /api/ml/models/compare/:modelId1/:modelId2
     * Compare two models
     */
    app.get('/models/compare/:modelId1/:modelId2', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const { modelId1, modelId2 } = request.params;
            const comparison = await (0, ml_model_storage_service_1.compareModels)(modelId1, modelId2);
            return reply.send({
                success: true,
                data: comparison,
            });
        }
        catch (error) {
            app.log.error('[ML API] Failed to compare models:', error);
            return reply.status(500).send({
                success: false,
                error: error.message,
            });
        }
    });
    // ============================================================================
    // Accuracy & Metrics
    // ============================================================================
    /**
     * GET /api/ml/accuracy
     * Get real accuracy metrics
     */
    app.get('/accuracy', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const { modelId, sinceDays } = accuracyQuerySchema.parse(request.query);
            const sinceDate = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
            const metrics = await (0, ml_accuracy_tracking_service_1.computeRealAccuracy)(modelId, sinceDate);
            return reply.send({
                success: true,
                data: metrics,
            });
        }
        catch (error) {
            app.log.error('[ML API] Failed to get accuracy:', error);
            return reply.status(500).send({
                success: false,
                error: error.message,
            });
        }
    });
    /**
     * GET /api/ml/accuracy/trend
     * Get accuracy trend over time
     */
    app.get('/accuracy/trend', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const { modelId, days } = trendQuerySchema.parse(request.query);
            const trend = await (0, ml_accuracy_tracking_service_1.getAccuracyTrend)(modelId, days);
            return reply.send({
                success: true,
                data: trend,
            });
        }
        catch (error) {
            app.log.error('[ML API] Failed to get accuracy trend:', error);
            return reply.status(500).send({
                success: false,
                error: error.message,
            });
        }
    });
    // ============================================================================
    // Health & Status
    // ============================================================================
    /**
     * GET /api/ml/health
     * Get ML system health status
     */
    app.get('/health', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const [stats, jobs, shouldRetrainCheck] = await Promise.all([
                (0, ml_training_service_1.getTrainingStats)(),
                (0, ml_retraining_scheduler_service_1.getTrainingJobsStatus)(5),
                (0, ml_retraining_scheduler_service_1.shouldRetrain)(),
            ]);
            const latestJob = jobs[0];
            const deployedModels = await (0, ml_model_storage_service_1.listModels)({ status: 'deployed', limit: 1 });
            return reply.send({
                success: true,
                data: {
                    trainingData: {
                        totalExamples: stats.totalExamples,
                        corrections: stats.corrections,
                        recentExamples: stats.recentExamples,
                        distribution: stats.byLabel,
                    },
                    deployment: {
                        hasDeployedModel: deployedModels.length > 0,
                        deployedModel: deployedModels[0] || null,
                    },
                    training: {
                        lastJobStatus: latestJob?.status || 'none',
                        lastJobCompletedAt: latestJob?.completed_at || null,
                        shouldRetrain: shouldRetrainCheck.shouldRetrain,
                        retrainTrigger: shouldRetrainCheck.trigger,
                    },
                    system: {
                        healthy: deployedModels.length > 0 && stats.totalExamples >= 100,
                        readyForTraining: stats.totalExamples >= 100,
                    },
                },
            });
        }
        catch (error) {
            app.log.error('[ML API] Failed to get health status:', error);
            return reply.status(500).send({
                success: false,
                error: error.message,
            });
        }
    });
};
exports.mlRoutes = mlRoutes;
