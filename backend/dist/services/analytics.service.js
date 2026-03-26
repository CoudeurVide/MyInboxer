"use strict";
/**
 * Analytics Service
 * Provides high-level analytics and insights from collected metrics
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAnalytics = getAnalytics;
exports.getRealTimeStats = getRealTimeStats;
exports.getTrendAnalysis = getTrendAnalysis;
exports.exportAnalytics = exportAnalytics;
const metrics_service_1 = require("./metrics.service");
/**
 * Get analytics data for a specific date range
 */
async function getAnalytics(userId, range = 'month') {
    try {
        // Calculate date range
        const endDate = new Date();
        endDate.setHours(23, 59, 59, 999);
        const startDate = new Date();
        startDate.setHours(0, 0, 0, 0);
        switch (range) {
            case 'week':
                startDate.setDate(startDate.getDate() - 7);
                break;
            case 'month':
                startDate.setDate(startDate.getDate() - 30);
                break;
            case 'quarter':
                startDate.setDate(startDate.getDate() - 90);
                break;
        }
        console.log(`[Analytics] Fetching analytics for user ${userId}, range: ${range}`);
        console.log(`[Analytics] Date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
        // Fetch all metrics in parallel
        const [dailyStats, summaryStats, accuracyStats] = await Promise.all([
            (0, metrics_service_1.getDailyMetrics)(userId, startDate, endDate),
            (0, metrics_service_1.getSummaryStats)(userId, startDate, endDate),
            (0, metrics_service_1.getAccuracyMetrics)(userId, startDate, endDate),
        ]);
        console.log(`[Analytics] Retrieved ${dailyStats.length} daily stats`);
        console.log(`[Analytics] Summary:`, summaryStats);
        return {
            stats: dailyStats,
            summary: {
                totalScanned: summaryStats.totalEmails,
                totalSpam: summaryStats.spamEmails,
                totalPromotions: summaryStats.promoEmails,
                totalLegit: summaryStats.legitEmails,
                totalClean: summaryStats.savedEmails,
                avgProcessingTime: summaryStats.avgProcessingTime,
                totalThreatsBlocked: summaryStats.threatsBlocked,
                aiClassifications: 0, // TODO: Track AI vs ML
                mlClassifications: 0,
            },
            accuracy: {
                overall: accuracyStats.overall,
                byCategory: accuracyStats.byCategory,
            },
            performance: {
                avgProcessingTime: summaryStats.avgProcessingTime,
                p95ProcessingTime: 0, // TODO: Calculate P95
                cacheHitRate: 0, // TODO: Track cache hits
            },
        };
    }
    catch (error) {
        console.error('[Analytics] Failed to get analytics:', error);
        throw error;
    }
}
/**
 * Get real-time statistics
 */
async function getRealTimeStats(userId) {
    // TODO: Implement real-time stats
    return {
        activeClassifications: 0,
        recentActivity: [],
        systemHealth: {
            status: 'healthy',
            avgResponseTime: 0,
            errorRate: 0,
        },
    };
}
/**
 * Get trend analysis
 */
async function getTrendAnalysis(userId, metric) {
    // TODO: Implement trend analysis
    return {
        trend: 'stable',
        percentageChange: 0,
        periodComparison: {
            current: 0,
            previous: 0,
        },
    };
}
/**
 * Export analytics data to CSV
 */
async function exportAnalytics(userId, range, format = 'csv') {
    const analytics = await getAnalytics(userId, range);
    if (format === 'json') {
        return JSON.stringify(analytics, null, 2);
    }
    // Convert to CSV
    const headers = ['Date', 'Total', 'Spam', 'Promotions', 'Leads', 'Clean'];
    const rows = analytics.stats.map(stat => [
        stat.date,
        stat.total,
        stat.spam,
        stat.promotions,
        stat.important,
        stat.clean,
    ]);
    const csv = [
        headers.join(','),
        ...rows.map(row => row.join(',')),
    ].join('\n');
    return csv;
}
