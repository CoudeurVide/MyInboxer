"use strict";
/**
 * Admin Audit Routes for MyInboxer
 * Handles admin operations for viewing audit logs
 */
Object.defineProperty(exports, "__esModule", { value: true });
const zod_1 = require("zod");
const prisma_1 = require("../../lib/prisma");
const admin_middleware_1 = require("../../middleware/admin.middleware");
// Validation schemas
const GetAuditLogsSchema = zod_1.z.object({
    page: zod_1.z.coerce.number().min(1).optional().default(1),
    limit: zod_1.z.coerce.number().min(1).max(100).optional().default(50),
    userId: zod_1.z.string().uuid().optional(),
    action: zod_1.z.string().optional(),
    resource: zod_1.z.string().optional(),
    status: zod_1.z.enum(['success', 'failure', 'error']).optional(),
    startDate: zod_1.z.string().datetime().optional(),
    endDate: zod_1.z.string().datetime().optional(),
});
const AdminAuditRoutes = async (fastify) => {
    /**
     * GET /api/admin/audit
     * Get audit logs with optional filters (admin only)
     */
    fastify.get('/audit', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const { page, limit, userId, action, resource, status, startDate, endDate } = GetAuditLogsSchema.parse(request.query);
            const skip = (page - 1) * limit;
            // Build where clause
            const whereClause = {};
            if (userId)
                whereClause.user_id = userId;
            if (action)
                whereClause.action = { contains: action, mode: 'insensitive' };
            if (resource)
                whereClause.resource = { contains: resource, mode: 'insensitive' };
            if (status)
                whereClause.status = status;
            if (startDate || endDate) {
                whereClause.timestamp = {};
                if (startDate)
                    whereClause.timestamp.gte = new Date(startDate);
                if (endDate)
                    whereClause.timestamp.lte = new Date(endDate);
            }
            // Get logs and total count
            const [logs, totalCount] = await Promise.all([
                prisma_1.prisma.auditLog.findMany({
                    where: whereClause,
                    include: {
                        user: {
                            select: {
                                id: true,
                                email: true,
                                name: true,
                                role: true,
                            }
                        }
                    },
                    skip,
                    take: limit,
                    orderBy: { timestamp: 'desc' }
                }),
                prisma_1.prisma.auditLog.count({ where: whereClause })
            ]);
            return reply.send({
                success: true,
                data: {
                    logs: logs.map(log => ({
                        id: log.id,
                        action: log.action,
                        resource: log.resource,
                        resourceId: log.resource_id || undefined,
                        details: log.details || undefined,
                        ipAddress: log.ip_address,
                        userAgent: log.user_agent,
                        status: log.status,
                        timestamp: log.timestamp,
                        user: log.user ? {
                            id: log.user.id,
                            email: log.user.email,
                            name: log.user.name || log.user.email.split('@')[0],
                            role: log.user.role,
                        } : null,
                    })),
                    pagination: {
                        page,
                        limit,
                        total: totalCount,
                        pages: Math.ceil(totalCount / limit),
                    }
                },
            });
        }
        catch (error) {
            request.log.error({ err: error }, 'Error getting audit logs');
            if (error instanceof zod_1.z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid query parameters',
                    details: error.errors,
                });
            }
            return reply.status(500).send({
                success: false,
                error: 'Failed to get audit logs',
            });
        }
    });
    /**
     * GET /api/admin/audit/stats
     * Get audit log statistics
     */
    fastify.get('/audit/stats', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const now = new Date();
            const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);
            const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            const [totalLogs, logsLast24h, logsLast7d, logsLast30d, logsByAction, logsByStatus, topUsers,] = await Promise.all([
                prisma_1.prisma.auditLog.count(),
                prisma_1.prisma.auditLog.count({
                    where: { timestamp: { gte: last24Hours } }
                }),
                prisma_1.prisma.auditLog.count({
                    where: { timestamp: { gte: last7Days } }
                }),
                prisma_1.prisma.auditLog.count({
                    where: { timestamp: { gte: last30Days } }
                }),
                prisma_1.prisma.auditLog.groupBy({
                    by: ['action'],
                    _count: true,
                    orderBy: { _count: { action: 'desc' } },
                    take: 10,
                }),
                prisma_1.prisma.auditLog.groupBy({
                    by: ['status'],
                    _count: true,
                }),
                prisma_1.prisma.auditLog.groupBy({
                    by: ['user_id'],
                    _count: true,
                    orderBy: { _count: { user_id: 'desc' } },
                    take: 10,
                    where: { user_id: { not: null } }
                }),
            ]);
            // Get user details for top users
            const topUserIds = topUsers.map(u => u.user_id).filter(Boolean);
            const userDetails = await prisma_1.prisma.user.findMany({
                where: { id: { in: topUserIds } },
                select: { id: true, email: true, name: true, role: true }
            });
            const userMap = new Map(userDetails.map(u => [u.id, u]));
            return reply.send({
                success: true,
                data: {
                    total: totalLogs,
                    last24Hours: logsLast24h,
                    last7Days: logsLast7d,
                    last30Days: logsLast30d,
                    byAction: logsByAction.map(item => ({
                        action: item.action,
                        count: item._count,
                    })),
                    byStatus: logsByStatus.map(item => ({
                        status: item.status,
                        count: item._count,
                    })),
                    topUsers: topUsers.map(item => {
                        const user = userMap.get(item.user_id);
                        return {
                            userId: item.user_id,
                            count: item._count,
                            email: user?.email || 'Unknown',
                            name: user?.name || user?.email?.split('@')[0] || 'Unknown',
                            role: user?.role || 'unknown',
                        };
                    }),
                },
            });
        }
        catch (error) {
            request.log.error({ err: error }, 'Error getting audit stats');
            return reply.status(500).send({
                success: false,
                error: 'Failed to get audit statistics',
            });
        }
    });
    /**
     * GET /api/admin/audit/:logId
     * Get a specific audit log entry by ID
     */
    fastify.get('/audit/:logId', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const { logId } = request.params;
            const log = await prisma_1.prisma.auditLog.findUnique({
                where: { id: logId },
                include: {
                    user: {
                        select: {
                            id: true,
                            email: true,
                            name: true,
                            role: true,
                        }
                    }
                }
            });
            if (!log) {
                return reply.status(404).send({
                    success: false,
                    error: 'Audit log not found',
                });
            }
            return reply.send({
                success: true,
                data: {
                    id: log.id,
                    action: log.action,
                    resource: log.resource,
                    resourceId: log.resource_id || undefined,
                    details: log.details || undefined,
                    ipAddress: log.ip_address,
                    userAgent: log.user_agent,
                    status: log.status,
                    timestamp: log.timestamp,
                    user: log.user ? {
                        id: log.user.id,
                        email: log.user.email,
                        name: log.user.name || log.user.email.split('@')[0],
                        role: log.user.role,
                    } : null,
                },
            });
        }
        catch (error) {
            request.log.error({ err: error }, 'Error getting audit log');
            return reply.status(500).send({
                success: false,
                error: 'Failed to get audit log',
            });
        }
    });
};
exports.default = AdminAuditRoutes;
