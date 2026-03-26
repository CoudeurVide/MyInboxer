"use strict";
/**
 * ML Classifier Service
 * Main machine learning classification using TensorFlow.js or similar approach
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyWithML = classifyWithML;
exports.trainModel = trainModel;
exports.updateModelWithFeedback = updateModelWithFeedback;
exports.getModelMetrics = getModelMetrics;
exports.integrateMLIntoClassification = integrateMLIntoClassification;
const ml_features_service_1 = require("./ml-features.service");
const redis_1 = require("../lib/redis");
/**
 * Load the ML model
 * In a real implementation, this would load from storage or CDN
 */
async function loadModel() {
    // Try cache first
    const cached = await (0, redis_1.getFromCache)(redis_1.CacheKeys.mlModel());
    if (cached) {
        return cached;
    }
    // Default model with learned weights (these would be from actual training)
    const model = {
        weights: {
            // Text features
            subjectLength: 0.01,
            bodyLength: 0.005,
            wordCount: 0.02,
            uniqueWordRatio: 0.1,
            uppercaseRatio: -0.2, // High uppercase often indicates spam
            linkCount: -0.05, // Many links might be spammy
            exclamationCount: -0.3, // Too many exclamations = spam
            questionCount: -0.1,
            dollarSignCount: -0.4, // Money mentions often spam
            capitalLetterDensity: -0.15,
            punctuationDensity: -0.1,
            // Sender features
            domainAge: 0.05, // Older domains more trusted
            domainReputation: 0.8, // Domain reputation is very important
            senderHasProfilePicture: 0.2,
            senderNameLength: 0.02,
            senderEmailLength: -0.03, // Very long emails might be auto-generated
            // Behavioral features
            timeOfDay: -0.05, // Late night/few emails might be suspicious
            dayOfWeek: -0.02,
            threadLength: 0.15, // Longer threads = more legitimate
            previousInteraction: 0.4, // Previous interaction = more trusted
            replyToPrevious: 0.3,
            // Phase 2 features
            phishingScore: -0.9, // Phishing score is very predictive
            attachmentRisk: -0.6,
            threatIntelScore: -0.7,
            urlReputationScore: 0.2, // Good URLs are positive
            // Custom list features
            onUserBlacklist: -0.95, // User blacklist means definitely spam
            onUserWhitelist: 0.95, // User whitelist means definitely clean
            onGlobalBlacklist: -0.85,
            // Heuristic scores
            spamKeywordsScore: -0.8,
            leadKeywordsScore: 0.8,
            urgencyIndicators: -0.6,
        },
        thresholds: {
            legit: 0.5,
            spam: -0.3,
            promotion: 0.1,
            clean: 0.2,
        },
        bias: 0.1,
    };
    // Cache for 1 hour
    await (0, redis_1.setInCache)(redis_1.CacheKeys.mlModel(), model, 3600);
    return model;
}
/**
 * Calculate classification scores based on features and model weights
 */
function calculateScores(features, model) {
    let legitScore = model.bias;
    let spamScore = model.bias;
    let promotionScore = model.bias;
    let cleanScore = model.bias;
    // Apply feature weights
    for (const [featureName, featureValue] of Object.entries(features)) {
        const weight = model.weights[featureName];
        if (weight !== undefined) {
            const weightedValue = weight * featureValue;
            legitScore += weightedValue;
            spamScore += weightedValue;
            promotionScore += weightedValue;
            cleanScore += weightedValue;
        }
    }
    // Apply specific adjustments for each category
    // These would be learned in a real ML model but coded here as examples
    if (features.phishingScore > 50) {
        spamScore += 0.5;
        legitScore -= 0.5;
    }
    if (features.leadKeywordsScore > 30) {
        legitScore += 0.3;
        spamScore -= 0.2;
    }
    if (features.spamKeywordsScore > 50) {
        spamScore += 0.4;
        legitScore -= 0.4;
    }
    if (features.domainReputation > 0.5) {
        cleanScore += 0.2;
        legitScore += 0.1;
    }
    else if (features.domainReputation < -0.5) {
        spamScore += 0.3;
    }
    // Normalize scores to probabilities
    const total = Math.abs(legitScore) + Math.abs(spamScore) + Math.abs(promotionScore) + Math.abs(cleanScore);
    return {
        legit: total > 0 ? Math.abs(legitScore) / total : 0,
        spam: total > 0 ? Math.abs(spamScore) / total : 0,
        promotion: total > 0 ? Math.abs(promotionScore) / total : 0,
        clean: total > 0 ? Math.abs(cleanScore) / total : 0,
    };
}
/**
 * Classify email using ML model
 */
async function classifyWithML(email, userId, options) {
    const { includeFeatureAnalysis = true, useCache = true } = options || {};
    const cacheKey = `${email.subject}:${email.bodyText.substring(0, 100)}`;
    // Try cache first if enabled
    if (useCache) {
        const cached = await (0, redis_1.getFromCache)(redis_1.CacheKeys.mlClassification(cacheKey));
        if (cached) {
            return cached;
        }
    }
    try {
        // Extract features from email
        const features = await (0, ml_features_service_1.extractMLFeatures)(email, userId);
        // Load model
        const model = await loadModel();
        // Calculate scores
        const scores = calculateScores(features, model);
        // Determine verdict based on highest probability
        let verdict = 'clean';
        let maxConfidence = 0;
        for (const [category, confidence] of Object.entries(scores)) {
            if (confidence > maxConfidence) {
                maxConfidence = confidence;
                verdict = category;
            }
        }
        // Ensure minimum confidence threshold
        const confidence = Math.max(0.5, maxConfidence); // Use minimum 50% confidence
        // Generate explanations
        const explanations = [];
        if (includeFeatureAnalysis) {
            if (verdict === 'spam' && features.spamKeywordsScore > 30) {
                explanations.push(`Contains spam keywords (score: ${features.spamKeywordsScore.toFixed(1)})`);
            }
            if (verdict === 'legit' && features.leadKeywordsScore > 20) {
                explanations.push(`Contains legit indicators (score: ${features.leadKeywordsScore.toFixed(1)})`);
            }
            if (features.phishingScore > 50) {
                explanations.push(`Flagged by community phishing reports (score: ${features.phishingScore.toFixed(1)})`);
            }
            if (features.domainReputation < -0.3) {
                explanations.push(`Domain reputation is poor (${features.domainReputation.toFixed(2)})`);
            }
        }
        const result = {
            verdict,
            confidence,
            explanations,
            probabilities: {
                legit: scores.legit,
                spam: scores.spam,
                promotion: scores.promotion,
                clean: scores.clean,
            },
            featuresUsed: Object.keys(features),
        };
        // Cache for 30 minutes if enabled
        if (useCache) {
            await (0, redis_1.setInCache)(redis_1.CacheKeys.mlClassification(cacheKey), result, 1800);
        }
        return result;
    }
    catch (error) {
        console.error('[ML Classifier] Error:', error);
        // Fallback classification if ML model fails
        return {
            verdict: 'clean', // Conservative fallback
            confidence: 0.1, // Low confidence for fallback
            explanations: ['ML model failed, using fallback classification'],
            probabilities: {
                legit: 0.1,
                spam: 0.1,
                promotion: 0.1,
                clean: 0.7,
            },
            featuresUsed: [],
        };
    }
}
/**
 * Train the ML model with new examples
 */
async function trainModel(trainingData) {
    // In a real implementation, this would:
    // 1. Accumulate training examples
    // 2. Periodically retrain a model using TensorFlow.js
    // 3. Evaluate on test set
    // 4. Deploy if meets accuracy threshold
    console.log(`[ML Trainer] Processing ${trainingData.length} training examples`);
    // Simulate training process
    try {
        // This is where actual model training would happen
        // For now, we'll just log the data
        const counts = {
            legit: 0,
            spam: 0,
            promotion: 0,
            clean: 0,
        };
        trainingData.forEach(item => {
            counts[item.label]++;
        });
        console.log(`[ML Trainer] Training data distribution:`, counts);
        // In a real system, this is where we'd update our model weights
        return {
            success: true,
            message: `Processed ${trainingData.length} training examples`,
        };
    }
    catch (error) {
        console.error('[ML Trainer] Error during training:', error);
        return {
            success: false,
            message: `Training failed: ${error.message}`,
        };
    }
}
/**
 * Update model with user feedback
 */
async function updateModelWithFeedback(emailId, actualVerdict, predictedVerdict) {
    // Log feedback for future model improvement
    console.log(`[ML Feedback] Email ${emailId}: predicted ${predictedVerdict}, actual ${actualVerdict}${actualVerdict !== predictedVerdict ? ' (CORRECTED)' : ''}`);
    // In a real implementation, this would:
    // 1. Store the feedback example
    // 2. Potentially trigger model retraining when enough feedback collected
    // 3. Adjust model weights based on feedback
}
/**
 * Get model performance metrics
 */
async function getModelMetrics() {
    // Placeholder implementation 
    // In a real system, this would calculate metrics based on evaluation data
    return {
        accuracy: 0.85, // 85% placeholder accuracy
        precision: {
            legit: 0.82,
            spam: 0.88,
            promotion: 0.80,
            clean: 0.85,
        },
        recall: {
            legit: 0.79,
            spam: 0.90,
            promotion: 0.78,
            clean: 0.84,
        },
        f1Score: {
            legit: 0.80,
            spam: 0.89,
            promotion: 0.79,
            clean: 0.84,
        },
        totalClassifications: 10000, // Placeholder value
        lastTrained: new Date(Date.now() - 24 * 60 * 60 * 1000), // 1 day ago
    };
}
/**
 * Integrate ML classification into main classification pipeline
 */
async function integrateMLIntoClassification(email, userId, options) {
    const { ruleBasedResult, useMLOverride = true, mlConfidenceThreshold = 0.7 } = options || {};
    // Perform ML classification
    const mlResult = await classifyWithML(email, userId);
    // Decide whether to use ML result or rule-based
    let verdict = ruleBasedResult?.verdict || 'clean';
    let confidence = ruleBasedResult?.confidence || 0.5;
    let reason = ruleBasedResult?.reason || 'Rule-based classification';
    // If ML confidence is high enough, use ML result
    if (mlResult.confidence >= mlConfidenceThreshold) {
        verdict = mlResult.verdict;
        confidence = mlResult.confidence;
        reason = `ML classification: ${mlResult.explanations.join('; ') || 'Machine learned classification'}`;
    }
    else if (useMLOverride && mlResult.confidence > (ruleBasedResult?.confidence || 0)) {
        // Use ML if it's more confident than rule-based, even if below threshold
        verdict = mlResult.verdict;
        confidence = mlResult.confidence;
        reason = `ML classification: ${mlResult.explanations.join('; ') || 'Machine learned classification'}`;
    }
    // If rule-based classification is much more confident than ML, stick with it
    if (ruleBasedResult && ruleBasedResult.confidence > mlResult.confidence + 0.2) {
        verdict = ruleBasedResult.verdict;
        confidence = ruleBasedResult.confidence;
        reason = ruleBasedResult.reason;
    }
    return {
        verdict,
        confidence,
        reason,
        mlAnalysis: mlResult,
    };
}
