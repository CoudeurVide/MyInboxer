"use strict";
/**
 * ML Classifier V2 Service
 * Uses real trained TensorFlow.js models (not hardcoded weights!)
 * Phase 1-2: Real ML with Neural Networks
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyWithML = classifyWithML;
exports.reloadModelCache = reloadModelCache;
exports.updateModelWithFeedback = updateModelWithFeedback;
exports.batchClassifyWithML = batchClassifyWithML;
// Lazy-load TF runtime to prevent native binary crash on server startup
let tf;
try {
    tf = require('@tensorflow/tfjs-node');
}
catch (e) {
    console.warn(`[ML Classifier V2] TensorFlow.js not available: ${e.message}`);
    tf = null;
}
const ml_features_service_1 = require("./ml-features.service");
const redis_1 = require("../lib/redis");
const ml_model_storage_service_1 = require("./ml-model-storage.service");
const ml_training_service_1 = require("./ml-training.service");
// Cache for loaded model
let cachedModel = null;
const MODEL_CACHE_TTL = 60 * 60 * 1000; // 1 hour
/**
 * Load or get cached TensorFlow.js model
 */
async function getModel() {
    // Check if cached model is still valid
    if (cachedModel && Date.now() - cachedModel.loadedAt < MODEL_CACHE_TTL) {
        return {
            model: cachedModel.model,
            featureNames: cachedModel.featureNames,
            version: cachedModel.version,
        };
    }
    // Load latest deployed model
    console.log('[ML Classifier V2] Loading latest deployed model...');
    try {
        const modelData = await (0, ml_model_storage_service_1.loadTensorFlowModel)();
        if (!modelData) {
            console.warn('[ML Classifier V2] No trained model found, will use fallback');
            return null;
        }
        // Cache the model
        cachedModel = {
            model: modelData.model,
            featureNames: modelData.featureNames,
            version: 'latest', // TODO: get actual version from model
            loadedAt: Date.now(),
        };
        console.log(`[ML Classifier V2] Loaded model with ${modelData.featureNames.length} features`);
        return {
            model: modelData.model,
            featureNames: modelData.featureNames,
            version: 'latest',
        };
    }
    catch (error) {
        console.error('[ML Classifier V2] Failed to load model:', error);
        return null;
    }
}
/**
 * Convert class index to verdict
 */
function classIndexToVerdict(index) {
    const mapping = ['legit', 'spam', 'promotion', 'clean'];
    return mapping[index];
}
/**
 * Generate explanations based on feature values and verdict
 */
function generateExplanations(features, verdict, probabilities) {
    const explanations = [];
    if (verdict === 'spam') {
        if (features.spamKeywordsScore > 50) {
            explanations.push(`High spam keyword score (${features.spamKeywordsScore.toFixed(1)})`);
        }
        if (features.phishingScore > 50) {
            explanations.push(`Phishing indicators detected (${features.phishingScore.toFixed(1)})`);
        }
        if (features.urgencyIndicators > 3) {
            explanations.push(`Multiple urgency indicators (${features.urgencyIndicators})`);
        }
        if (features.domainReputation < -0.3) {
            explanations.push(`Poor domain reputation (${features.domainReputation.toFixed(2)})`);
        }
    }
    if (verdict === 'legit') {
        if (features.leadKeywordsScore > 30) {
            explanations.push(`Strong business inquiry indicators (${features.leadKeywordsScore.toFixed(1)})`);
        }
        if (features.questionCount >= 2) {
            explanations.push(`Contains ${features.questionCount} questions`);
        }
        if (features.previousInteraction > 0.5) {
            explanations.push(`Previous interaction with sender`);
        }
        if (features.domainReputation > 0.5) {
            explanations.push(`Good domain reputation (${features.domainReputation.toFixed(2)})`);
        }
    }
    // Add confidence-based explanation
    const maxProb = Math.max(probabilities.legit, probabilities.spam, probabilities.promotion, probabilities.clean);
    if (maxProb < 0.6) {
        explanations.push(`Moderate confidence classification`);
    }
    else if (maxProb > 0.9) {
        explanations.push(`High confidence classification`);
    }
    return explanations;
}
/**
 * Classify email using trained TensorFlow.js model
 */
async function classifyWithML(email, userId, options) {
    const { includeFeatureAnalysis = true, useCache = true, storeForTraining = false } = options || {};
    const cacheKey = `${email.subject}:${email.bodyText.substring(0, 100)}`;
    // Try cache first if enabled
    if (useCache) {
        const cached = await (0, redis_1.getFromCache)(redis_1.CacheKeys.mlClassification(cacheKey));
        if (cached) {
            console.log('[ML Classifier V2] Cache hit');
            return cached;
        }
    }
    try {
        // Extract features from email
        const features = await (0, ml_features_service_1.extractMLFeatures)(email, userId);
        // Load model
        const modelData = await getModel();
        if (!modelData) {
            // Fallback to simple heuristics if no model available
            console.warn('[ML Classifier V2] No model available, using fallback classification');
            return fallbackClassification(features);
        }
        // Prepare feature vector (ensure correct order)
        const featureVector = modelData.featureNames.map(name => features[name] || 0);
        // Run inference
        const input = tf.tensor2d([featureVector]);
        const prediction = modelData.model.predict(input);
        const probArray = await prediction.data();
        // Clean up tensors
        input.dispose();
        prediction.dispose();
        // Extract probabilities
        const probabilities = {
            legit: probArray[0],
            spam: probArray[1],
            promotion: probArray[2],
            clean: probArray[3],
        };
        // Determine verdict (argmax)
        const maxIndex = probArray.indexOf(Math.max(...Array.from(probArray)));
        const verdict = classIndexToVerdict(maxIndex);
        const confidence = probArray[maxIndex];
        // Generate explanations
        const explanations = includeFeatureAnalysis
            ? generateExplanations(features, verdict, probabilities)
            : [];
        const result = {
            verdict,
            confidence,
            explanations,
            probabilities,
            featuresUsed: modelData.featureNames,
            modelVersion: modelData.version,
        };
        // Cache for 30 minutes if enabled
        if (useCache) {
            await (0, redis_1.setInCache)(redis_1.CacheKeys.mlClassification(cacheKey), result, 1800);
        }
        // Store as training example if requested (for continuous learning)
        if (storeForTraining && email.id) {
            await (0, ml_training_service_1.storeTrainingExample)(userId, email.id, features, verdict, undefined, confidence, false);
        }
        return result;
    }
    catch (error) {
        console.error('[ML Classifier V2] Error:', error);
        // Fallback classification if ML fails
        const features = await (0, ml_features_service_1.extractMLFeatures)(email, userId);
        return fallbackClassification(features);
    }
}
/**
 * Fallback classification when no model is available
 */
function fallbackClassification(features) {
    // Simple heuristic-based classification
    let verdict = 'clean';
    let confidence = 0.5;
    if (features.spamKeywordsScore > 50 || features.phishingScore > 50) {
        verdict = 'spam';
        confidence = 0.7;
    }
    else if (features.leadKeywordsScore > 30) {
        verdict = 'legit';
        confidence = 0.6;
    }
    return {
        verdict,
        confidence,
        explanations: ['Fallback classification (no model available)'],
        probabilities: {
            legit: verdict === 'legit' ? confidence : 0.1,
            spam: verdict === 'spam' ? confidence : 0.1,
            promotion: verdict === 'promotion' ? confidence : 0.1,
            clean: verdict === 'clean' ? confidence : 0.7,
        },
        featuresUsed: [],
        modelVersion: 'fallback',
    };
}
/**
 * Reload model cache (call this after deploying a new model)
 */
async function reloadModelCache() {
    console.log('[ML Classifier V2] Reloading model cache...');
    // Dispose old model if exists
    if (cachedModel) {
        cachedModel.model.dispose();
        cachedModel = null;
    }
    // Force reload
    await getModel();
    console.log('[ML Classifier V2] Model cache reloaded');
}
/**
 * Update model with user feedback (for continuous learning)
 */
async function updateModelWithFeedback(email, userId, actualVerdict, predictedVerdict, confidence) {
    console.log(`[ML Classifier V2] Feedback: predicted ${predictedVerdict}, actual ${actualVerdict}${actualVerdict !== predictedVerdict ? ' (CORRECTED)' : ''}`);
    // Extract features
    const features = await (0, ml_features_service_1.extractMLFeatures)(email, userId);
    // Store as training example
    if (email.id) {
        await (0, ml_training_service_1.storeTrainingExample)(userId, email.id, features, actualVerdict, predictedVerdict, confidence, actualVerdict !== predictedVerdict // isCorrection
        );
    }
    // TODO: Trigger retraining if enough corrections accumulated
    // This will be handled by the auto-retraining scheduler
}
/**
 * Batch classify emails
 */
async function batchClassifyWithML(emails, userId) {
    console.log(`[ML Classifier V2] Batch classifying ${emails.length} emails...`);
    const modelData = await getModel();
    if (!modelData) {
        // Fallback: classify one by one
        const results = [];
        for (const email of emails) {
            results.push(await classifyWithML(email, userId));
        }
        return results;
    }
    // Extract all features
    const allFeatures = await Promise.all(emails.map(email => (0, ml_features_service_1.extractMLFeatures)(email, userId)));
    // Prepare feature matrix
    const featureMatrix = allFeatures.map(features => modelData.featureNames.map(name => features[name] || 0));
    // Batch inference
    const input = tf.tensor2d(featureMatrix);
    const predictions = modelData.model.predict(input);
    const probMatrix = await predictions.array();
    // Clean up
    input.dispose();
    predictions.dispose();
    // Convert to results
    const results = probMatrix.map((probs, i) => {
        const maxIndex = probs.indexOf(Math.max(...probs));
        const verdict = classIndexToVerdict(maxIndex);
        const confidence = probs[maxIndex];
        return {
            verdict,
            confidence,
            explanations: generateExplanations(allFeatures[i], verdict, {
                legit: probs[0],
                spam: probs[1],
                promotion: probs[2],
                clean: probs[3],
            }),
            probabilities: {
                legit: probs[0],
                spam: probs[1],
                promotion: probs[2],
                clean: probs[3],
            },
            featuresUsed: modelData.featureNames,
            modelVersion: modelData.version,
        };
    });
    console.log(`[ML Classifier V2] Batch classification completed`);
    return results;
}
