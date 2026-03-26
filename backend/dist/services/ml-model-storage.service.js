"use strict";
/**
 * ML Model Storage Service
 * Handles persistence and loading of trained ML models
 * Phase 1: Enable Model Persistence
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveModel = saveModel;
exports.loadModel = loadModel;
exports.getLatestDeployedModel = getLatestDeployedModel;
exports.updateModelStatus = updateModelStatus;
exports.deployModel = deployModel;
exports.archiveModel = archiveModel;
exports.listModels = listModels;
exports.getModelPerformance = getModelPerformance;
exports.compareModels = compareModels;
exports.saveTensorFlowModel = saveTensorFlowModel;
exports.loadTensorFlowModel = loadTensorFlowModel;
const prisma_1 = require("../lib/prisma");
const redis_1 = require("../lib/redis");
// Lazy-load TF runtime to prevent native binary crash on server startup
let tf;
try {
    tf = require('@tensorflow/tfjs-node');
}
catch (e) {
    console.warn(`[ML Storage] TensorFlow.js not available: ${e.message}`);
    tf = null;
}
/**
 * Save a trained model to database
 */
async function saveModel(modelData, trainingSamples, validationSamples, testSamples, trainingDurationMs, trainedBy) {
    console.log(`[ML Storage] Saving model ${modelData.version}...`);
    try {
        // Serialize weights for storage
        const serializedWeights = JSON.stringify(modelData.weights);
        // Create model record
        const model = await prisma_1.prisma.mLModel.create({
            data: {
                version: modelData.version,
                model_type: modelData.modelType,
                status: 'validating',
                weights: serializedWeights,
                config: modelData.config,
                feature_names: modelData.featureNames,
                num_features: modelData.config.numFeatures,
                num_classes: modelData.config.numClasses,
                training_samples: trainingSamples,
                validation_samples: validationSamples,
                test_samples: testSamples,
                training_duration_ms: trainingDurationMs,
                trained_by: trainedBy,
                // Metrics (if provided)
                accuracy: modelData.metrics?.accuracy,
                loss: modelData.metrics?.loss,
                validation_loss: modelData.metrics?.validationLoss,
                precision_legit: modelData.metrics?.perClassMetrics.legit.precision,
                precision_spam: modelData.metrics?.perClassMetrics.spam.precision,
                precision_promotion: modelData.metrics?.perClassMetrics.promotion.precision,
                precision_clean: modelData.metrics?.perClassMetrics.clean.precision,
                recall_legit: modelData.metrics?.perClassMetrics.legit.recall,
                recall_spam: modelData.metrics?.perClassMetrics.spam.recall,
                recall_promotion: modelData.metrics?.perClassMetrics.promotion.recall,
                recall_clean: modelData.metrics?.perClassMetrics.clean.recall,
                f1_legit: modelData.metrics?.perClassMetrics.legit.f1,
                f1_spam: modelData.metrics?.perClassMetrics.spam.f1,
                f1_promotion: modelData.metrics?.perClassMetrics.promotion.f1,
                f1_clean: modelData.metrics?.perClassMetrics.clean.f1,
            },
        });
        console.log(`[ML Storage] Model ${modelData.version} saved successfully (ID: ${model.id})`);
        // Cache the model for fast access (1 hour TTL)
        await (0, redis_1.setInCache)(redis_1.CacheKeys.mlModel(modelData.version), model, 3600);
        return model.id;
    }
    catch (error) {
        console.error(`[ML Storage] Failed to save model ${modelData.version}:`, error);
        throw error;
    }
}
/**
 * Load a model from database or cache
 */
async function loadModel(versionOrId) {
    let modelRecord;
    if (!versionOrId) {
        // Load latest deployed model
        modelRecord = await getLatestDeployedModel();
    }
    else if (versionOrId.includes('.')) {
        // Version string (e.g., "v1.0.0")
        const cacheKey = redis_1.CacheKeys.mlModel(versionOrId);
        const cached = await (0, redis_1.getFromCache)(cacheKey);
        if (cached) {
            console.log(`[ML Storage] Model ${versionOrId} loaded from cache`);
            modelRecord = cached;
        }
        else {
            modelRecord = await prisma_1.prisma.mLModel.findUnique({
                where: { version: versionOrId },
            });
            if (modelRecord) {
                await (0, redis_1.setInCache)(cacheKey, modelRecord, 3600);
            }
        }
    }
    else {
        // UUID
        modelRecord = await prisma_1.prisma.mLModel.findUnique({
            where: { id: versionOrId },
        });
    }
    if (!modelRecord) {
        console.warn(`[ML Storage] Model not found: ${versionOrId}`);
        return null;
    }
    console.log(`[ML Storage] Loaded model ${modelRecord.version} (status: ${modelRecord.status})`);
    // Deserialize weights
    const weights = JSON.parse(modelRecord.weights);
    return {
        version: modelRecord.version,
        modelType: modelRecord.model_type,
        weights,
        config: modelRecord.config,
        featureNames: modelRecord.feature_names,
        metrics: modelRecord.accuracy ? {
            accuracy: modelRecord.accuracy,
            loss: modelRecord.loss,
            validationLoss: modelRecord.validation_loss,
            perClassMetrics: {
                legit: {
                    precision: modelRecord.precision_legit,
                    recall: modelRecord.recall_legit,
                    f1: modelRecord.f1_legit,
                },
                spam: {
                    precision: modelRecord.precision_spam,
                    recall: modelRecord.recall_spam,
                    f1: modelRecord.f1_spam,
                },
                promotion: {
                    precision: modelRecord.precision_promotion,
                    recall: modelRecord.recall_promotion,
                    f1: modelRecord.f1_promotion,
                },
                clean: {
                    precision: modelRecord.precision_clean,
                    recall: modelRecord.recall_clean,
                    f1: modelRecord.f1_clean,
                },
            },
        } : undefined,
    };
}
/**
 * Get the latest deployed model
 */
async function getLatestDeployedModel() {
    const model = await prisma_1.prisma.mLModel.findFirst({
        where: { status: 'deployed' },
        orderBy: { created_at: 'desc' },
    });
    return model;
}
/**
 * Update model status
 */
async function updateModelStatus(modelId, status) {
    await prisma_1.prisma.mLModel.update({
        where: { id: modelId },
        data: { status },
    });
    console.log(`[ML Storage] Model ${modelId} status updated to ${status}`);
    // Clear cache to force reload
    const model = await prisma_1.prisma.mLModel.findUnique({ where: { id: modelId } });
    if (model) {
        await (0, redis_1.setInCache)(redis_1.CacheKeys.mlModel(model.version), null, 0);
    }
}
/**
 * Deploy a model (mark as deployed and update deployment tracking)
 */
async function deployModel(modelId, trafficPercentage = 100.0) {
    console.log(`[ML Storage] Deploying model ${modelId} (${trafficPercentage}% traffic)...`);
    // Update model status
    await prisma_1.prisma.mLModel.update({
        where: { id: modelId },
        data: {
            status: 'deployed',
            deployment_count: { increment: 1 },
            last_deployed_at: new Date(),
        },
    });
    // Create deployment record
    await prisma_1.prisma.modelDeployment.create({
        data: {
            model_id: modelId,
            strategy: trafficPercentage === 100.0 ? 'full' : 'canary',
            status: 'active',
            traffic_percentage: trafficPercentage,
            target_user_ids: [],
            is_champion: trafficPercentage === 100.0,
        },
    });
    console.log(`[ML Storage] Model ${modelId} deployed successfully`);
}
/**
 * Archive an old model
 */
async function archiveModel(modelId) {
    await prisma_1.prisma.mLModel.update({
        where: { id: modelId },
        data: {
            status: 'archived',
            archived_at: new Date(),
        },
    });
    console.log(`[ML Storage] Model ${modelId} archived`);
}
/**
 * List all models with optional filtering
 */
async function listModels(options) {
    const { status, limit = 10, offset = 0 } = options || {};
    const models = await prisma_1.prisma.mLModel.findMany({
        where: status ? { status } : undefined,
        orderBy: { created_at: 'desc' },
        take: limit,
        skip: offset,
    });
    return models;
}
/**
 * Get model performance metrics
 */
async function getModelPerformance(modelId) {
    const [model, metrics, featureImportance, deployments] = await Promise.all([
        prisma_1.prisma.mLModel.findUnique({ where: { id: modelId } }),
        prisma_1.prisma.modelMetrics.findMany({
            where: { model_id: modelId },
            orderBy: { created_at: 'desc' },
            take: 30, // Last 30 days
        }),
        prisma_1.prisma.featureImportance.findMany({
            where: { model_id: modelId },
            orderBy: { importance_rank: 'asc' },
        }),
        prisma_1.prisma.modelDeployment.findMany({
            where: { model_id: modelId },
            orderBy: { started_at: 'desc' },
        }),
    ]);
    return {
        model,
        metrics,
        featureImportance,
        deployments,
    };
}
/**
 * Compare two models
 */
async function compareModels(modelId1, modelId2) {
    const [model1, model2] = await Promise.all([
        prisma_1.prisma.mLModel.findUnique({ where: { id: modelId1 } }),
        prisma_1.prisma.mLModel.findUnique({ where: { id: modelId2 } }),
    ]);
    if (!model1 || !model2) {
        throw new Error('One or both models not found');
    }
    const accuracyDiff = (model2.accuracy || 0) - (model1.accuracy || 0);
    const comparison = {
        accuracyDiff,
        precisionDiff: {
            legit: (model2.precision_legit || 0) - (model1.precision_legit || 0),
            spam: (model2.precision_spam || 0) - (model1.precision_spam || 0),
            promotion: (model2.precision_promotion || 0) - (model1.precision_promotion || 0),
            clean: (model2.precision_clean || 0) - (model1.precision_clean || 0),
        },
        recallDiff: {
            legit: (model2.recall_legit || 0) - (model1.recall_legit || 0),
            spam: (model2.recall_spam || 0) - (model1.recall_spam || 0),
            promotion: (model2.recall_promotion || 0) - (model1.recall_promotion || 0),
            clean: (model2.recall_clean || 0) - (model1.recall_clean || 0),
        },
        f1Diff: {
            legit: (model2.f1_legit || 0) - (model1.f1_legit || 0),
            spam: (model2.f1_spam || 0) - (model1.f1_spam || 0),
            promotion: (model2.f1_promotion || 0) - (model1.f1_promotion || 0),
            clean: (model2.f1_clean || 0) - (model1.f1_clean || 0),
        },
        winner: (accuracyDiff > 0.02 ? 'model2' : accuracyDiff < -0.02 ? 'model1' : 'tie'),
    };
    return {
        model1,
        model2,
        comparison,
    };
}
/**
 * Save TensorFlow.js model to database
 */
async function saveTensorFlowModel(model, version, featureNames, metrics, trainingSamples, validationSamples, testSamples, trainingDurationMs, trainedBy) {
    console.log(`[ML Storage] Saving TensorFlow.js model ${version}...`);
    // Serialize model weights
    const weightsData = await model.getWeights().map(w => w.arraySync());
    // Get model config
    const config = model.getConfig();
    const modelData = {
        version,
        modelType: 'neural_network',
        weights: weightsData,
        config: {
            numFeatures: featureNames.length,
            numClasses: 4,
            architecture: config,
        },
        featureNames,
        metrics,
    };
    return await saveModel(modelData, trainingSamples, validationSamples, testSamples, trainingDurationMs, trainedBy);
}
/**
 * Load TensorFlow.js model from database
 */
async function loadTensorFlowModel(versionOrId) {
    const modelData = await loadModel(versionOrId);
    if (!modelData) {
        return null;
    }
    try {
        // Reconstruct TensorFlow.js model
        const config = modelData.config.architecture;
        const model = tf.sequential();
        // Rebuild architecture from config
        // This is a simplified version - in production, you'd want more robust deserialization
        if (config && config.layers) {
            for (const layerConfig of config.layers) {
                if (layerConfig.type === 'dense') {
                    model.add(tf.layers.dense({
                        units: layerConfig.units,
                        activation: layerConfig.activation,
                        inputShape: model.layers.length === 0 ? [modelData.config.numFeatures] : undefined,
                    }));
                }
                else if (layerConfig.type === 'dropout') {
                    model.add(tf.layers.dropout({ rate: layerConfig.dropout || 0.3 }));
                }
            }
        }
        // Set weights
        const weights = modelData.weights.map((w) => tf.tensor(w));
        model.setWeights(weights);
        console.log(`[ML Storage] TensorFlow.js model ${modelData.version} loaded successfully`);
        return {
            model,
            featureNames: modelData.featureNames,
        };
    }
    catch (error) {
        console.error(`[ML Storage] Failed to load TensorFlow.js model:`, error);
        throw error;
    }
}
