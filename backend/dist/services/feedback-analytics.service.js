"use strict";
/**
 * Enhanced Feedback Analytics Service
 * Phase 3A: Real-time analytics, dynamic threshold adjustment, and personalization
 *
 * This service provides:
 * - Real-time classification performance analytics
 * - Dynamic threshold recommendations based on user feedback
 * - Per-user personalization profiles
 * - Bulk feedback processing
 * - Trend analysis and insights
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateFeedbackAnalytics = generateFeedbackAnalytics;
exports.buildPersonalizationProfile = buildPersonalizationProfile;
exports.processBulkFeedback = processBulkFeedback;
exports.applyRecommendedThresholds = applyRecommendedThresholds;
const prisma_1 = require("../lib/prisma");
const redis_1 = require("../lib/redis");
/**
 * Generate comprehensive feedback analytics for a user
 */
async function generateFeedbackAnalytics(userId, options = {}) {
    const { cacheTTL = 300, sinceDate } = options;
    // Try cache first
    const cacheKey = `feedbackAnalytics:${userId}`;
    const cached = await (0, redis_1.getFromCache)(cacheKey);
    if (cached) {
        return cached;
    }
    // Get all messages for the user
    const messages = await prisma_1.prisma.message.findMany({
        where: {
            mailbox: {
                user_id: userId,
            },
            created_at: sinceDate ? { gte: sinceDate } : undefined,
        },
        select: {
            id: true,
            verdict: true,
            user_verdict: true,
            confidence_score: true,
            created_at: true,
            reviewed_at: true,
        },
        orderBy: {
            created_at: 'desc',
        },
    });
    const totalMessages = messages.length;
    const totalReviewed = messages.filter(m => m.user_verdict !== null).length;
    // Calculate overall accuracy
    const correctMessages = messages.filter(m => m.user_verdict === null || m.user_verdict === m.verdict).length;
    const overallAccuracy = totalMessages > 0 ? correctMessages / totalMessages : 1;
    // Calculate metrics by verdict type
    const verdicts = ['legit', 'spam', 'promotion', 'clean'];
    const byVerdict = verdicts.map(verdict => {
        const verdictMessages = messages.filter(m => m.verdict === verdict);
        const total = verdictMessages.length;
        // True positives: classified as X and user agreed (or didn't correct)
        const truePositives = verdictMessages.filter(m => m.user_verdict === null || m.user_verdict === verdict).length;
        // False positives: classified as X but user said it's not X
        const falsePositives = verdictMessages.filter(m => m.user_verdict !== null && m.user_verdict !== verdict).length;
        // False negatives: classified as something else but user said it's X
        const falseNegatives = messages.filter(m => m.verdict !== verdict && m.user_verdict === verdict).length;
        const correct = truePositives;
        const accuracy = total > 0 ? correct / total : 0;
        // Precision: TP / (TP + FP)
        const precision = (truePositives + falsePositives) > 0
            ? truePositives / (truePositives + falsePositives)
            : 0;
        // Recall: TP / (TP + FN)
        const recall = (truePositives + falseNegatives) > 0
            ? truePositives / (truePositives + falseNegatives)
            : 0;
        // F1 Score: 2 * (Precision * Recall) / (Precision + Recall)
        const f1Score = (precision + recall) > 0
            ? 2 * (precision * recall) / (precision + recall)
            : 0;
        return {
            verdict,
            total,
            correct,
            falsePositives,
            falseNegatives,
            accuracy,
            precision,
            recall,
            f1Score,
        };
    });
    // Calculate accuracy trend (last 30 days, grouped by day)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentMessages = messages.filter(m => m.created_at >= thirtyDaysAgo);
    const messagesByDate = new Map();
    recentMessages.forEach(m => {
        const dateKey = m.created_at.toISOString().split('T')[0];
        const existing = messagesByDate.get(dateKey) || { total: 0, correct: 0 };
        existing.total++;
        if (m.user_verdict === null || m.user_verdict === m.verdict) {
            existing.correct++;
        }
        messagesByDate.set(dateKey, existing);
    });
    const accuracyTrend = Array.from(messagesByDate.entries())
        .map(([date, stats]) => ({
        date,
        accuracy: stats.total > 0 ? stats.correct / stats.total : 0,
        totalMessages: stats.total,
    }))
        .sort((a, b) => a.date.localeCompare(b.date));
    // Generate threshold recommendations
    const thresholdRecommendations = await generateThresholdRecommendations(userId, byVerdict, messages);
    // Identify top issues
    const topIssues = identifyTopIssues(byVerdict, messages);
    const analytics = {
        totalMessages,
        totalReviewed,
        overallAccuracy,
        byVerdict,
        accuracyTrend,
        thresholdRecommendations,
        topIssues,
    };
    // Cache the analytics
    await (0, redis_1.setInCache)(cacheKey, analytics, cacheTTL);
    return analytics;
}
/**
 * Generate dynamic threshold recommendations based on user feedback
 */
async function generateThresholdRecommendations(userId, byVerdict, messages) {
    const recommendations = [];
    // Get current user settings
    const settings = await prisma_1.prisma.classificationSettings.findUnique({
        where: { user_id: userId },
    });
    if (!settings) {
        return recommendations;
    }
    // Analyze legit classification performance
    const legitStats = byVerdict.find(v => v.verdict === 'legit');
    if (legitStats && legitStats.total > 10) {
        // If too many false positives (legit marked as spam by user)
        if (legitStats.falsePositives / legitStats.total > 0.15) {
            recommendations.push({
                setting: 'not_spam_min_score',
                currentValue: settings.not_spam_min_score,
                recommendedValue: settings.not_spam_min_score + 1,
                expectedImpact: `Reduce false legit classifications by ~${((legitStats.falsePositives / legitStats.total) * 50).toFixed(0)}%`,
                confidence: 0.75,
            });
        }
        // If precision is low (many false legit)
        if (legitStats.precision < 0.7 && legitStats.total > 20) {
            recommendations.push({
                setting: 'not_spam_max_spam_score',
                currentValue: settings.not_spam_max_spam_score,
                recommendedValue: Math.max(3, settings.not_spam_max_spam_score - 1),
                expectedImpact: 'Increase legit classification precision',
                confidence: 0.70,
            });
        }
    }
    // Analyze spam classification performance
    const spamStats = byVerdict.find(v => v.verdict === 'spam');
    if (spamStats && spamStats.total > 10) {
        // If too many false negatives (spam marked as legit by user)
        if (spamStats.falseNegatives / (spamStats.total + spamStats.falseNegatives) > 0.10) {
            recommendations.push({
                setting: 'spam_min_score',
                currentValue: settings.spam_min_score,
                recommendedValue: Math.max(3, settings.spam_min_score - 1),
                expectedImpact: `Catch ${((spamStats.falseNegatives / spamStats.total) * 100).toFixed(0)}% more spam emails`,
                confidence: 0.80,
            });
        }
    }
    return recommendations;
}
/**
 * Identify top classification issues
 */
function identifyTopIssues(byVerdict, messages) {
    const issues = [];
    // Check for high false positive rate
    byVerdict.forEach(stats => {
        if (stats.total > 10 && stats.falsePositives / stats.total > 0.20) {
            issues.push({
                pattern: `High false positive rate for ${stats.verdict}`,
                occurrences: stats.falsePositives,
                impact: stats.falsePositives > 20 ? 'high' : 'medium',
                suggestion: `Review ${stats.verdict} classification rules and consider adjusting thresholds`,
            });
        }
    });
    // Check for low recall (missing classifications)
    byVerdict.forEach(stats => {
        if (stats.total > 10 && stats.recall < 0.6) {
            issues.push({
                pattern: `Low recall for ${stats.verdict} (missing ${((1 - stats.recall) * 100).toFixed(0)}% of ${stats.verdict} emails)`,
                occurrences: stats.falseNegatives,
                impact: stats.falseNegatives > 15 ? 'high' : 'medium',
                suggestion: `Increase sensitivity for ${stats.verdict} detection by lowering threshold or adding keywords`,
            });
        }
    });
    // Sort by impact and limit to top 5
    return issues
        .sort((a, b) => {
        const impactOrder = { high: 3, medium: 2, low: 1 };
        return impactOrder[b.impact] - impactOrder[a.impact] || b.occurrences - a.occurrences;
    })
        .slice(0, 5);
}
/**
 * Build personalization profile for a user based on feedback history
 */
async function buildPersonalizationProfile(userId) {
    const cacheKey = `personalization:${userId}`;
    const cached = await (0, redis_1.getFromCache)(cacheKey);
    if (cached) {
        return cached;
    }
    // Get corrected messages
    const correctedMessages = await prisma_1.prisma.message.findMany({
        where: {
            mailbox: { user_id: userId },
            user_verdict: { not: null },
        },
        select: {
            verdict: true,
            user_verdict: true,
            subject: true,
            body_text: true,
            sender_email: true,
        },
    });
    // Extract custom keywords from corrected messages
    const legitKeywords = new Set();
    const spamKeywords = new Set();
    const promoKeywords = new Set();
    correctedMessages.forEach(msg => {
        if (msg.user_verdict === msg.verdict)
            return; // Skip correct classifications
        const text = `${msg.subject} ${msg.body_text}`.toLowerCase();
        const words = text.match(/\b\w{4,}\b/g) || [];
        words.forEach(word => {
            if (msg.user_verdict === 'legit' && msg.verdict !== 'legit') {
                legitKeywords.add(word);
            }
            else if (msg.user_verdict === 'spam' && msg.verdict !== 'spam') {
                spamKeywords.add(word);
            }
            else if (msg.user_verdict === 'promotion' && msg.verdict !== 'promotion') {
                promoKeywords.add(word);
            }
        });
    });
    // Build sender patterns
    const senderMap = new Map();
    correctedMessages.forEach(msg => {
        const stats = senderMap.get(msg.sender_email) || { legit: 0, spam: 0, promo: 0, clean: 0 };
        if (msg.user_verdict) {
            stats[msg.user_verdict]++;
        }
        senderMap.set(msg.sender_email, stats);
    });
    const senderPatterns = Array.from(senderMap.entries())
        .filter(([_, stats]) => Object.values(stats).reduce((a, b) => a + b, 0) >= 2)
        .map(([email, stats]) => {
        const total = Object.values(stats).reduce((a, b) => a + b, 0);
        const max = Math.max(stats.legit, stats.spam, stats.promo, stats.clean);
        const preferredVerdict = (stats.legit === max ? 'legit' :
            stats.spam === max ? 'spam' :
                stats.promo === max ? 'promotion' : 'clean');
        return {
            email,
            preferredVerdict,
            confidence: max / total,
        };
    })
        .filter(p => p.confidence > 0.6);
    const profile = {
        userId,
        preferredVerdicts: new Map(),
        customKeywords: {
            legit: Array.from(legitKeywords).slice(0, 50),
            spam: Array.from(spamKeywords).slice(0, 50),
            promotion: Array.from(promoKeywords).slice(0, 50),
        },
        thresholdAdjustments: {
            legitMinScore: 0,
            spamMinScore: 0,
            promoMinScore: 0,
        },
        senderPatterns,
    };
    // Cache for 1 hour
    await (0, redis_1.setInCache)(cacheKey, profile, 3600);
    return profile;
}
/**
 * Process bulk feedback (multiple user corrections at once)
 */
async function processBulkFeedback(feedbackItems) {
    let successful = 0;
    let failed = 0;
    const newInsights = [];
    for (const item of feedbackItems) {
        try {
            // Update message with user verdict
            await prisma_1.prisma.message.update({
                where: { id: item.messageId },
                data: {
                    user_verdict: item.userVerdict,
                    reviewed_at: new Date(),
                },
            });
            // Update sender reputation
            const message = await prisma_1.prisma.message.findUnique({
                where: { id: item.messageId },
                select: { sender_email: true, sender_domain: true },
            });
            if (message) {
                await prisma_1.prisma.senderReputation.upsert({
                    where: {
                        user_id_sender_email: {
                            user_id: item.userId,
                            sender_email: message.sender_email,
                        },
                    },
                    update: {
                        [`${item.userVerdict}_count`]: { increment: 1 },
                        last_seen: new Date(),
                    },
                    create: {
                        user_id: item.userId,
                        sender_email: message.sender_email,
                        sender_domain: message.sender_domain || message.sender_email.split('@')[1],
                        [`${item.userVerdict}_count`]: 1,
                    },
                });
            }
            successful++;
        }
        catch (error) {
            console.error(`[BulkFeedback] Failed to process ${item.messageId}:`, error);
            failed++;
        }
    }
    // Invalidate analytics cache
    const uniqueUsers = [...new Set(feedbackItems.map(f => f.userId))];
    for (const userId of uniqueUsers) {
        // Clear cache to force regeneration
        const cacheKey = `feedbackAnalytics:${userId}`;
        await (0, redis_1.setInCache)(cacheKey, null, 1); // Expire immediately
    }
    // Generate new insights if we processed enough feedback
    if (successful >= 10) {
        newInsights.push(`Processed ${successful} feedback items - analytics updated`);
        newInsights.push('New patterns may be available in personalization profile');
    }
    return {
        processed: feedbackItems.length,
        successful,
        failed,
        analyticsUpdated: successful > 0,
        newInsights,
    };
}
/**
 * Auto-apply recommended thresholds (with safety checks)
 */
async function applyRecommendedThresholds(userId, options = {}) {
    const { minConfidence = 0.75, dryRun = false } = options;
    const analytics = await generateFeedbackAnalytics(userId);
    const settings = await prisma_1.prisma.classificationSettings.findUnique({
        where: { user_id: userId },
    });
    if (!settings) {
        return { applied: 0, previewed: 0, changes: [] };
    }
    const changes = [];
    let applied = 0;
    for (const rec of analytics.thresholdRecommendations) {
        if (rec.confidence >= minConfidence) {
            changes.push({
                setting: rec.setting,
                oldValue: rec.currentValue,
                newValue: rec.recommendedValue,
                impact: rec.expectedImpact,
            });
            if (!dryRun) {
                await prisma_1.prisma.classificationSettings.update({
                    where: { user_id: userId },
                    data: {
                        [rec.setting]: rec.recommendedValue,
                    },
                });
                applied++;
            }
        }
    }
    return {
        applied: dryRun ? 0 : applied,
        previewed: changes.length,
        changes,
    };
}
