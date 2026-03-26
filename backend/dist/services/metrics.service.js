"use strict";
/**
 * Metrics Collection Service
 * Tracks classification events and system performance for analytics
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.trackClassification = trackClassification;
exports.trackFeedback = trackFeedback;
exports.getDailyMetrics = getDailyMetrics;
exports.getAccuracyMetrics = getAccuracyMetrics;
exports.getSummaryStats = getSummaryStats;
const prisma_1 = require("../lib/prisma");
const redis_1 = require("../lib/redis");
/**
 * Track a classification event
 */
async function trackClassification(metric) {
    try {
        // Store in database for historical analysis
        // For now, we'll aggregate metrics instead of storing individual events
        // to avoid database bloat
        // Update daily aggregates
        const date = new Date(metric.timestamp);
        date.setHours(0, 0, 0, 0);
        const cacheKey = `metrics:daily:${metric.userId}:${date.toISOString()}`;
        // Get or initialize daily metrics
        let dailyMetrics = await (0, redis_1.getFromCache)(cacheKey);
        if (!dailyMetrics) {
            dailyMetrics = {
                userId: metric.userId,
                date: date.toISOString(),
                total: 0,
                byVerdict: {
                    legit: 0,
                    spam: 0,
                    promotion: 0,
                    clean: 0,
                },
                processingTimes: [],
                aiUsedCount: 0,
                threatsDetected: 0,
            };
        }
        // Update metrics
        dailyMetrics.total++;
        dailyMetrics.byVerdict[metric.verdict]++;
        dailyMetrics.processingTimes.push(metric.processingTime);
        if (metric.aiUsed)
            dailyMetrics.aiUsedCount++;
        if (metric.threatDetected)
            dailyMetrics.threatsDetected++;
        // Cache for 24 hours
        await (0, redis_1.setInCache)(cacheKey, dailyMetrics, 86400);
        // Also update real-time stats (shorter TTL)
        const realtimeKey = `metrics:realtime:${metric.userId}`;
        await (0, redis_1.setInCache)(realtimeKey, {
            lastClassification: metric.timestamp,
            recentVerdict: metric.verdict,
            recentConfidence: metric.confidence,
        }, 3600);
    }
    catch (error) {
        console.error('[Metrics] ❌❌❌ FAILED TO TRACK CLASSIFICATION ❌❌❌');
        console.error('[Metrics] Error details:', error);
        // Don't throw - metrics tracking shouldn't break classification
    }
}
/**
 * Track user feedback on classification
 */
async function trackFeedback(metric) {
    try {
        const date = new Date(metric.timestamp);
        date.setHours(0, 0, 0, 0);
        const cacheKey = `metrics:feedback:${metric.userId}:${date.toISOString()}`;
        let feedbackMetrics = await (0, redis_1.getFromCache)(cacheKey);
        if (!feedbackMetrics) {
            feedbackMetrics = {
                userId: metric.userId,
                date: date.toISOString(),
                totalFeedback: 0,
                correct: 0,
                corrections: {
                    legit: { toSpam: 0, toPromo: 0, toClean: 0 },
                    spam: { toLegit: 0, toPromo: 0, toClean: 0 },
                    promotion: { toLegit: 0, toSpam: 0, toClean: 0 },
                    clean: { toLegit: 0, toSpam: 0, toPromo: 0 },
                },
            };
        }
        feedbackMetrics.totalFeedback++;
        if (metric.wasCorrect) {
            feedbackMetrics.correct++;
        }
        else {
            // Track correction pattern
            const from = metric.originalVerdict;
            const to = metric.userVerdict;
            if (from === 'legit') {
                if (to === 'spam')
                    feedbackMetrics.corrections.legit.toSpam++;
                else if (to === 'promotion')
                    feedbackMetrics.corrections.legit.toPromo++;
                else if (to === 'clean')
                    feedbackMetrics.corrections.legit.toClean++;
            }
            else if (from === 'spam') {
                if (to === 'legit')
                    feedbackMetrics.corrections.spam.toLegit++;
                else if (to === 'promotion')
                    feedbackMetrics.corrections.spam.toPromo++;
                else if (to === 'clean')
                    feedbackMetrics.corrections.spam.toClean++;
            }
            else if (from === 'promotion') {
                if (to === 'legit')
                    feedbackMetrics.corrections.promotion.toLegit++;
                else if (to === 'spam')
                    feedbackMetrics.corrections.promotion.toSpam++;
                else if (to === 'clean')
                    feedbackMetrics.corrections.promotion.toClean++;
            }
            else if (from === 'clean') {
                if (to === 'legit')
                    feedbackMetrics.corrections.clean.toLegit++;
                else if (to === 'spam')
                    feedbackMetrics.corrections.clean.toSpam++;
                else if (to === 'promotion')
                    feedbackMetrics.corrections.clean.toPromo++;
            }
        }
        // Cache for 24 hours
        await (0, redis_1.setInCache)(cacheKey, feedbackMetrics, 86400);
    }
    catch (error) {
        console.error('[Metrics] Failed to track feedback:', error);
    }
}
/**
 * Get daily metrics for a user
 */
async function getDailyMetrics(userId, startDate, endDate) {
    try {
        const metrics = [];
        const currentDate = new Date(startDate);
        console.log(`[Metrics] getDailyMetrics - userId: ${userId}, range: ${startDate} to ${endDate}`);
        while (currentDate <= endDate) {
            const date = new Date(currentDate);
            date.setHours(0, 0, 0, 0);
            const cacheKey = `metrics:daily:${userId}:${date.toISOString()}`;
            let dailyMetric = await (0, redis_1.getFromCache)(cacheKey);
            // If no cache, fall back to database query
            if (!dailyMetric) {
                const dayStart = new Date(date);
                dayStart.setHours(0, 0, 0, 0);
                const dayEnd = new Date(date);
                dayEnd.setHours(23, 59, 59, 999);
                // Query messages for this day
                const messages = await prisma_1.prisma.message.findMany({
                    where: {
                        mailbox: {
                            user_id: userId,
                        },
                        received_at: {
                            gte: dayStart,
                            lte: dayEnd,
                        },
                    },
                    select: {
                        verdict: true,
                        confidence_score: true,
                    },
                });
                if (messages.length > 0) {
                    // Build metric from database
                    const verdictCounts = messages.reduce((acc, msg) => {
                        acc[msg.verdict] = (acc[msg.verdict] || 0) + 1;
                        return acc;
                    }, {});
                    dailyMetric = {
                        total: messages.length,
                        byVerdict: {
                            legit: verdictCounts.legit || 0,
                            spam: verdictCounts.spam || 0,
                            promotion: verdictCounts.promotion || 0,
                            clean: verdictCounts.clean || 0,
                        },
                        processingTimes: [],
                        aiUsedCount: messages.length, // Assume all used AI
                        threatsDetected: verdictCounts.spam || 0,
                    };
                    // Cache for future requests (24 hours)
                    await (0, redis_1.setInCache)(cacheKey, dailyMetric, 86400);
                }
            }
            if (dailyMetric) {
                // Calculate derived metrics
                const processingTimes = dailyMetric.processingTimes || [];
                const avgProcessingTime = processingTimes.length > 0
                    ? processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length
                    : 0;
                metrics.push({
                    date: date.toISOString().split('T')[0],
                    total: dailyMetric.total,
                    spam: dailyMetric.byVerdict.spam,
                    promotions: dailyMetric.byVerdict.promotion,
                    important: dailyMetric.byVerdict.legit, // Frontend uses "important"
                    clean: dailyMetric.byVerdict.clean,
                    avgProcessingTime: Math.round(avgProcessingTime),
                    aiUsageRate: dailyMetric.total > 0
                        ? (dailyMetric.aiUsedCount / dailyMetric.total) * 100
                        : 0,
                    threatsDetected: dailyMetric.threatsDetected,
                });
            }
            else {
                // Return zeros for days with no data
                metrics.push({
                    date: date.toISOString().split('T')[0],
                    total: 0,
                    spam: 0,
                    promotions: 0,
                    important: 0,
                    clean: 0,
                    avgProcessingTime: 0,
                    aiUsageRate: 0,
                    threatsDetected: 0,
                });
            }
            currentDate.setDate(currentDate.getDate() + 1);
        }
        return metrics;
    }
    catch (error) {
        console.error('[Metrics] Failed to get daily metrics:', error);
        return [];
    }
}
/**
 * Get accuracy metrics from feedback
 */
async function getAccuracyMetrics(userId, startDate, endDate) {
    try {
        let totalFeedback = 0;
        let totalCorrect = 0;
        const categoryCorrect = {
            legit: 0,
            spam: 0,
            promotion: 0,
            clean: 0,
        };
        const categoryTotal = {
            legit: 0,
            spam: 0,
            promotion: 0,
            clean: 0,
        };
        const currentDate = new Date(startDate);
        while (currentDate <= endDate) {
            const date = new Date(currentDate);
            date.setHours(0, 0, 0, 0);
            const cacheKey = `metrics:feedback:${userId}:${date.toISOString()}`;
            const feedbackMetric = await (0, redis_1.getFromCache)(cacheKey);
            if (feedbackMetric) {
                totalFeedback += feedbackMetric.totalFeedback;
                totalCorrect += feedbackMetric.correct;
                // For category accuracy, we need to track from messages table
                // This is a simplified version - real implementation would query the database
            }
            currentDate.setDate(currentDate.getDate() + 1);
        }
        const overallAccuracy = totalFeedback > 0
            ? (totalCorrect / totalFeedback) * 100
            : 0;
        return {
            overall: Math.round(overallAccuracy * 100) / 100,
            byCategory: {
                legit: 92, // Placeholder - would calculate from actual data
                spam: 94, // Placeholder
                promotion: 89, // Placeholder
                clean: 88, // Placeholder
            },
            totalFeedback,
        };
    }
    catch (error) {
        console.error('[Metrics] Failed to get accuracy metrics:', error);
        return {
            overall: 0,
            byCategory: { legit: 0, spam: 0, promotion: 0, clean: 0 },
            totalFeedback: 0,
        };
    }
}
/**
 * Get summary statistics
 */
async function getSummaryStats(userId, startDate, endDate) {
    try {
        const dailyMetrics = await getDailyMetrics(userId, startDate, endDate);
        const summary = dailyMetrics.reduce((acc, day) => ({
            totalEmails: acc.totalEmails + day.total,
            spamEmails: acc.spamEmails + day.spam,
            promoEmails: acc.promoEmails + day.promotions,
            legitEmails: acc.legitEmails + day.important,
            savedEmails: acc.savedEmails + day.important,
            totalProcessingTime: acc.totalProcessingTime + (day.avgProcessingTime * day.total),
            totalClassifications: acc.totalClassifications + day.total,
            threatsBlocked: acc.threatsBlocked + day.threatsDetected,
        }), {
            totalEmails: 0,
            spamEmails: 0,
            promoEmails: 0,
            legitEmails: 0,
            savedEmails: 0,
            totalProcessingTime: 0,
            totalClassifications: 0,
            threatsBlocked: 0,
        });
        return {
            totalEmails: summary.totalEmails,
            spamEmails: summary.spamEmails,
            promoEmails: summary.promoEmails,
            legitEmails: summary.legitEmails,
            savedEmails: summary.savedEmails,
            avgProcessingTime: summary.totalClassifications > 0
                ? Math.round(summary.totalProcessingTime / summary.totalClassifications)
                : 0,
            threatsBlocked: summary.threatsBlocked,
        };
    }
    catch (error) {
        console.error('[Metrics] Failed to get summary stats:', error);
        return {
            totalEmails: 0,
            spamEmails: 0,
            promoEmails: 0,
            legitEmails: 0,
            savedEmails: 0,
            avgProcessingTime: 0,
            threatsBlocked: 0,
        };
    }
}
