"use strict";
/**
 * Sender Reputation Service
 * Tracks sender reputation based on message history and user feedback
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.invalidateReputationThresholdCache = invalidateReputationThresholdCache;
exports.getOrCreateReputation = getOrCreateReputation;
exports.updateReputation = updateReputation;
exports.getSenderReputation = getSenderReputation;
exports.getUserReputations = getUserReputations;
exports.blockSender = blockSender;
exports.unblockSender = unblockSender;
exports.getReputationStats = getReputationStats;
exports.getReputationAdjustment = getReputationAdjustment;
exports.getReputationEmoji = getReputationEmoji;
exports.getReputationLabel = getReputationLabel;
const prisma_1 = require("../lib/prisma");
let _thresholdCache = null;
let _thresholdCacheTime = 0;
const THRESHOLD_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
async function getThresholds() {
    if (_thresholdCache && Date.now() - _thresholdCacheTime < THRESHOLD_CACHE_TTL) {
        return _thresholdCache;
    }
    const settings = await prisma_1.prisma.classificationSettings.findFirst({
        orderBy: { updated_at: 'desc' },
        select: { spam_mark_to_block: true, legit_mark_to_trust: true },
    });
    _thresholdCache = {
        spamMarkToBlock: settings?.spam_mark_to_block ?? 1,
        legitMarkToTrust: settings?.legit_mark_to_trust ?? 3,
    };
    _thresholdCacheTime = Date.now();
    return _thresholdCache;
}
/** Call this after admin saves classification settings so new thresholds take effect immediately */
function invalidateReputationThresholdCache() {
    _thresholdCache = null;
}
/**
 * Get or create sender reputation
 */
async function getOrCreateReputation(userId, senderEmail) {
    const normalizedEmail = senderEmail.toLowerCase().trim();
    const senderDomain = extractDomain(normalizedEmail);
    let reputation = await prisma_1.prisma.senderReputation.findUnique({
        where: {
            user_id_sender_email: {
                user_id: userId,
                sender_email: normalizedEmail,
            },
        },
    });
    if (!reputation) {
        reputation = await prisma_1.prisma.senderReputation.create({
            data: {
                user_id: userId,
                sender_email: normalizedEmail,
                sender_domain: senderDomain,
                reputation_score: 'neutral',
            },
        });
    }
    return reputation;
}
/**
 * Update sender reputation based on message classification
 */
async function updateReputation(params) {
    const { userId, senderEmail, verdict, userFeedback } = params;
    const normalizedEmail = senderEmail.toLowerCase().trim();
    const reputation = await getOrCreateReputation(userId, normalizedEmail);
    // Update statistics
    const updates = {
        total_messages: { increment: 1 },
        last_seen: new Date(),
    };
    // Increment verdict counters
    if (verdict === 'legit') {
        updates.not_spam_count = { increment: 1 };
    }
    else if (verdict === 'spam') {
        updates.spam_count = { increment: 1 };
    }
    else if (verdict === 'promotion') {
        updates.promotion_count = { increment: 1 };
    }
    // Update user feedback counters
    if (userFeedback === 'confirm_legit') {
        updates.user_confirmed_not_spam = { increment: 1 };
    }
    else if (userFeedback === 'mark_spam') {
        updates.user_marked_spam = { increment: 1 };
    }
    // Update the reputation record
    const updated = await prisma_1.prisma.senderReputation.update({
        where: { id: reputation.id },
        data: updates,
    });
    // Recalculate reputation score using DB-backed thresholds
    const thresholds = await getThresholds();
    const newScore = calculateReputationScore(updated, thresholds);
    if (newScore !== updated.reputation_score) {
        await prisma_1.prisma.senderReputation.update({
            where: { id: updated.id },
            data: { reputation_score: newScore },
        });
    }
    return updated;
}
/**
 * Calculate reputation score based on statistics and configurable thresholds
 */
function calculateReputationScore(reputation, thresholds = { spamMarkToBlock: 1, legitMarkToTrust: 3 }) {
    const { total_messages, not_spam_count, // Database still has original column name
    spam_count, user_confirmed_not_spam, // Database still has original column name
    user_marked_spam, } = reputation;
    // User explicitly blocked (threshold-controlled)
    if (user_marked_spam >= thresholds.spamMarkToBlock) {
        return 'blocked';
    }
    // User confirmed multiple legit - trusted sender (threshold-controlled)
    if (user_confirmed_not_spam >= thresholds.legitMarkToTrust) {
        return 'trusted';
    }
    // Has at least one confirmed legit (using legacy column name)
    if (user_confirmed_not_spam >= 1) {
        return 'good';
    }
    // High legit ratio (AI detected as legit, using legacy column name)
    if (total_messages >= 3) {
        const legitRatio = not_spam_count / total_messages; // Using legacy column name
        const spamRatio = spam_count / total_messages;
        if (legitRatio >= 0.6) {
            return 'good';
        }
        if (spamRatio >= 0.8 || user_marked_spam >= 1) {
            return 'suspicious';
        }
    }
    // Default to neutral
    return 'neutral';
}
/**
 * Get reputation for a sender
 */
async function getSenderReputation(userId, senderEmail) {
    if (!userId || typeof userId !== 'string') {
        throw new Error('UNAUTHORIZED: userId is required');
    }
    const normalizedEmail = senderEmail.toLowerCase().trim();
    const reputation = await prisma_1.prisma.senderReputation.findUnique({
        where: {
            user_id_sender_email: {
                user_id: userId,
                sender_email: normalizedEmail,
            },
        },
    });
    return reputation;
}
/**
 * Get all reputations for a user
 */
async function getUserReputations(userId, filters) {
    if (!userId || typeof userId !== 'string') {
        throw new Error('UNAUTHORIZED: userId is required');
    }
    const where = { user_id: userId };
    if (filters?.score) {
        where.reputation_score = filters.score;
    }
    const reputations = await prisma_1.prisma.senderReputation.findMany({
        where,
        orderBy: [
            { user_confirmed_not_spam: 'desc' },
            { not_spam_count: 'desc' },
            { last_seen: 'desc' },
        ],
        take: filters?.limit || 100,
    });
    return reputations;
}
/**
 * Block a sender
 */
async function blockSender(userId, senderEmail) {
    if (!userId || typeof userId !== 'string') {
        throw new Error('UNAUTHORIZED: userId is required');
    }
    const normalizedEmail = senderEmail.toLowerCase().trim();
    const reputation = await getOrCreateReputation(userId, normalizedEmail);
    return await prisma_1.prisma.senderReputation.update({
        where: { id: reputation.id },
        data: {
            reputation_score: 'blocked',
            user_marked_spam: { increment: 1 },
        },
    });
}
/**
 * Unblock a sender
 */
async function unblockSender(userId, senderEmail) {
    if (!userId || typeof userId !== 'string') {
        throw new Error('UNAUTHORIZED: userId is required');
    }
    const normalizedEmail = senderEmail.toLowerCase().trim();
    const reputation = await prisma_1.prisma.senderReputation.findUnique({
        where: {
            user_id_sender_email: {
                user_id: userId,
                sender_email: normalizedEmail,
            },
        },
    });
    if (!reputation) {
        return null;
    }
    // Recalculate score without blocked status, using current thresholds
    const thresholds = await getThresholds();
    const newScore = reputation.user_confirmed_not_spam >= thresholds.legitMarkToTrust ? 'trusted' :
        reputation.user_confirmed_not_spam >= 1 ? 'good' : 'neutral';
    return await prisma_1.prisma.senderReputation.update({
        where: { id: reputation.id },
        data: { reputation_score: newScore },
    });
}
/**
 * Get reputation statistics for a user
 */
async function getReputationStats(userId) {
    if (!userId || typeof userId !== 'string') {
        throw new Error('UNAUTHORIZED: userId is required');
    }
    const stats = await prisma_1.prisma.senderReputation.groupBy({
        by: ['reputation_score'],
        where: { user_id: userId },
        _count: { id: true },
    });
    return {
        trusted: stats.find(s => s.reputation_score === 'trusted')?._count.id || 0,
        good: stats.find(s => s.reputation_score === 'good')?._count.id || 0,
        neutral: stats.find(s => s.reputation_score === 'neutral')?._count.id || 0,
        suspicious: stats.find(s => s.reputation_score === 'suspicious')?._count.id || 0,
        blocked: stats.find(s => s.reputation_score === 'blocked')?._count.id || 0,
    };
}
/**
 * Extract domain from email address
 */
function extractDomain(email) {
    const parts = email.split('@');
    return parts.length === 2 ? parts[1].toLowerCase() : '';
}
/**
 * Get reputation boost/penalty for AI classifier
 * Returns a number between -0.2 and +0.2 to adjust confidence
 */
function getReputationAdjustment(reputationScore) {
    switch (reputationScore) {
        case 'trusted':
            return 0.2; // +20% confidence boost
        case 'good':
            return 0.1; // +10% confidence boost
        case 'neutral':
            return 0; // No adjustment
        case 'suspicious':
            return -0.1; // -10% confidence penalty
        case 'blocked':
            return -0.3; // -30% confidence penalty (strong signal)
        default:
            return 0;
    }
}
/**
 * Get reputation indicator emoji
 */
function getReputationEmoji(score) {
    switch (score) {
        case 'trusted':
            return '✅';
        case 'good':
            return '👍';
        case 'neutral':
            return '➖';
        case 'suspicious':
            return '⚠️';
        case 'blocked':
            return '🚫';
        default:
            return '❓';
    }
}
/**
 * Get reputation label
 */
function getReputationLabel(score) {
    switch (score) {
        case 'trusted':
            return 'Trusted Sender';
        case 'good':
            return 'Good Sender';
        case 'neutral':
            return 'Unknown Sender';
        case 'suspicious':
            return 'Suspicious';
        case 'blocked':
            return 'Blocked';
        default:
            return 'Unknown';
    }
}
