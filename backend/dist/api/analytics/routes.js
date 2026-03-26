"use strict";
/**
 * Analytics API Routes
 * Provides analytics data to the frontend
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = analyticsRoutes;
const analytics_service_1 = require("../../services/analytics.service");
const rate_limit_1 = require("../../middleware/rate-limit");
const prisma_1 = require("../../lib/prisma");
async function analyticsRoutes(fastify) {
    /**
     * GET /api/analytics
     * Get analytics data for the authenticated user
     */
    fastify.get('/api/analytics', {
        preHandler: [fastify.authenticate, rate_limit_1.expensiveRateLimiter],
    }, async (request, reply) => {
        try {
            const userId = request.user?.userId;
            if (!userId) {
                return reply.code(401).send({ error: 'Unauthorized' });
            }
            const range = request.query.range || 'month';
            console.log(`[Analytics API] Fetching analytics for user ${userId}, range: ${range}`);
            const analytics = await (0, analytics_service_1.getAnalytics)(userId, range);
            console.log(`[Analytics API] Returning ${analytics.stats.length} data points`);
            return reply.send({
                success: true,
                data: analytics,
            });
        }
        catch (error) {
            console.error('[Analytics API] Error:', error);
            return reply.code(500).send({
                error: 'Failed to fetch analytics',
                message: error.message,
            });
        }
    });
    /**
     * GET /api/analytics/export
     * Export analytics data in CSV or JSON format
     */
    fastify.get('/api/analytics/export', {
        preHandler: [fastify.authenticate, rate_limit_1.expensiveRateLimiter],
    }, async (request, reply) => {
        try {
            const userId = request.user?.userId;
            if (!userId) {
                return reply.code(401).send({ error: 'Unauthorized' });
            }
            const range = request.query.range || 'month';
            const format = request.query.format || 'csv';
            const exportData = await (0, analytics_service_1.exportAnalytics)(userId, range, format);
            // Set appropriate headers
            if (format === 'csv') {
                reply.header('Content-Type', 'text/csv');
                reply.header('Content-Disposition', `attachment; filename=analytics-${range}.csv`);
            }
            else {
                reply.header('Content-Type', 'application/json');
                reply.header('Content-Disposition', `attachment; filename=analytics-${range}.json`);
            }
            return reply.send(exportData);
        }
        catch (error) {
            console.error('[Analytics Export] Error:', error);
            return reply.code(500).send({
                error: 'Failed to export analytics',
                message: error.message,
            });
        }
    });
    /**
     * GET /api/analytics/summary
     * Get quick summary statistics
     */
    fastify.get('/api/analytics/summary', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user?.userId;
            if (!userId) {
                return reply.code(401).send({ error: 'Unauthorized' });
            }
            const analytics = await (0, analytics_service_1.getAnalytics)(userId, 'month');
            return reply.send({
                success: true,
                data: {
                    summary: analytics.summary,
                    accuracy: analytics.accuracy,
                },
            });
        }
        catch (error) {
            console.error('[Analytics Summary] Error:', error);
            return reply.code(500).send({
                error: 'Failed to fetch summary',
                message: error.message,
            });
        }
    });
    /**
     * GET /api/analytics/dashboard-kpis
     * Get comprehensive dashboard KPIs
     */
    fastify.get('/api/analytics/dashboard-kpis', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user?.userId;
            if (!userId) {
                return reply.code(401).send({ error: 'Unauthorized' });
            }
            console.log(`[Dashboard KPIs] Fetching KPIs for user ${userId}`);
            // Get user's mailboxes
            const mailboxes = await prisma_1.prisma.mailbox.findMany({
                where: { user_id: userId },
                select: { id: true, status: true },
            });
            const mailboxIds = mailboxes.map(m => m.id);
            const activeMailboxes = mailboxes.filter(m => m.status === 'active').length;
            // Define time ranges
            const now = new Date();
            const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
            const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            const twoMonthsAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
            // 1. Average Confidence Score - All classified messages
            const confidenceResult = await prisma_1.prisma.message.aggregate({
                where: {
                    mailbox_id: { in: mailboxIds },
                },
                _avg: {
                    confidence_score: true,
                },
                _count: true,
            });
            const avgConfidence = confidenceResult._avg.confidence_score || 0;
            const totalMessages = confidenceResult._count;
            // 2. Classification Accuracy Rate - Based on user feedback
            const messagesWithFeedback = await prisma_1.prisma.message.findMany({
                where: {
                    mailbox_id: { in: mailboxIds },
                    user_verdict: { not: null },
                },
                select: {
                    verdict: true,
                    user_verdict: true,
                },
            });
            const totalFeedback = messagesWithFeedback.length;
            const correctClassifications = messagesWithFeedback.filter(m => m.verdict === m.user_verdict).length;
            const accuracyRate = totalFeedback > 0
                ? (correctClassifications / totalFeedback) * 100
                : 0;
            // 3. Saved Time (Hours) - Rescued messages (legit) * 30 seconds per message
            const rescuedCount = await prisma_1.prisma.message.count({
                where: {
                    mailbox_id: { in: mailboxIds },
                    verdict: 'legit',
                },
            });
            const savedTimeSeconds = rescuedCount * 30; // 30 seconds per email
            const savedTimeHours = savedTimeSeconds / 3600;
            // 4. Classification Distribution by Category
            const distributionResult = await prisma_1.prisma.message.groupBy({
                by: ['verdict'],
                where: {
                    mailbox_id: { in: mailboxIds },
                },
                _count: true,
            });
            const distribution = {
                legit: 0,
                spam: 0,
                promotion: 0,
            };
            distributionResult.forEach(item => {
                if (item.verdict in distribution) {
                    distribution[item.verdict] = item._count;
                }
            });
            // 5. Weekly/Monthly Trends - Count ALL classified messages (not just legit)
            // Counting only legit caused trends to always show 0% for new users
            const currentWeekTotal = await prisma_1.prisma.message.count({
                where: {
                    mailbox_id: { in: mailboxIds },
                    received_at: { gte: oneWeekAgo },
                },
            });
            const previousWeekTotal = await prisma_1.prisma.message.count({
                where: {
                    mailbox_id: { in: mailboxIds },
                    received_at: {
                        gte: twoWeeksAgo,
                        lt: oneWeekAgo,
                    },
                },
            });
            const currentMonthTotal = await prisma_1.prisma.message.count({
                where: {
                    mailbox_id: { in: mailboxIds },
                    received_at: { gte: oneMonthAgo },
                },
            });
            const previousMonthTotal = await prisma_1.prisma.message.count({
                where: {
                    mailbox_id: { in: mailboxIds },
                    received_at: {
                        gte: twoMonthsAgo,
                        lt: oneMonthAgo,
                    },
                },
            });
            // Calculate percentage changes - null when no data in both periods (hide on frontend)
            const weeklyChange = previousWeekTotal > 0
                ? ((currentWeekTotal - previousWeekTotal) / previousWeekTotal) * 100
                : currentWeekTotal > 0 ? 100 : null;
            const monthlyChange = previousMonthTotal > 0
                ? ((currentMonthTotal - previousMonthTotal) / previousMonthTotal) * 100
                : currentMonthTotal > 0 ? 100 : null;
            // 5b. Messages to Review - low confidence, not yet user-reviewed
            const toReviewCount = await prisma_1.prisma.message.count({
                where: {
                    mailbox_id: { in: mailboxIds },
                    confidence_score: { lt: 0.8 },
                    user_verdict: null,
                },
            });
            // 6. Daily trend data for the last 7 days (for chart)
            const dailyTrend = [];
            for (let i = 6; i >= 0; i--) {
                const dayStart = new Date(now);
                dayStart.setDate(dayStart.getDate() - i);
                dayStart.setHours(0, 0, 0, 0);
                const dayEnd = new Date(dayStart);
                dayEnd.setDate(dayEnd.getDate() + 1);
                const dayCount = await prisma_1.prisma.message.count({
                    where: {
                        mailbox_id: { in: mailboxIds },
                        received_at: {
                            gte: dayStart,
                            lt: dayEnd,
                        },
                    },
                });
                dailyTrend.push({
                    date: dayStart.toISOString().split('T')[0],
                    count: dayCount,
                });
            }
            const kpis = {
                // 1. Average Confidence Score
                avgConfidenceScore: {
                    value: Math.round(avgConfidence * 100) / 100,
                    percentage: Math.round(avgConfidence * 100),
                    totalClassified: totalMessages,
                },
                // 2. Classification Accuracy Rate
                accuracyRate: {
                    value: Math.round(accuracyRate * 100) / 100,
                    percentage: Math.round(accuracyRate),
                    correctCount: correctClassifications,
                    totalFeedback: totalFeedback,
                },
                // 3. Saved Time
                savedTime: {
                    hours: Math.round(savedTimeHours * 10) / 10,
                    minutes: Math.round(savedTimeSeconds / 60),
                    rescuedMessages: rescuedCount,
                },
                // 4. Classification Distribution
                distribution: {
                    ...distribution,
                    total: distribution.legit + distribution.spam + distribution.promotion,
                },
                // 5. Trends (all messages, not just legit)
                trends: {
                    weekly: {
                        current: currentWeekTotal,
                        previous: previousWeekTotal,
                        change: weeklyChange !== null ? Math.round(weeklyChange * 10) / 10 : null,
                        direction: (weeklyChange ?? 0) >= 0 ? 'up' : 'down',
                    },
                    monthly: {
                        current: currentMonthTotal,
                        previous: previousMonthTotal,
                        change: monthlyChange !== null ? Math.round(monthlyChange * 10) / 10 : null,
                        direction: (monthlyChange ?? 0) >= 0 ? 'up' : 'down',
                    },
                    dailyTrend,
                },
                // 5b. Messages to review (low confidence, no user verdict yet)
                toReview: toReviewCount,
                // 6. Active Mailboxes (keep existing)
                activeMailboxes: {
                    active: activeMailboxes,
                    total: mailboxes.length,
                },
            };
            console.log(`[Dashboard KPIs] Returning KPIs:`, {
                avgConfidence: kpis.avgConfidenceScore.percentage,
                accuracyRate: kpis.accuracyRate.percentage,
                savedHours: kpis.savedTime.hours,
                distribution: kpis.distribution,
                trends: { weekly: kpis.trends.weekly.change, monthly: kpis.trends.monthly.change },
            });
            return reply.send({
                success: true,
                data: kpis,
            });
        }
        catch (error) {
            console.error('[Dashboard KPIs] Error:', error);
            return reply.code(500).send({
                error: 'Failed to fetch dashboard KPIs',
                message: error.message,
            });
        }
    });
}
