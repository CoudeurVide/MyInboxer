"use strict";
/**
 * Feedback Learning Service
 * Learns from user corrections to improve classification accuracy over time
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeUserCorrections = analyzeUserCorrections;
exports.getSenderLearning = getSenderLearning;
exports.applySenderReputations = applySenderReputations;
exports.getAccuracyStats = getAccuracyStats;
exports.getMisclassifiedKeywords = getMisclassifiedKeywords;
const prisma_1 = require("../lib/prisma");
/**
 * Analyze all user corrections for a specific user
 */
async function analyzeUserCorrections(userId, options = {}) {
    const { sinceDate, limit = 1000 } = options;
    // Get all messages with user corrections
    const correctedMessages = await prisma_1.prisma.message.findMany({
        where: {
            mailbox: {
                user_id: userId,
            },
            user_verdict: {
                not: null,
            },
            reviewed_at: sinceDate ? { gte: sinceDate } : undefined,
        },
        take: limit,
        orderBy: {
            reviewed_at: 'desc',
        },
        include: {
            mailbox: true,
        },
    });
    const totalCorrections = correctedMessages.filter((msg) => msg.user_verdict !== msg.verdict).length;
    const accuracyRate = correctedMessages.length > 0
        ? (correctedMessages.length - totalCorrections) / correctedMessages.length
        : 1;
    // Analyze common mistakes
    const mistakeTypes = new Map();
    correctedMessages.forEach((msg) => {
        if (msg.user_verdict !== msg.verdict) {
            const mistakeKey = `${msg.verdict} → ${msg.user_verdict}`;
            const existing = mistakeTypes.get(mistakeKey) || { count: 0, examples: [] };
            existing.count++;
            if (existing.examples.length < 3) {
                existing.examples.push(msg.subject);
            }
            mistakeTypes.set(mistakeKey, existing);
        }
    });
    const commonMistakes = Array.from(mistakeTypes.entries())
        .map(([type, data]) => ({ type, ...data }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
    // Analyze sender patterns
    const senderStats = new Map();
    correctedMessages.forEach((msg) => {
        const sender = msg.sender_email;
        const existing = senderStats.get(sender) || {
            total: 0,
            corrections: 0,
            userVerdicts: new Map(),
        };
        existing.total++;
        if (msg.user_verdict !== msg.verdict) {
            existing.corrections++;
        }
        if (msg.user_verdict) {
            const verdictCount = existing.userVerdicts.get(msg.user_verdict) || 0;
            existing.userVerdicts.set(msg.user_verdict, verdictCount + 1);
        }
        senderStats.set(sender, existing);
    });
    // Build sender reputations
    const senderReputations = Array.from(senderStats.entries())
        .filter(([_, stats]) => stats.total >= 2) // At least 2 messages
        .map(([email, stats]) => {
        // Determine suggested reputation based on user corrections
        let suggestedReputation = 'neutral';
        const notSpamCount = stats.userVerdicts.get('legit') || 0;
        const spamCount = stats.userVerdicts.get('spam') || 0;
        const correctionRate = stats.corrections / stats.total;
        if (notSpamCount >= 2 && correctionRate < 0.3) {
            suggestedReputation = 'trusted';
        }
        else if (notSpamCount >= 1) {
            suggestedReputation = 'good';
        }
        else if (spamCount >= 2) {
            suggestedReputation = 'blocked';
        }
        else if (spamCount >= 1) {
            suggestedReputation = 'suspicious';
        }
        return {
            email,
            totalMessages: stats.total,
            corrections: stats.corrections,
            suggestedReputation,
        };
    })
        .sort((a, b) => b.totalMessages - a.totalMessages)
        .slice(0, 20);
    // Generate improvement suggestions
    const improvementSuggestions = [];
    if (accuracyRate < 0.7) {
        improvementSuggestions.push('Overall accuracy is low - consider adjusting classification thresholds');
    }
    commonMistakes.forEach((mistake) => {
        if (mistake.count >= 3) {
            improvementSuggestions.push(`Frequently classifies ${mistake.type} (${mistake.count} times) - review related patterns`);
        }
    });
    if (senderReputations.length > 5) {
        improvementSuggestions.push(`${senderReputations.length} senders have reputation suggestions - consider applying them`);
    }
    return {
        totalCorrections,
        accuracyRate,
        commonMistakes,
        senderReputations,
        improvementSuggestions,
    };
}
/**
 * Get sender learning data for confidence adjustment
 */
async function getSenderLearning(senderEmail, userId) {
    const messages = await prisma_1.prisma.message.findMany({
        where: {
            sender_email: senderEmail,
            mailbox: {
                user_id: userId,
            },
        },
        select: {
            verdict: true,
            user_verdict: true,
            confidence_score: true,
        },
    });
    if (messages.length === 0) {
        return null;
    }
    let correctClassifications = 0;
    let incorrectClassifications = 0;
    const userVerdicts = new Map();
    messages.forEach((msg) => {
        if (msg.user_verdict) {
            const count = userVerdicts.get(msg.user_verdict) || 0;
            userVerdicts.set(msg.user_verdict, count + 1);
            if (msg.user_verdict === msg.verdict) {
                correctClassifications++;
            }
            else {
                incorrectClassifications++;
            }
        }
        else {
            // No correction means it was correct
            correctClassifications++;
        }
    });
    // Determine user's preferred classification for this sender
    let userPreference = null;
    let maxCount = 0;
    userVerdicts.forEach((count, verdict) => {
        if (count > maxCount) {
            maxCount = count;
            userPreference = verdict;
        }
    });
    // Calculate confidence adjustment
    const totalWithFeedback = correctClassifications + incorrectClassifications;
    const accuracyRate = totalWithFeedback > 0
        ? correctClassifications / totalWithFeedback
        : 0.5;
    // Adjust confidence based on historical accuracy
    let confidenceAdjustment = 0;
    if (totalWithFeedback >= 3) {
        if (accuracyRate >= 0.8) {
            confidenceAdjustment = 0.15; // Boost confidence for consistently accurate senders
        }
        else if (accuracyRate <= 0.3) {
            confidenceAdjustment = -0.15; // Reduce confidence for consistently inaccurate
        }
    }
    return {
        email: senderEmail,
        totalMessages: messages.length,
        correctClassifications,
        incorrectClassifications,
        userPreference,
        confidenceAdjustment,
    };
}
/**
 * Apply automatic sender reputation based on learning
 */
async function applySenderReputations(userId, autoApply = false) {
    const insights = await analyzeUserCorrections(userId);
    let applied = 0;
    for (const suggestion of insights.senderReputations) {
        // Check if sender already has a reputation setting
        const existing = await prisma_1.prisma.senderReputation.findFirst({
            where: {
                user_id: userId,
                sender_email: suggestion.email,
            },
        });
        if (autoApply && !existing && suggestion.totalMessages >= 3) {
            // Auto-apply if enabled and sender has enough history
            await prisma_1.prisma.senderReputation.create({
                data: {
                    user_id: userId,
                    sender_email: suggestion.email,
                    score: suggestion.suggestedReputation,
                    notes: `Auto-applied based on ${suggestion.totalMessages} messages, ${suggestion.corrections} corrections`,
                },
            });
            applied++;
        }
    }
    return {
        applied,
        suggested: insights.senderReputations.length,
    };
}
/**
 * Get classification accuracy statistics for a user
 */
async function getAccuracyStats(userId, options = {}) {
    const { groupBy = 'verdict', sinceDate } = options;
    const messages = await prisma_1.prisma.message.findMany({
        where: {
            mailbox: {
                user_id: userId,
            },
            created_at: sinceDate ? { gte: sinceDate } : undefined,
        },
        include: {
            mailbox: true,
        },
    });
    const stats = {
        total: messages.length,
        reviewed: messages.filter((m) => m.user_verdict !== null).length,
        correct: messages.filter((m) => m.user_verdict === null || m.user_verdict === m.verdict).length,
        byVerdict: {},
    };
    // Calculate by verdict
    ['legit', 'spam', 'promotion', 'clean'].forEach((verdict) => {
        const verdictMessages = messages.filter((m) => m.verdict === verdict);
        const correct = verdictMessages.filter((m) => m.user_verdict === null || m.user_verdict === verdict).length;
        stats.byVerdict[verdict] = {
            total: verdictMessages.length,
            correct,
            accuracy: verdictMessages.length > 0 ? correct / verdictMessages.length : 0,
        };
    });
    return stats;
}
/**
 * Get top misclassified keywords (keywords appearing in corrected messages)
 */
async function getMisclassifiedKeywords(userId, limit = 20) {
    const correctedMessages = await prisma_1.prisma.message.findMany({
        where: {
            mailbox: {
                user_id: userId,
            },
            user_verdict: {
                not: null,
            },
        },
        select: {
            verdict: true,
            user_verdict: true,
            subject: true,
            body_text: true,
        },
    });
    const keywordCounts = new Map();
    correctedMessages.forEach((msg) => {
        if (msg.user_verdict === msg.verdict)
            return; // Skip correct classifications
        const text = `${msg.subject} ${msg.body_text || ''}`.toLowerCase();
        const words = text.match(/\b\w+\b/g) || [];
        // Extract meaningful keywords (4+ characters, not common words)
        const commonWords = new Set(['that', 'this', 'with', 'from', 'have', 'been', 'your', 'will', 'what', 'when', 'where', 'which', 'their', 'there', 'would', 'could', 'should']);
        words
            .filter((word) => word.length >= 4 && !commonWords.has(word))
            .forEach((word) => {
            const key = `${word}`;
            const existing = keywordCounts.get(key) || {
                count: 0,
                fromVerdict: msg.verdict,
                toVerdict: msg.user_verdict || '',
            };
            existing.count++;
            keywordCounts.set(key, existing);
        });
    });
    return Array.from(keywordCounts.entries())
        .map(([keyword, data]) => ({ keyword, ...data }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit);
}
