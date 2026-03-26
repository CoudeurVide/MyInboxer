"use strict";
/**
 * Usage Service for SpamRescue
 * Manages tracking and enforcement of usage limits per subscription plan
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.usageService = exports.UsageService = void 0;
const prisma_1 = require("../lib/prisma");
const logger_1 = require("../lib/logger");
const email_service_1 = require("./email.service");
class UsageService {
    /**
     * Gets current usage for a user
     */
    async getCurrentUsage(userId) {
        try {
            // Get the user's subscription with plan config and features in ONE query
            const subscription = await prisma_1.prisma.subscription.findUnique({
                where: { user_id: userId },
                select: {
                    id: true,
                    current_period_start: true,
                    current_period_end: true,
                    plan_config: {
                        include: {
                            features: true
                        }
                    }
                }
            });
            if (!subscription) {
                // Return default values for users without a subscription
                // They need to select a plan first
                logger_1.logger.warn(`[Usage] No subscription found for user ${userId}, returning default values`);
                const now = new Date();
                const periodEnd = new Date();
                periodEnd.setDate(periodEnd.getDate() + 30);
                return {
                    currentPeriodStart: now,
                    currentPeriodEnd: periodEnd,
                    mailboxesCount: 0,
                    messagesScanned: 0,
                    aiClassifications: 0,
                    apiCalls: 0,
                    storageUsedMb: 0,
                    limits: {
                        mailboxes: 0,
                        messagesScanned: 0,
                        aiClassifications: 0,
                        apiCalls: 0,
                        storageMb: 0,
                    }
                };
            }
            // Get the usage record for the current period
            let usageRecord = await prisma_1.prisma.usageTracking.findFirst({
                where: {
                    user_id: userId,
                    period_start: { gte: subscription.current_period_start },
                    period_end: { lte: subscription.current_period_end }
                }
            });
            // If no usage record exists for the current period, create one
            if (!usageRecord) {
                usageRecord = await prisma_1.prisma.usageTracking.create({
                    data: {
                        user_id: userId,
                        subscription_id: subscription.id,
                        period_start: subscription.current_period_start,
                        period_end: subscription.current_period_end,
                        mailboxes_count: 0,
                        messages_scanned: 0,
                        ai_classifications: 0,
                        api_calls: 0,
                        storage_used_mb: 0,
                    }
                });
            }
            // Extract limits from the subscription data (no additional queries!)
            const limits = this.extractLimitsFromSubscription(subscription);
            return {
                currentPeriodStart: subscription.current_period_start,
                currentPeriodEnd: subscription.current_period_end,
                mailboxesCount: usageRecord.mailboxes_count,
                messagesScanned: usageRecord.messages_scanned,
                aiClassifications: usageRecord.ai_classifications,
                apiCalls: usageRecord.api_calls,
                storageUsedMb: usageRecord.storage_used_mb,
                limits
            };
        }
        catch (error) {
            console.error(`[Usage] Failed to get current usage for user ${userId}:`, error);
            throw error;
        }
    }
    /**
     * Helper: Extract limits from subscription data without additional queries
     */
    extractLimitsFromSubscription(subscription) {
        const getFeatureValue = (key) => {
            if (!subscription.plan_config?.features)
                return null;
            const feature = subscription.plan_config.features.find((f) => f.feature_key === key);
            if (!feature)
                return null;
            const value = parseInt(feature.feature_value, 10);
            return isNaN(value) ? null : value;
        };
        return {
            mailboxes: getFeatureValue('max_mailboxes'),
            messagesScanned: getFeatureValue('max_messages_per_scan'),
            aiClassifications: getFeatureValue('max_ai_classifications_per_month'),
            apiCalls: getFeatureValue('api_rate_limit_requests_per_minute'),
            storageMb: getFeatureValue('max_storage_mb'),
        };
    }
    /**
     * Increments usage for a specific metric
     */
    async incrementUsage(userId, metric, amount = 1) {
        try {
            // Get the user's subscription to determine the current billing period
            const subscription = await prisma_1.prisma.subscription.findUnique({
                where: { user_id: userId },
                select: {
                    id: true,
                    current_period_start: true,
                    current_period_end: true
                }
            });
            if (!subscription) {
                // No subscription - log warning but don't fail the scan
                console.warn(`[Usage] No subscription found for user ${userId}, skipping usage tracking`);
                return;
            }
            // Get or create the usage record for the current period
            let usageRecord = await prisma_1.prisma.usageTracking.findFirst({
                where: {
                    user_id: userId,
                    period_start: { gte: subscription.current_period_start },
                    period_end: { lte: subscription.current_period_end }
                }
            });
            // If no usage record exists, create one
            if (!usageRecord) {
                console.log(`[Usage] Creating new usage tracking record for user ${userId}`);
                usageRecord = await prisma_1.prisma.usageTracking.create({
                    data: {
                        user_id: userId,
                        subscription_id: subscription.id,
                        period_start: subscription.current_period_start,
                        period_end: subscription.current_period_end,
                        mailboxes_count: 0,
                        messages_scanned: 0,
                        ai_classifications: 0,
                        api_calls: 0,
                        storage_used_mb: 0,
                    }
                });
            }
            // Prepare the update data based on the metric
            const updateData = {};
            switch (metric) {
                case 'mailboxesCount':
                    updateData.mailboxes_count = { increment: amount };
                    break;
                case 'messagesScanned':
                    updateData.messages_scanned = { increment: amount };
                    break;
                case 'aiClassifications':
                    updateData.ai_classifications = { increment: amount };
                    break;
                case 'apiCalls':
                    updateData.api_calls = { increment: amount };
                    break;
                case 'storageUsedMb':
                    updateData.storage_used_mb = { increment: amount };
                    break;
                default:
                    throw new Error(`Unknown usage metric: ${metric}`);
            }
            // Update the usage record
            await prisma_1.prisma.usageTracking.update({
                where: { id: usageRecord.id },
                data: updateData
            });
            console.log(`[Usage] Incremented for user ${userId}, metric: ${metric}, amount: ${amount}`);
        }
        catch (error) {
            console.error(`[Usage] Failed to increment usage for user ${userId}, metric ${metric}:`, error);
            throw error;
        }
    }
    /**
     * Checks if a user has exceeded their limit for a specific metric
     */
    async checkLimitExceeded(userId, metric) {
        try {
            // Check if user is admin - admins get unlimited access
            const user = await prisma_1.prisma.user.findUnique({
                where: { id: userId },
                select: { role: true }
            });
            if (user?.role === 'admin' || user?.role === 'owner') {
                console.log(`[Usage] ${user.role} user ${userId} bypasses limit check for ${metric}`);
                return { exceeded: false, currentUsage: 0, limit: null };
            }
            // Get current usage
            const usageSummary = await this.getCurrentUsage(userId);
            let currentUsage;
            let limit;
            switch (metric) {
                case 'mailboxes':
                    currentUsage = usageSummary.mailboxesCount;
                    limit = usageSummary.limits.mailboxes;
                    break;
                case 'aiClassifications':
                    currentUsage = usageSummary.aiClassifications;
                    limit = usageSummary.limits.aiClassifications;
                    break;
                case 'apiCalls':
                    currentUsage = usageSummary.apiCalls;
                    limit = usageSummary.limits.apiCalls;
                    break;
                case 'storageMb':
                    currentUsage = usageSummary.storageUsedMb;
                    limit = usageSummary.limits.storageMb;
                    break;
                // Note: messagesScanned is handled differently as it's per-scan rather than cumulative
                default:
                    throw new Error(`Unknown limit metric: ${metric}`);
            }
            // If no limit is set, return false (not exceeded)
            if (limit === null) {
                return { exceeded: false, currentUsage, limit };
            }
            return {
                exceeded: currentUsage >= limit,
                currentUsage,
                limit
            };
        }
        catch (error) {
            console.error(`[Usage] Failed to check limit for user ${userId}, metric ${metric}:`, error);
            throw error;
        }
    }
    /**
     * Gets usage percentage for a specific metric
     */
    async getUsagePercentage(userId, metric) {
        try {
            const check = await this.checkLimitExceeded(userId, metric);
            if (check.limit === null || check.limit === 0 || isNaN(check.limit)) {
                return 0; // If no limit or limit is 0, return 0%
            }
            const percentage = (check.currentUsage / check.limit) * 100;
            // Round to 1 decimal place and ensure it's a valid number
            const rounded = Math.round(percentage * 10) / 10;
            return Math.min(100, isNaN(rounded) ? 0 : rounded);
        }
        catch (error) {
            console.error(`[Usage] Failed to get usage percentage for user ${userId}, metric ${metric}:`, error);
            // Return 0 instead of throwing to prevent UI errors
            return 0;
        }
    }
    /**
     * Resets usage for a new billing period (typically called when subscription is updated)
     */
    async resetUsageForNewPeriod(userId) {
        try {
            // Get the user's subscription
            const subscription = await prisma_1.prisma.subscription.findUnique({
                where: { user_id: userId },
                select: {
                    id: true,
                    current_period_start: true,
                    current_period_end: true
                }
            });
            if (!subscription) {
                throw new Error(`No subscription found for user ${userId}`);
            }
            // Check if we already have a record for this period
            const existingRecord = await prisma_1.prisma.usageTracking.findFirst({
                where: {
                    user_id: userId,
                    period_start: { gte: subscription.current_period_start },
                    period_end: { lte: subscription.current_period_end }
                }
            });
            if (existingRecord) {
                // If a record exists for this period, update it to reset counts
                await prisma_1.prisma.usageTracking.update({
                    where: { id: existingRecord.id },
                    data: {
                        mailboxes_count: 0,
                        messages_scanned: 0,
                        ai_classifications: 0,
                        api_calls: 0,
                        storage_used_mb: 0,
                    }
                });
            }
            else {
                // Otherwise, create a new record
                await prisma_1.prisma.usageTracking.create({
                    data: {
                        user_id: userId,
                        subscription_id: subscription.id,
                        period_start: subscription.current_period_start,
                        period_end: subscription.current_period_end,
                        mailboxes_count: 0,
                        messages_scanned: 0,
                        ai_classifications: 0,
                        api_calls: 0,
                        storage_used_mb: 0,
                    }
                });
            }
            console.log(`[Usage] Usage reset for new billing period for user ${userId}`);
        }
        catch (error) {
            console.error(`[Usage] Failed to reset usage for new period for user ${userId}:`, error);
            throw error;
        }
    }
    /**
     * Updates mailboxes count based on actual mailbox records
     */
    async updateMailboxesCount(userId) {
        try {
            // Get the user's subscription to determine the current billing period
            const subscription = await prisma_1.prisma.subscription.findUnique({
                where: { user_id: userId },
                select: {
                    id: true,
                    current_period_start: true,
                    current_period_end: true
                }
            });
            if (!subscription) {
                throw new Error(`No subscription found for user ${userId}`);
            }
            // Count the actual mailboxes for the user
            const mailboxCount = await prisma_1.prisma.mailbox.count({
                where: { user_id: userId }
            });
            // Get the usage record for the current period
            const usageRecord = await prisma_1.prisma.usageTracking.findFirst({
                where: {
                    user_id: userId,
                    period_start: { gte: subscription.current_period_start },
                    period_end: { lte: subscription.current_period_end }
                }
            });
            if (!usageRecord) {
                throw new Error(`No usage record found for user ${userId} in current period`);
            }
            // Update the mailboxes count
            await prisma_1.prisma.usageTracking.update({
                where: { id: usageRecord.id },
                data: {
                    mailboxes_count: mailboxCount
                }
            });
            console.log(`[Usage] Mailbox count updated for user ${userId}: ${mailboxCount}`);
        }
        catch (error) {
            console.error(`[Usage] Failed to update mailboxes count for user ${userId}:`, error);
            throw error;
        }
    }
    /**
     * Checks usage thresholds and sends warning emails if needed
     * Call this after incrementing usage to trigger warnings at 80% and 100%
     */
    async checkAndSendUsageWarnings(userId) {
        try {
            // Get user info with subscription
            const user = await prisma_1.prisma.user.findUnique({
                where: { id: userId },
                select: {
                    email: true,
                    name: true,
                    notification_preferences: {
                        select: {
                            usage_warning_enabled: true,
                            limit_reached_enabled: true,
                            email_enabled: true,
                        }
                    },
                    subscription: {
                        select: {
                            plan: true,
                        }
                    }
                }
            });
            if (!user) {
                console.warn(`[Usage] User ${userId} not found for usage warnings`);
                return;
            }
            // Check notification preferences
            const prefs = user.notification_preferences;
            const usageWarningsEnabled = prefs?.usage_warning_enabled ?? true;
            const limitReachedEnabled = prefs?.limit_reached_enabled ?? true;
            const emailEnabled = prefs?.email_enabled ?? true;
            if (!emailEnabled) {
                console.log(`[Usage] Email notifications disabled for user ${userId}`);
                return;
            }
            // Get plan name
            const planName = user.subscription?.plan || 'free';
            // Get current usage summary
            const usage = await this.getCurrentUsage(userId);
            // Check each metric for warnings
            const metrics = [
                {
                    name: 'Mailboxes',
                    feature: 'mailboxes',
                    current: usage.mailboxesCount,
                    limit: usage.limits.mailboxes,
                },
                {
                    name: 'Messages Scanned',
                    feature: 'messagesScanned',
                    current: usage.messagesScanned,
                    limit: usage.limits.messagesScanned,
                },
                {
                    name: 'AI Classifications',
                    feature: 'aiClassifications',
                    current: usage.aiClassifications,
                    limit: usage.limits.aiClassifications,
                },
            ];
            for (const metric of metrics) {
                if (metric.limit === null || metric.limit === 0)
                    continue;
                const percentage = Math.round((metric.current / metric.limit) * 100);
                // Send 100% warning (limit reached)
                if (percentage >= 100 && limitReachedEnabled) {
                    (0, email_service_1.sendUsageWarningEmailAsync)({
                        recipientEmail: user.email,
                        recipientName: user.name || undefined,
                        featureName: metric.name,
                        current: metric.current,
                        limit: metric.limit,
                        percentage: 100,
                        planName,
                        upgradeUrl: `${process.env.FRONTEND_URL || 'https://myinboxer.com'}/pricing`,
                    });
                    console.log(`[Usage] Sent 100% warning email for ${metric.name} to user ${userId}`);
                }
                // Send 80% warning (approaching limit)
                else if (percentage >= 80 && percentage < 100 && usageWarningsEnabled) {
                    (0, email_service_1.sendUsageWarningEmailAsync)({
                        recipientEmail: user.email,
                        recipientName: user.name || undefined,
                        featureName: metric.name,
                        current: metric.current,
                        limit: metric.limit,
                        percentage,
                        planName,
                        upgradeUrl: `${process.env.FRONTEND_URL || 'https://myinboxer.com'}/pricing`,
                    });
                    console.log(`[Usage] Sent ${percentage}% warning email for ${metric.name} to user ${userId}`);
                }
            }
        }
        catch (error) {
            console.error(`[Usage] Failed to check and send usage warnings for user ${userId}:`, error);
            // Don't throw - warning emails are non-critical
        }
    }
}
exports.UsageService = UsageService;
// Export a singleton instance of the usage service
exports.usageService = new UsageService();
