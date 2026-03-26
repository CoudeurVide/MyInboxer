"use strict";
/**
 * Admin Quota Monitoring Routes
 * Real-time API quota usage tracking for Gmail and Outlook
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.quotaRoutes = void 0;
const prisma_1 = require("../../lib/prisma");
const api_quota_service_1 = require("../../services/api-quota.service");
const scan_queue_service_1 = require("../../services/scan-queue.service");
const quotaRoutes = async (app) => {
    /**
     * GET /api/admin/quota/realtime - Get real-time quota usage
     */
    app.get('/realtime', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user?.userId;
            if (!userId) {
                return reply.status(401).send({
                    success: false,
                    error: 'Unauthorized',
                });
            }
            // Check if user is admin or owner
            const user = await prisma_1.prisma.user.findUnique({
                where: { id: userId },
                select: { role: true },
            });
            if (!user || (user.role !== 'admin' && user.role !== 'owner')) {
                return reply.status(403).send({
                    success: false,
                    error: 'Admin access required',
                });
            }
            // Get real-time quota usage from Redis
            const [gmailQuota, outlookQuota, queueStats] = await Promise.all([
                (0, api_quota_service_1.getGmailQuotaUsage)(userId), // Can show current user's quota
                (0, api_quota_service_1.getOutlookQuotaUsage)(),
                (0, scan_queue_service_1.getQueueStats)(),
            ]);
            return reply.status(200).send({
                success: true,
                data: {
                    gmail: gmailQuota,
                    outlook: outlookQuota,
                    queue: queueStats,
                    timestamp: new Date(),
                },
            });
        }
        catch (error) {
            app.log.error('Error getting realtime quota:', error?.message || String(error));
            return reply.status(500).send({
                success: false,
                error: 'Failed to get quota usage',
            });
        }
    });
    /**
     * GET /api/admin/quota/statistics - Get historical quota statistics
     */
    app.get('/statistics', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user?.userId;
            const { provider, startDate, endDate } = request.query;
            if (!userId) {
                return reply.status(401).send({
                    success: false,
                    error: 'Unauthorized',
                });
            }
            // Check if user is admin or owner
            const user = await prisma_1.prisma.user.findUnique({
                where: { id: userId },
                select: { role: true },
            });
            if (!user || (user.role !== 'admin' && user.role !== 'owner')) {
                return reply.status(403).send({
                    success: false,
                    error: 'Admin access required',
                });
            }
            const stats = await (0, api_quota_service_1.getQuotaStatistics)(provider, startDate ? new Date(startDate) : undefined, endDate ? new Date(endDate) : undefined);
            return reply.status(200).send({
                success: true,
                data: stats,
            });
        }
        catch (error) {
            app.log.error('Error getting quota statistics:', error?.message || String(error));
            return reply.status(500).send({
                success: false,
                error: 'Failed to get quota statistics',
            });
        }
    });
    /**
     * GET /api/admin/quota/logs - Get quota usage logs
     */
    app.get('/logs', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user?.userId;
            const { provider, limit = '100', offset = '0' } = request.query;
            if (!userId) {
                return reply.status(401).send({
                    success: false,
                    error: 'Unauthorized',
                });
            }
            // Check if user is admin or owner
            const user = await prisma_1.prisma.user.findUnique({
                where: { id: userId },
                select: { role: true },
            });
            if (!user || (user.role !== 'admin' && user.role !== 'owner')) {
                return reply.status(403).send({
                    success: false,
                    error: 'Admin access required',
                });
            }
            const where = {};
            if (provider) {
                where.provider = provider;
            }
            const [logs, total] = await Promise.all([
                prisma_1.prisma.apiQuotaLog.findMany({
                    where,
                    orderBy: { timestamp: 'desc' },
                    take: parseInt(limit),
                    skip: parseInt(offset),
                }),
                prisma_1.prisma.apiQuotaLog.count({ where }),
            ]);
            return reply.status(200).send({
                success: true,
                data: {
                    logs,
                    pagination: {
                        total,
                        limit: parseInt(limit),
                        offset: parseInt(offset),
                    },
                },
            });
        }
        catch (error) {
            app.log.error('Error getting quota logs:', error?.message || String(error));
            return reply.status(500).send({
                success: false,
                error: 'Failed to get quota logs',
            });
        }
    });
};
exports.quotaRoutes = quotaRoutes;
