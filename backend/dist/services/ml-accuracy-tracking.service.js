"use strict";
/**
 * ML Accuracy Tracking Service
 * Tracks real model performance from user feedback
 * Phase 1: Real Accuracy Tracking (not placeholders!)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeRealAccuracy = computeRealAccuracy;
exports.recordAccuracyMetrics = recordAccuracyMetrics;
exports.getAccuracyTrend = getAccuracyTrend;
exports.checkAccuracyDrop = checkAccuracyDrop;
const prisma_1 = require("../lib/prisma");
/**
 * Compute real accuracy metrics from actual user feedback
 * This replaces the placeholder getModelMetrics() function
 */
async function computeRealAccuracy(modelId, sinceDate) {
    console.log('[Accuracy Tracking] Computing real accuracy metrics...');
    // Get all messages with user verdicts (feedback)
    const messages = await prisma_1.prisma.message.findMany({
        where: {
            user_verdict: { not: null },
            created_at: sinceDate ? { gte: sinceDate } : undefined,
        },
        select: {
            verdict: true,
            user_verdict: true,
            confidence_score: true,
            created_at: true,
        },
    });
    console.log(`[Accuracy Tracking] Found ${messages.length} messages with user feedback`);
    if (messages.length === 0) {
        return getDefaultMetrics();
    }
    // ============================================================================
    // Overall Accuracy
    // ============================================================================
    const correctPredictions = messages.filter(m => m.verdict === m.user_verdict).length;
    const accuracy = correctPredictions / messages.length;
    const userCorrections = messages.filter(m => m.verdict !== m.user_verdict).length;
    // ============================================================================
    // Per-Verdict Metrics (Precision, Recall, F1)
    // ============================================================================
    const verdicts = ['legit', 'spam', 'promotion', 'clean'];
    const byVerdict = {};
    for (const verdict of verdicts) {
        // True Positives: predicted as verdict AND user confirmed
        const tp = messages.filter(m => m.verdict === verdict && m.user_verdict === verdict).length;
        // False Positives: predicted as verdict BUT user said otherwise
        const fp = messages.filter(m => m.verdict === verdict && m.user_verdict !== verdict).length;
        // False Negatives: NOT predicted as verdict BUT user said it should be
        const fn = messages.filter(m => m.verdict !== verdict && m.user_verdict === verdict).length;
        // True Negatives: correctly predicted as NOT verdict
        const tn = messages.filter(m => m.verdict !== verdict && m.user_verdict !== verdict).length;
        const totalPredicted = tp + fp;
        const precision = totalPredicted > 0 ? tp / totalPredicted : 0;
        const recall = (tp + fn) > 0 ? tp / (tp + fn) : 0;
        const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
        const verdictAccuracy = (tp + tn) / messages.length;
        byVerdict[verdict] = {
            accuracy: verdictAccuracy,
            precision,
            recall,
            f1,
            totalPredicted,
            correctPredictions: tp,
            falsePositives: fp,
            falseNegatives: fn,
        };
    }
    // ============================================================================
    // Confidence Calibration
    // ============================================================================
    const confidenceRanges = ['0.0-0.5', '0.5-0.6', '0.6-0.7', '0.7-0.8', '0.8-0.9', '0.9-1.0'];
    const actualAccuracyAtConfidence = {};
    for (const range of confidenceRanges) {
        const [min, max] = range.split('-').map(parseFloat);
        const messagesInRange = messages.filter(m => m.confidence_score >= min && m.confidence_score < max);
        if (messagesInRange.length > 0) {
            const correctInRange = messagesInRange.filter(m => m.verdict === m.user_verdict).length;
            const avgConfidence = messagesInRange.reduce((sum, m) => sum + m.confidence_score, 0) / messagesInRange.length;
            const actualAccuracy = correctInRange / messagesInRange.length;
            actualAccuracyAtConfidence[range] = {
                predictedConf: avgConfidence,
                actualAcc: actualAccuracy,
                count: messagesInRange.length,
            };
        }
    }
    // Compute calibration error (mean absolute difference)
    const calibrationError = Object.values(actualAccuracyAtConfidence).reduce((sum, { predictedConf, actualAcc, count }) => {
        return sum + Math.abs(predictedConf - actualAcc) * count;
    }, 0) / messages.length;
    const avgPredictedConfidence = messages.reduce((sum, m) => sum + m.confidence_score, 0) / messages.length;
    // ============================================================================
    // Recent Trend
    // ============================================================================
    const now = new Date();
    const last7DaysMessages = messages.filter(m => m.created_at >= new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000));
    const last7DaysAccuracy = last7DaysMessages.length > 0
        ? last7DaysMessages.filter(m => m.verdict === m.user_verdict).length / last7DaysMessages.length
        : accuracy;
    const last30DaysMessages = messages.filter(m => m.created_at >= new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000));
    const last30DaysAccuracy = last30DaysMessages.length > 0
        ? last30DaysMessages.filter(m => m.verdict === m.user_verdict).length / last30DaysMessages.length
        : accuracy;
    const last90DaysMessages = messages.filter(m => m.created_at >= new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000));
    const last90DaysAccuracy = last90DaysMessages.length > 0
        ? last90DaysMessages.filter(m => m.verdict === m.user_verdict).length / last90DaysMessages.length
        : accuracy;
    // ============================================================================
    // Return Metrics
    // ============================================================================
    const metrics = {
        overall: {
            accuracy,
            totalPredictions: messages.length,
            correctPredictions,
            userCorrections,
        },
        byVerdict,
        confidenceCalibration: {
            avgPredictedConfidence,
            actualAccuracyAtConfidence,
            calibrationError,
        },
        recentTrend: {
            last7Days: last7DaysAccuracy,
            last30Days: last30DaysAccuracy,
            last90Days: last90DaysAccuracy,
        },
        lastUpdated: new Date(),
    };
    console.log('[Accuracy Tracking] Metrics computed:', {
        overallAccuracy: `${(accuracy * 100).toFixed(2)}%`,
        totalPredictions: messages.length,
        corrections: userCorrections,
        calibrationError: calibrationError.toFixed(3),
    });
    return metrics;
}
/**
 * Get default metrics when no data available
 */
function getDefaultMetrics() {
    return {
        overall: {
            accuracy: 0,
            totalPredictions: 0,
            correctPredictions: 0,
            userCorrections: 0,
        },
        byVerdict: {
            legit: {
                accuracy: 0,
                precision: 0,
                recall: 0,
                f1: 0,
                totalPredicted: 0,
                correctPredictions: 0,
                falsePositives: 0,
                falseNegatives: 0,
            },
            spam: {
                accuracy: 0,
                precision: 0,
                recall: 0,
                f1: 0,
                totalPredicted: 0,
                correctPredictions: 0,
                falsePositives: 0,
                falseNegatives: 0,
            },
            promotion: {
                accuracy: 0,
                precision: 0,
                recall: 0,
                f1: 0,
                totalPredicted: 0,
                correctPredictions: 0,
                falsePositives: 0,
                falseNegatives: 0,
            },
            clean: {
                accuracy: 0,
                precision: 0,
                recall: 0,
                f1: 0,
                totalPredicted: 0,
                correctPredictions: 0,
                falsePositives: 0,
                falseNegatives: 0,
            },
        },
        confidenceCalibration: {
            avgPredictedConfidence: 0,
            actualAccuracyAtConfidence: {},
            calibrationError: 0,
        },
        recentTrend: {
            last7Days: 0,
            last30Days: 0,
            last90Days: 0,
        },
        lastUpdated: new Date(),
    };
}
/**
 * Track accuracy over time and store in database
 */
async function recordAccuracyMetrics(modelId, userId) {
    const metrics = await computeRealAccuracy(modelId);
    const periodStart = new Date();
    periodStart.setHours(0, 0, 0, 0);
    const periodEnd = new Date();
    periodEnd.setHours(23, 59, 59, 999);
    // Store in database
    await prisma_1.prisma.modelMetrics.create({
        data: {
            model_id: modelId,
            user_id: userId || null,
            period_start: periodStart,
            period_end: periodEnd,
            total_predictions: metrics.overall.totalPredictions,
            total_feedback: metrics.overall.userCorrections + metrics.overall.correctPredictions,
            correct_predictions: metrics.overall.correctPredictions,
            accuracy: metrics.overall.accuracy,
            precision: (metrics.byVerdict.legit.precision + metrics.byVerdict.spam.precision) / 2,
            recall: (metrics.byVerdict.legit.recall + metrics.byVerdict.spam.recall) / 2,
            f1_score: (metrics.byVerdict.legit.f1 + metrics.byVerdict.spam.f1) / 2,
            avg_confidence: metrics.confidenceCalibration.avgPredictedConfidence,
            calibration_error: metrics.confidenceCalibration.calibrationError,
        },
    });
    console.log(`[Accuracy Tracking] Recorded metrics for model ${modelId}`);
}
/**
 * Get accuracy trend over time
 */
async function getAccuracyTrend(modelId, days = 30) {
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - days);
    const metrics = await prisma_1.prisma.modelMetrics.findMany({
        where: {
            model_id: modelId,
            period_start: { gte: sinceDate },
        },
        orderBy: { period_start: 'asc' },
        select: {
            period_start: true,
            accuracy: true,
            total_predictions: true,
        },
    });
    return metrics.map(m => ({
        date: m.period_start,
        accuracy: m.accuracy || 0,
        predictions: m.total_predictions,
    }));
}
/**
 * Check if accuracy has dropped significantly (for alerts)
 */
async function checkAccuracyDrop(modelId, threshold = 0.05) {
    // Get baseline (last 30 days average)
    const baseline = await computeRealAccuracy(modelId, new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
    // Get recent (last 7 days)
    const recent = await computeRealAccuracy(modelId, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000));
    const drop = baseline.overall.accuracy - recent.overall.accuracy;
    return {
        hasDropped: drop > threshold,
        currentAccuracy: recent.overall.accuracy,
        baselineAccuracy: baseline.overall.accuracy,
    };
}
