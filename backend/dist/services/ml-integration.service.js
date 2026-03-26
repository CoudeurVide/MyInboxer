"use strict";
/**
 * ML Integration Service
 * Connects existing classification system with new ML pipeline
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordUserFeedback = recordUserFeedback;
exports.classifyEmailML = classifyEmailML;
exports.initializeMLSystem = initializeMLSystem;
exports.getMLSystemStatus = getMLSystemStatus;
const ml_features_service_1 = require("./ml-features.service");
const ml_training_service_1 = require("./ml-training.service");
const ml_classifier_v2_service_1 = require("./ml-classifier-v2.service");
const prisma_1 = require("../lib/prisma");
/**
 * Store user feedback as training example
 * Call this when user corrects a classification
 */
async function recordUserFeedback(userId, messageId, userVerdict, originalVerdict, confidence) {
    console.log(`[ML Integration] Recording feedback: ${originalVerdict} → ${userVerdict} ` +
        `(${userVerdict !== originalVerdict ? 'CORRECTION' : 'CONFIRMATION'})`);
    try {
        // Get message details
        const message = await prisma_1.prisma.message.findUnique({
            where: { id: messageId },
            include: { mailbox: true },
        });
        if (!message) {
            console.warn(`[ML Integration] Message ${messageId} not found`);
            return;
        }
        // Convert message to ParsedEmail format
        const email = {
            id: message.id,
            messageId: message.provider_message_id,
            threadId: '', // Not available in current schema
            from: message.sender_name || message.sender_email,
            fromEmail: message.sender_email,
            to: message.recipient_email,
            subject: message.subject,
            bodyText: message.body_text,
            bodyHtml: message.body_html || '',
            date: message.received_at,
            labels: [],
            snippet: message.body_text.substring(0, 200),
            mailboxId: message.mailbox_id,
        };
        // Extract features
        const features = await (0, ml_features_service_1.extractMLFeatures)(email, userId);
        // Store as training example
        await (0, ml_training_service_1.storeTrainingExample)(userId, messageId, features, userVerdict, originalVerdict, confidence, userVerdict !== originalVerdict // isCorrection
        );
        // Update model with feedback (for continuous learning tracking)
        await (0, ml_classifier_v2_service_1.updateModelWithFeedback)(email, userId, userVerdict, originalVerdict, confidence);
        console.log(`[ML Integration] ✅ Feedback stored successfully`);
    }
    catch (error) {
        console.error('[ML Integration] Failed to record feedback:', error);
        // Don't throw - feedback recording shouldn't break the main flow
    }
}
/**
 * Classify email using ML (wrapper for easy integration)
 */
async function classifyEmailML(email, userId, options) {
    const { storeForTraining = false, useCache = true } = options || {};
    try {
        const result = await (0, ml_classifier_v2_service_1.classifyWithML)(email, userId, {
            includeFeatureAnalysis: true,
            useCache,
            storeForTraining,
        });
        return {
            verdict: result.verdict,
            confidence: result.confidence,
            reason: result.explanations.join('; ') || 'ML classification',
            mlUsed: true,
        };
    }
    catch (error) {
        console.error('[ML Integration] ML classification failed:', error);
        // Fallback to default classification
        return {
            verdict: 'clean',
            confidence: 0.3,
            reason: 'ML classification failed, using fallback',
            mlUsed: false,
        };
    }
}
/**
 * Initialize ML system (call on app startup)
 */
async function initializeMLSystem() {
    console.log('[ML Integration] Initializing ML system...');
    try {
        // Check if we have a deployed model
        const deployedModel = await prisma_1.prisma.mLModel.findFirst({
            where: { status: 'deployed' },
            orderBy: { created_at: 'desc' },
        });
        if (deployedModel) {
            console.log(`[ML Integration] ✅ Deployed model found: ${deployedModel.version}`);
            console.log(`[ML Integration]    - Accuracy: ${(deployedModel.accuracy || 0) * 100}%`);
            console.log(`[ML Integration]    - Lead Recall: ${(deployedModel.recall_lead || 0) * 100}%`);
        }
        else {
            console.log('[ML Integration] ⚠️  No deployed model found');
            // Check if we have enough training data
            const exampleCount = await prisma_1.prisma.trainingExample.count({
                where: { is_validated: true },
            });
            if (exampleCount >= 100) {
                console.log(`[ML Integration] 💡 ${exampleCount} training examples available ` +
                    `- ready to train first model!`);
                console.log('[ML Integration] 💡 Run: POST /api/ml/train to train first model');
            }
            else {
                console.log(`[ML Integration] 📊 Only ${exampleCount}/100 training examples ` +
                    `- need more user feedback before training`);
            }
        }
        // Check training jobs status
        const runningJobs = await prisma_1.prisma.mLTrainingJob.count({
            where: { status: { in: ['pending', 'running'] } },
        });
        if (runningJobs > 0) {
            console.log(`[ML Integration] 🏃 ${runningJobs} training job(s) in progress`);
        }
        console.log('[ML Integration] ✅ ML system initialized');
    }
    catch (error) {
        console.error('[ML Integration] ❌ Failed to initialize ML system:', error);
    }
}
/**
 * Get ML system status (for health checks)
 */
async function getMLSystemStatus() {
    const [deployedModel, exampleCount, runningJobs] = await Promise.all([
        prisma_1.prisma.mLModel.findFirst({ where: { status: 'deployed' } }),
        prisma_1.prisma.trainingExample.count({ where: { is_validated: true } }),
        prisma_1.prisma.mLTrainingJob.count({ where: { status: { in: ['pending', 'running'] } } }),
    ]);
    return {
        hasDeployedModel: !!deployedModel,
        trainingExamples: exampleCount,
        readyForTraining: exampleCount >= 100,
        runningJobs,
    };
}
