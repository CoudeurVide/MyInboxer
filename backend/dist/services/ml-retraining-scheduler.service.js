"use strict";
/**
 * ML Retraining Scheduler Service
 * Automatically triggers model retraining based on feedback accumulation
 * Phase 1: Automatic Retraining
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldRetrain = shouldRetrain;
exports.triggerRetraining = triggerRetraining;
exports.retrainingWorker = retrainingWorker;
exports.manualRetrain = manualRetrain;
exports.getTrainingJobsStatus = getTrainingJobsStatus;
exports.cancelTrainingJob = cancelTrainingJob;
const prisma_1 = require("../lib/prisma");
const ml_training_service_1 = require("./ml-training.service");
const ml_model_storage_service_1 = require("./ml-model-storage.service");
const ml_accuracy_tracking_service_1 = require("./ml-accuracy-tracking.service");
const DEFAULT_CONFIG = {
    minNewExamplesForRetrain: 500,
    retrainIntervalHours: 24, // Daily
    minAccuracyImprovement: 0.02, // 2% improvement required
    maxConcurrentJobs: 1,
};
/**
 * Load ML retraining config from system settings
 */
async function getRetrainingConfig() {
    try {
        const settings = await prisma_1.prisma.systemSettings.findFirst();
        if (settings) {
            return {
                minNewExamplesForRetrain: settings.ml_min_corrections_for_retrain ?? DEFAULT_CONFIG.minNewExamplesForRetrain,
                retrainIntervalHours: settings.ml_retrain_interval_hours ?? DEFAULT_CONFIG.retrainIntervalHours,
                minAccuracyImprovement: settings.ml_min_accuracy_improvement ?? DEFAULT_CONFIG.minAccuracyImprovement,
                maxConcurrentJobs: 1, // Not configurable yet
            };
        }
        return DEFAULT_CONFIG;
    }
    catch (error) {
        console.error('[Retraining Config] Failed to load config from database, using defaults:', error);
        return DEFAULT_CONFIG;
    }
}
/**
 * Check if retraining should be triggered
 */
async function shouldRetrain(config) {
    const effectiveConfig = config ?? await getRetrainingConfig();
    console.log('[Retraining Scheduler] Checking if retraining should be triggered...');
    // ============================================================================
    // TRIGGER 1: Feedback Threshold
    // ============================================================================
    const stats = await (0, ml_training_service_1.getTrainingStats)();
    const newCorrections = stats.corrections;
    // Get last training job
    const lastTrainingJob = await prisma_1.prisma.mLTrainingJob.findFirst({
        where: { status: 'completed' },
        orderBy: { completed_at: 'desc' },
    });
    if (lastTrainingJob) {
        const lastTrainedAt = lastTrainingJob.completed_at;
        // Count new corrections since last training
        if (lastTrainedAt) {
            const newExamples = await prisma_1.prisma.trainingExample.count({
                where: {
                    created_at: { gte: lastTrainedAt },
                    is_correction: true,
                },
            });
            if (newExamples >= effectiveConfig.minNewExamplesForRetrain) {
                return {
                    shouldRetrain: true,
                    trigger: {
                        type: 'feedback_threshold',
                        reason: `${newExamples} new corrections since last training (threshold: ${effectiveConfig.minNewExamplesForRetrain})`,
                        metadata: { newExamples },
                    },
                };
            }
        }
    }
    else if (stats.totalExamples >= effectiveConfig.minNewExamplesForRetrain) {
        // No previous training, train if we have enough examples
        return {
            shouldRetrain: true,
            trigger: {
                type: 'feedback_threshold',
                reason: `${stats.totalExamples} total examples available (no previous training)`,
                metadata: { totalExamples: stats.totalExamples },
            },
        };
    }
    // ============================================================================
    // TRIGGER 2: Scheduled Interval
    // ============================================================================
    if (lastTrainingJob && lastTrainingJob.completed_at) {
        const hoursSinceLastTrain = (Date.now() - lastTrainingJob.completed_at.getTime()) / (1000 * 60 * 60);
        if (hoursSinceLastTrain >= effectiveConfig.retrainIntervalHours) {
            return {
                shouldRetrain: true,
                trigger: {
                    type: 'scheduled',
                    reason: `${hoursSinceLastTrain.toFixed(1)} hours since last training (interval: ${effectiveConfig.retrainIntervalHours}h)`,
                    metadata: { hoursSinceLastTrain },
                },
            };
        }
    }
    // ============================================================================
    // TRIGGER 3: Accuracy Drop
    // ============================================================================
    const currentModel = await (0, ml_model_storage_service_1.getLatestDeployedModel)();
    if (currentModel) {
        const accuracyCheck = await (0, ml_accuracy_tracking_service_1.checkAccuracyDrop)(currentModel.id);
        if (accuracyCheck.hasDropped) {
            return {
                shouldRetrain: true,
                trigger: {
                    type: 'accuracy_drop',
                    reason: `Accuracy dropped from ${(accuracyCheck.baselineAccuracy * 100).toFixed(1)}% to ${(accuracyCheck.currentAccuracy * 100).toFixed(1)}%`,
                    metadata: accuracyCheck,
                },
            };
        }
    }
    console.log('[Retraining Scheduler] No retraining triggers detected');
    return { shouldRetrain: false };
}
/**
 * Trigger a retraining job
 */
async function triggerRetraining(trigger, config) {
    const effectiveConfig = config ?? await getRetrainingConfig();
    console.log(`[Retraining Scheduler] Triggering retraining: ${trigger.reason}`);
    // Check if max concurrent jobs exceeded
    const runningJobs = await prisma_1.prisma.mLTrainingJob.count({
        where: {
            status: { in: ['pending', 'running'] },
        },
    });
    if (runningJobs >= effectiveConfig.maxConcurrentJobs) {
        console.warn(`[Retraining Scheduler] Max concurrent jobs (${effectiveConfig.maxConcurrentJobs}) reached`);
        return {
            jobId: '',
            success: false,
            error: 'Max concurrent training jobs reached',
        };
    }
    // Create training job record
    const job = await prisma_1.prisma.mLTrainingJob.create({
        data: {
            triggered_by: trigger.type,
            model_type: 'neural_network',
            config: (0, ml_training_service_1.getDefaultTrainingConfig)(),
            status: 'pending',
        },
    });
    console.log(`[Retraining Scheduler] Created training job ${job.id}`);
    // Start training in background (non-blocking)
    runTrainingJob(job.id, effectiveConfig).catch(error => {
        console.error(`[Retraining Scheduler] Training job ${job.id} failed:`, error);
    });
    return {
        jobId: job.id,
        success: true,
    };
}
/**
 * Run a training job (background process)
 */
async function runTrainingJob(jobId, config) {
    console.log(`[Retraining Scheduler] Starting training job ${jobId}...`);
    try {
        // Update job status
        await prisma_1.prisma.mLTrainingJob.update({
            where: { id: jobId },
            data: {
                status: 'running',
                started_at: new Date(),
            },
        });
        // Run training
        const trainingConfig = (0, ml_training_service_1.getDefaultTrainingConfig)();
        const result = await (0, ml_training_service_1.trainModel)(trainingConfig);
        // Update job with results
        await prisma_1.prisma.mLTrainingJob.update({
            where: { id: jobId },
            data: {
                status: 'completed',
                completed_at: new Date(),
                resulting_model_id: result.modelId,
                final_accuracy: result.metrics.accuracy,
                final_loss: result.metrics.loss,
                duration_ms: result.trainingDurationMs,
                training_examples_count: result.trainingSamples + result.validationSamples + result.testSamples,
            },
        });
        console.log(`[Retraining Scheduler] Training job ${jobId} completed successfully`);
        // ========================================================================
        // STEP: Decide whether to deploy new model
        // ========================================================================
        await evaluateAndDeployModel(result.modelId, config);
    }
    catch (error) {
        console.error(`[Retraining Scheduler] Training job ${jobId} failed:`, error);
        // Update job with error
        await prisma_1.prisma.mLTrainingJob.update({
            where: { id: jobId },
            data: {
                status: 'failed',
                error_message: error.message,
                error_stack: error.stack,
                completed_at: new Date(),
            },
        });
    }
}
/**
 * Evaluate new model and decide whether to deploy
 */
async function evaluateAndDeployModel(newModelId, config) {
    console.log(`[Retraining Scheduler] Evaluating model ${newModelId} for deployment...`);
    const currentModel = await (0, ml_model_storage_service_1.getLatestDeployedModel)();
    if (!currentModel) {
        // No current model, deploy this one
        console.log(`[Retraining Scheduler] No current model, deploying ${newModelId}`);
        await (0, ml_model_storage_service_1.deployModel)(newModelId, 100.0);
        await (0, ml_model_storage_service_1.updateModelStatus)(newModelId, 'deployed');
        return;
    }
    // Compare new model with current model
    const comparison = await (0, ml_model_storage_service_1.compareModels)(currentModel.id, newModelId);
    console.log(`[Retraining Scheduler] Comparison:`, {
        currentAccuracy: (comparison.model1.accuracy * 100).toFixed(2) + '%',
        newAccuracy: (comparison.model2.accuracy * 100).toFixed(2) + '%',
        improvement: (comparison.comparison.accuracyDiff * 100).toFixed(2) + '%',
        winner: comparison.comparison.winner,
    });
    // Deploy if new model is better by at least minAccuracyImprovement
    if (comparison.comparison.accuracyDiff >= config.minAccuracyImprovement) {
        console.log(`[Retraining Scheduler] New model is ${(comparison.comparison.accuracyDiff * 100).toFixed(2)}% better, deploying!`);
        // Archive old model
        await (0, ml_model_storage_service_1.updateModelStatus)(currentModel.id, 'archived');
        // Deploy new model
        await (0, ml_model_storage_service_1.deployModel)(newModelId, 100.0);
        await (0, ml_model_storage_service_1.updateModelStatus)(newModelId, 'deployed');
        console.log(`[Retraining Scheduler] Model ${newModelId} deployed successfully`);
    }
    else {
        console.log(`[Retraining Scheduler] New model improvement (${(comparison.comparison.accuracyDiff * 100).toFixed(2)}%) below threshold (${(config.minAccuracyImprovement * 100).toFixed(2)}%), not deploying`);
        await (0, ml_model_storage_service_1.updateModelStatus)(newModelId, 'archived');
    }
}
/**
 * Background worker to check and trigger retraining
 * Call this periodically (e.g., every hour via cron)
 */
async function retrainingWorker(config = DEFAULT_CONFIG) {
    console.log('[Retraining Scheduler] Worker running...');
    const check = await shouldRetrain(config);
    if (check.shouldRetrain && check.trigger) {
        await triggerRetraining(check.trigger, config);
    }
    console.log('[Retraining Scheduler] Worker completed');
}
/**
 * Manual trigger for retraining (for admin use)
 */
async function manualRetrain(reason, userId) {
    const trigger = {
        type: 'manual',
        reason: `Manual retrain: ${reason}`,
        metadata: { userId },
    };
    return await triggerRetraining(trigger);
}
/**
 * Get status of all training jobs
 */
async function getTrainingJobsStatus(limit = 10) {
    return await prisma_1.prisma.mLTrainingJob.findMany({
        orderBy: { created_at: 'desc' },
        take: limit,
        include: {
            resulting_model: {
                select: {
                    version: true,
                    status: true,
                    accuracy: true,
                },
            },
        },
    });
}
/**
 * Cancel a running training job
 */
async function cancelTrainingJob(jobId) {
    await prisma_1.prisma.mLTrainingJob.update({
        where: { id: jobId },
        data: {
            status: 'cancelled',
            completed_at: new Date(),
        },
    });
    console.log(`[Retraining Scheduler] Training job ${jobId} cancelled`);
}
