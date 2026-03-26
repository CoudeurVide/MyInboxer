"use strict";
/**
 * Feedback Routes
 * User feedback collection system
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.feedbackRoutes = void 0;
const zod_1 = require("zod");
const prisma_1 = require("../../lib/prisma");
const email_service_1 = require("../../services/email.service");
// Validation schemas
const submitFeedbackSchema = zod_1.z.object({
    rating: zod_1.z.number().int().min(1).max(5),
    comment: zod_1.z.string().optional().nullable(),
    page_url: zod_1.z.string().optional().nullable(),
    user_agent: zod_1.z.string().optional().nullable(),
});
const feedbackRoutes = async (app) => {
    /**
     * Submit feedback
     * POST /api/feedback
     */
    app.post('/', {
        preHandler: [app.authenticate],
        schema: {
            body: {
                type: 'object',
                required: ['rating'],
                properties: {
                    rating: { type: 'number', minimum: 1, maximum: 5 },
                    comment: { type: ['string', 'null'] },
                    page_url: { type: ['string', 'null'] },
                    user_agent: { type: ['string', 'null'] },
                },
            },
        },
    }, async (request, reply) => {
        try {
            const userId = request.user?.userId;
            if (!userId) {
                return reply.status(401).send({
                    success: false,
                    error: {
                        code: 'UNAUTHORIZED',
                        message: 'User not authenticated',
                    },
                });
            }
            // Validate request body
            const validatedData = submitFeedbackSchema.parse(request.body);
            // Check if feedback is enabled
            const settings = await prisma_1.prisma.systemSettings.findFirst();
            if (settings && !settings.feedback_enabled) {
                return reply.status(403).send({
                    success: false,
                    error: {
                        code: 'FEEDBACK_DISABLED',
                        message: 'Feedback feature is currently disabled',
                    },
                });
            }
            // Create feedback
            const feedback = await prisma_1.prisma.feedback.create({
                data: {
                    user_id: userId,
                    rating: validatedData.rating,
                    comment: validatedData.comment,
                    page_url: validatedData.page_url,
                    user_agent: validatedData.user_agent,
                },
            });
            app.log.info(`Feedback submitted by user ${userId}: ${validatedData.rating} stars`);
            // Send email notification to admins
            try {
                // Get user info
                const feedbackUser = await prisma_1.prisma.user.findUnique({
                    where: { id: userId },
                    select: { email: true, name: true },
                });
                // Get admin users
                const admins = await prisma_1.prisma.user.findMany({
                    where: {
                        role: { in: ['admin', 'owner'] },
                    },
                    select: { email: true },
                });
                // Send notification to each admin
                for (const admin of admins) {
                    (0, email_service_1.sendFeedbackNotificationEmailAsync)({
                        adminEmail: admin.email,
                        userEmail: feedbackUser?.email || 'Unknown',
                        userName: feedbackUser?.name || undefined,
                        rating: validatedData.rating,
                        comment: validatedData.comment || undefined,
                        pageUrl: validatedData.page_url || undefined,
                        feedbackId: feedback.id,
                        createdAt: feedback.created_at.toISOString(),
                    });
                }
                app.log.info(`Feedback notification sent to ${admins.length} admin(s)`);
            }
            catch (emailError) {
                // Don't fail the request if email notification fails
                app.log.error('Failed to send feedback notification email:', emailError);
            }
            return reply.status(201).send({
                success: true,
                data: {
                    feedback: {
                        id: feedback.id,
                        rating: feedback.rating,
                        created_at: feedback.created_at,
                    },
                },
            });
        }
        catch (error) {
            app.log.error('Submit feedback error:', error);
            if (error instanceof zod_1.z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'Invalid feedback data',
                        details: error.errors,
                    },
                });
            }
            throw error;
        }
    });
    /**
     * Get all feedback (Admin only)
     * GET /api/feedback
     */
    app.get('/', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user?.userId;
            if (!userId) {
                return reply.status(401).send({
                    success: false,
                    error: {
                        code: 'UNAUTHORIZED',
                        message: 'User not authenticated',
                    },
                });
            }
            // Check if user is admin
            const user = await prisma_1.prisma.user.findUnique({
                where: { id: userId },
                select: { role: true },
            });
            if (!user || (user.role !== 'admin' && user.role !== 'owner')) {
                return reply.status(403).send({
                    success: false,
                    error: {
                        code: 'FORBIDDEN',
                        message: 'Admin access required',
                    },
                });
            }
            // Get query parameters for filtering
            const { rating, startDate, endDate, limit = '100', offset = '0' } = request.query;
            // Build where clause
            const where = {};
            if (rating) {
                where.rating = parseInt(rating);
            }
            if (startDate || endDate) {
                where.created_at = {};
                if (startDate) {
                    where.created_at.gte = new Date(startDate);
                }
                if (endDate) {
                    where.created_at.lte = new Date(endDate);
                }
            }
            // Get feedback with user info
            const feedback = await prisma_1.prisma.feedback.findMany({
                where,
                include: {
                    user: {
                        select: {
                            id: true,
                            email: true,
                            name: true,
                        },
                    },
                },
                orderBy: {
                    created_at: 'desc',
                },
                take: parseInt(limit),
                skip: parseInt(offset),
            });
            // Get total count
            const total = await prisma_1.prisma.feedback.count({ where });
            // Calculate rating statistics
            const stats = await prisma_1.prisma.feedback.groupBy({
                by: ['rating'],
                _count: {
                    rating: true,
                },
            });
            const ratingStats = {
                1: 0,
                2: 0,
                3: 0,
                4: 0,
                5: 0,
            };
            stats.forEach((stat) => {
                ratingStats[stat.rating] = stat._count.rating;
            });
            const totalRatings = Object.values(ratingStats).reduce((sum, count) => sum + count, 0);
            const avgRating = totalRatings > 0
                ? Object.entries(ratingStats).reduce((sum, [rating, count]) => sum + parseInt(rating) * count, 0) / totalRatings
                : 0;
            return reply.status(200).send({
                success: true,
                data: {
                    feedback,
                    pagination: {
                        total,
                        limit: parseInt(limit),
                        offset: parseInt(offset),
                    },
                    statistics: {
                        total: totalRatings,
                        average: Math.round(avgRating * 10) / 10,
                        distribution: ratingStats,
                    },
                },
            });
        }
        catch (error) {
            app.log.error('Get feedback error:', error);
            throw error;
        }
    });
    /**
     * Export feedback to CSV (Admin only)
     * GET /api/feedback/export
     */
    app.get('/export', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user?.userId;
            if (!userId) {
                return reply.status(401).send({
                    success: false,
                    error: {
                        code: 'UNAUTHORIZED',
                        message: 'User not authenticated',
                    },
                });
            }
            // Check if user is admin
            const user = await prisma_1.prisma.user.findUnique({
                where: { id: userId },
                select: { role: true },
            });
            if (!user || (user.role !== 'admin' && user.role !== 'owner')) {
                return reply.status(403).send({
                    success: false,
                    error: {
                        code: 'FORBIDDEN',
                        message: 'Admin access required',
                    },
                });
            }
            // Get all feedback
            const feedback = await prisma_1.prisma.feedback.findMany({
                include: {
                    user: {
                        select: {
                            email: true,
                            name: true,
                        },
                    },
                },
                orderBy: {
                    created_at: 'desc',
                },
            });
            // Generate CSV
            const csvHeader = 'ID,User Email,User Name,Rating,Comment,Page URL,User Agent,Created At\n';
            const csvRows = feedback.map((f) => {
                const comment = f.comment ? `"${f.comment.replace(/"/g, '""')}"` : '';
                const pageUrl = f.page_url || '';
                const userAgent = f.user_agent ? `"${f.user_agent.replace(/"/g, '""')}"` : '';
                const userName = f.user.name || '';
                return `${f.id},"${f.user.email}","${userName}",${f.rating},${comment},"${pageUrl}",${userAgent},${f.created_at.toISOString()}`;
            });
            const csv = csvHeader + csvRows.join('\n');
            reply.header('Content-Type', 'text/csv');
            reply.header('Content-Disposition', `attachment; filename="feedback-export-${new Date().toISOString().split('T')[0]}.csv"`);
            return reply.send(csv);
        }
        catch (error) {
            app.log.error('Export feedback error:', error);
            throw error;
        }
    });
};
exports.feedbackRoutes = feedbackRoutes;
