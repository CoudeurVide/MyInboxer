"use strict";
/**
 * API Quota Tracking Service
 * Monitors Gmail and Outlook API usage to prevent rate limit violations
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.trackGmailQuota = trackGmailQuota;
exports.trackOutlookQuota = trackOutlookQuota;
exports.checkGmailQuotaAvailable = checkGmailQuotaAvailable;
exports.checkOutlookQuotaAvailable = checkOutlookQuotaAvailable;
exports.getGmailQuotaUsage = getGmailQuotaUsage;
exports.getOutlookQuotaUsage = getOutlookQuotaUsage;
exports.getQuotaStatistics = getQuotaStatistics;
const redis_1 = require("../lib/redis");
const prisma_1 = require("../lib/prisma");
const logger_1 = require("../lib/logger");
// Quota limits (per user per day unless specified)
const QUOTA_LIMITS = {
    gmail: {
        quotaUnits: 250, // Per second per user
        maxDailyQuota: 1_000_000_000, // Daily quota units
        batchRequestLimit: 100, // Max batch size
    },
    outlook: {
        requestsPerMinute: 10_000, // Per app per tenant
        requestsPerHour: 60_000,
        maxConcurrent: 20, // Concurrent requests
    },
};
// Redis keys for tracking
const REDIS_KEYS = {
    gmailQuotaPerSecond: (userId) => `quota:gmail:second:${userId}`,
    gmailQuotaDaily: (userId) => `quota:gmail:daily:${userId}`,
    outlookQuotaPerMinute: () => `quota:outlook:minute`,
    outlookQuotaPerHour: () => `quota:outlook:hour`,
    outlookConcurrent: () => `quota:outlook:concurrent`,
};
/**
 * Track Gmail API quota usage
 */
async function trackGmailQuota(userId, quotaUnits = 1) {
    try {
        const secondKey = REDIS_KEYS.gmailQuotaPerSecond(userId);
        const dailyKey = REDIS_KEYS.gmailQuotaDaily(userId);
        // Track per-second quota
        const secondUsage = await redis_1.redis.incr(secondKey);
        if (secondUsage === 1) {
            await redis_1.redis.expire(secondKey, 1); // Expire after 1 second
        }
        // Track daily quota
        const dailyUsage = await redis_1.redis.incrby(dailyKey, quotaUnits);
        if (dailyUsage === quotaUnits) {
            // Set to expire at midnight
            const now = new Date();
            const midnight = new Date(now);
            midnight.setHours(24, 0, 0, 0);
            const secondsUntilMidnight = Math.floor((midnight.getTime() - now.getTime()) / 1000);
            await redis_1.redis.expire(dailyKey, secondsUntilMidnight);
        }
        // Log if approaching limits
        if (secondUsage > QUOTA_LIMITS.gmail.quotaUnits * 0.8) {
            logger_1.logger.warn(`User ${userId} approaching Gmail per-second quota: ${secondUsage}/${QUOTA_LIMITS.gmail.quotaUnits}`);
        }
        // Store in database for historical tracking
        await prisma_1.prisma.apiQuotaLog.create({
            data: {
                provider: 'gmail',
                user_id: userId,
                quota_used: quotaUnits,
                endpoint: 'messages.list',
                timestamp: new Date(),
            },
        }).catch(() => {
            // Ignore DB errors for quota tracking
        });
    }
    catch (error) {
        logger_1.logger.error('Error tracking Gmail quota:', error);
    }
}
/**
 * Track Outlook API quota usage
 */
async function trackOutlookQuota(requestCount = 1) {
    try {
        const minuteKey = REDIS_KEYS.outlookQuotaPerMinute();
        const hourKey = REDIS_KEYS.outlookQuotaPerHour();
        // Track per-minute quota
        const minuteUsage = await redis_1.redis.incrby(minuteKey, requestCount);
        if (minuteUsage === requestCount) {
            await redis_1.redis.expire(minuteKey, 60); // Expire after 1 minute
        }
        // Track per-hour quota
        const hourUsage = await redis_1.redis.incrby(hourKey, requestCount);
        if (hourUsage === requestCount) {
            await redis_1.redis.expire(hourKey, 3600); // Expire after 1 hour
        }
        // Log if approaching limits
        if (minuteUsage > QUOTA_LIMITS.outlook.requestsPerMinute * 0.8) {
            logger_1.logger.warn(`Approaching Outlook per-minute quota: ${minuteUsage}/${QUOTA_LIMITS.outlook.requestsPerMinute}`);
        }
        if (hourUsage > QUOTA_LIMITS.outlook.requestsPerHour * 0.8) {
            logger_1.logger.warn(`Approaching Outlook per-hour quota: ${hourUsage}/${QUOTA_LIMITS.outlook.requestsPerHour}`);
        }
        // Store in database
        await prisma_1.prisma.apiQuotaLog.create({
            data: {
                provider: 'outlook',
                quota_used: requestCount,
                endpoint: 'messages',
                timestamp: new Date(),
            },
        }).catch(() => {
            // Ignore DB errors
        });
    }
    catch (error) {
        logger_1.logger.error('Error tracking Outlook quota:', error);
    }
}
/**
 * Check if Gmail quota is available for user
 */
async function checkGmailQuotaAvailable(userId) {
    try {
        const secondKey = REDIS_KEYS.gmailQuotaPerSecond(userId);
        const dailyKey = REDIS_KEYS.gmailQuotaDaily(userId);
        // Check per-second quota
        const secondUsage = await redis_1.redis.get(secondKey);
        if (secondUsage && parseInt(secondUsage) >= QUOTA_LIMITS.gmail.quotaUnits) {
            return {
                available: false,
                reason: 'Per-second quota exceeded',
                retryAfter: 1,
            };
        }
        // Check daily quota
        const dailyUsage = await redis_1.redis.get(dailyKey);
        if (dailyUsage && parseInt(dailyUsage) >= QUOTA_LIMITS.gmail.maxDailyQuota) {
            const ttl = await redis_1.redis.ttl(dailyKey);
            return {
                available: false,
                reason: 'Daily quota exceeded',
                retryAfter: ttl > 0 ? ttl : 3600,
            };
        }
        return { available: true };
    }
    catch (error) {
        logger_1.logger.error('Error checking Gmail quota:', error);
        return { available: true }; // Fail open to not block operations
    }
}
/**
 * Check if Outlook quota is available
 */
async function checkOutlookQuotaAvailable() {
    try {
        const minuteKey = REDIS_KEYS.outlookQuotaPerMinute();
        const hourKey = REDIS_KEYS.outlookQuotaPerHour();
        // Check per-minute quota
        const minuteUsage = await redis_1.redis.get(minuteKey);
        if (minuteUsage && parseInt(minuteUsage) >= QUOTA_LIMITS.outlook.requestsPerMinute) {
            return {
                available: false,
                reason: 'Per-minute quota exceeded',
                retryAfter: 60,
            };
        }
        // Check per-hour quota
        const hourUsage = await redis_1.redis.get(hourKey);
        if (hourUsage && parseInt(hourUsage) >= QUOTA_LIMITS.outlook.requestsPerHour) {
            const ttl = await redis_1.redis.ttl(hourKey);
            return {
                available: false,
                reason: 'Per-hour quota exceeded',
                retryAfter: ttl > 0 ? ttl : 3600,
            };
        }
        return { available: true };
    }
    catch (error) {
        logger_1.logger.error('Error checking Outlook quota:', error);
        return { available: true }; // Fail open
    }
}
/**
 * Get current quota usage for Gmail user
 */
async function getGmailQuotaUsage(userId) {
    try {
        const secondKey = REDIS_KEYS.gmailQuotaPerSecond(userId);
        const dailyKey = REDIS_KEYS.gmailQuotaDaily(userId);
        const [secondUsage, dailyUsage, secondTTL, dailyTTL] = await Promise.all([
            redis_1.redis.get(secondKey),
            redis_1.redis.get(dailyKey),
            redis_1.redis.ttl(secondKey),
            redis_1.redis.ttl(dailyKey),
        ]);
        const perSecondUsage = parseInt(secondUsage || '0');
        const perDailyUsage = parseInt(dailyUsage || '0');
        const now = new Date();
        return [
            {
                provider: 'gmail',
                current: perSecondUsage,
                limit: QUOTA_LIMITS.gmail.quotaUnits,
                percentage: Math.round((perSecondUsage / QUOTA_LIMITS.gmail.quotaUnits) * 100),
                resetAt: new Date(now.getTime() + (secondTTL > 0 ? secondTTL * 1000 : 1000)),
                status: perSecondUsage / QUOTA_LIMITS.gmail.quotaUnits >= 0.9
                    ? 'critical'
                    : perSecondUsage / QUOTA_LIMITS.gmail.quotaUnits >= 0.7
                        ? 'warning'
                        : 'ok',
            },
            {
                provider: 'gmail',
                current: perDailyUsage,
                limit: QUOTA_LIMITS.gmail.maxDailyQuota,
                percentage: Math.round((perDailyUsage / QUOTA_LIMITS.gmail.maxDailyQuota) * 100),
                resetAt: new Date(now.getTime() + (dailyTTL > 0 ? dailyTTL * 1000 : 86400000)),
                status: perDailyUsage / QUOTA_LIMITS.gmail.maxDailyQuota >= 0.9
                    ? 'critical'
                    : perDailyUsage / QUOTA_LIMITS.gmail.maxDailyQuota >= 0.7
                        ? 'warning'
                        : 'ok',
            },
        ];
    }
    catch (error) {
        logger_1.logger.error('Error getting Gmail quota usage:', error);
        return [];
    }
}
/**
 * Get current quota usage for Outlook
 */
async function getOutlookQuotaUsage() {
    try {
        const minuteKey = REDIS_KEYS.outlookQuotaPerMinute();
        const hourKey = REDIS_KEYS.outlookQuotaPerHour();
        const [minuteUsage, hourUsage, minuteTTL, hourTTL] = await Promise.all([
            redis_1.redis.get(minuteKey),
            redis_1.redis.get(hourKey),
            redis_1.redis.ttl(minuteKey),
            redis_1.redis.ttl(hourKey),
        ]);
        const perMinuteUsage = parseInt(minuteUsage || '0');
        const perHourUsage = parseInt(hourUsage || '0');
        const now = new Date();
        return [
            {
                provider: 'outlook',
                current: perMinuteUsage,
                limit: QUOTA_LIMITS.outlook.requestsPerMinute,
                percentage: Math.round((perMinuteUsage / QUOTA_LIMITS.outlook.requestsPerMinute) * 100),
                resetAt: new Date(now.getTime() + (minuteTTL > 0 ? minuteTTL * 1000 : 60000)),
                status: perMinuteUsage / QUOTA_LIMITS.outlook.requestsPerMinute >= 0.9
                    ? 'critical'
                    : perMinuteUsage / QUOTA_LIMITS.outlook.requestsPerMinute >= 0.7
                        ? 'warning'
                        : 'ok',
            },
            {
                provider: 'outlook',
                current: perHourUsage,
                limit: QUOTA_LIMITS.outlook.requestsPerHour,
                percentage: Math.round((perHourUsage / QUOTA_LIMITS.outlook.requestsPerHour) * 100),
                resetAt: new Date(now.getTime() + (hourTTL > 0 ? hourTTL * 1000 : 3600000)),
                status: perHourUsage / QUOTA_LIMITS.outlook.requestsPerHour >= 0.9
                    ? 'critical'
                    : perHourUsage / QUOTA_LIMITS.outlook.requestsPerHour >= 0.7
                        ? 'warning'
                        : 'ok',
            },
        ];
    }
    catch (error) {
        logger_1.logger.error('Error getting Outlook quota usage:', error);
        return [];
    }
}
/**
 * Get quota statistics from database (historical data)
 */
async function getQuotaStatistics(provider, startDate, endDate) {
    try {
        const where = {
            timestamp: {
                gte: startDate || new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
                lte: endDate || new Date(),
            },
        };
        if (provider) {
            where.provider = provider;
        }
        const logs = await prisma_1.prisma.apiQuotaLog.findMany({
            where,
            select: {
                provider: true,
                quota_used: true,
                timestamp: true,
            },
        });
        const totalRequests = logs.reduce((sum, log) => sum + log.quota_used, 0);
        const hoursSpan = Math.max(1, (endDate || new Date()).getTime() - (startDate || new Date(Date.now() - 24 * 60 * 60 * 1000)).getTime()) / (1000 * 60 * 60);
        // Group by hour
        const byHour = {};
        logs.forEach((log) => {
            const hour = new Date(log.timestamp).getHours();
            byHour[hour] = (byHour[hour] || 0) + log.quota_used;
        });
        const peakHour = Object.entries(byHour).reduce((peak, [hour, requests]) => {
            return requests > peak.requests ? { hour: parseInt(hour), requests } : peak;
        }, { hour: 0, requests: 0 });
        // Group by provider
        const byProvider = {};
        logs.forEach((log) => {
            byProvider[log.provider] = (byProvider[log.provider] || 0) + log.quota_used;
        });
        return {
            totalRequests,
            averagePerHour: Math.round(totalRequests / hoursSpan),
            peakHour,
            byProvider,
        };
    }
    catch (error) {
        logger_1.logger.error('Error getting quota statistics:', error);
        return {
            totalRequests: 0,
            averagePerHour: 0,
            peakHour: { hour: 0, requests: 0 },
            byProvider: {},
        };
    }
}
logger_1.logger.info('API Quota Tracking Service initialized');
