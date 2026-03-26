"use strict";
/**
 * Admin Users Routes for SpamRescue
 * Handles admin operations for user management
 */
Object.defineProperty(exports, "__esModule", { value: true });
const zod_1 = require("zod");
const prisma_1 = require("../../lib/prisma");
const admin_middleware_1 = require("../../middleware/admin.middleware");
const subscription_service_1 = require("../../services/subscription.service");
const usage_service_1 = require("../../services/usage.service");
// Validation schemas
const GetUserSchema = zod_1.z.object({
    page: zod_1.z.coerce.number().min(1).optional().default(1),
    limit: zod_1.z.coerce.number().min(1).max(100).optional().default(20),
    search: zod_1.z.string().optional(),
    role: zod_1.z.enum(['owner', 'admin', 'member', 'readonly']).optional(),
});
const UpdateUserRoleSchema = zod_1.z.object({
    userId: zod_1.z.string().uuid(),
    role: zod_1.z.enum(['owner', 'admin', 'member', 'readonly']),
});
const UpdateUserSchema = zod_1.z.object({
    name: zod_1.z.string().optional(),
    email: zod_1.z.string().email().optional(),
    role: zod_1.z.enum(['owner', 'admin', 'member', 'readonly']).optional(),
});
const GetUserSubscriptionsSchema = zod_1.z.object({
    userId: zod_1.z.string().uuid(),
});
const AdminUsersRoutes = async (fastify) => {
    /**
     * GET /api/admin/users
     * Get all users with optional filters (admin only)
     */
    fastify.get('/users', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const { page, limit, search, role } = GetUserSchema.parse(request.query);
            const skip = (page - 1) * limit;
            const whereClause = {};
            if (search) {
                whereClause.OR = [
                    { email: { contains: search, mode: 'insensitive' } },
                    { name: { contains: search, mode: 'insensitive' } },
                ];
            }
            if (role)
                whereClause.role = role;
            const [users, totalCount] = await Promise.all([
                prisma_1.prisma.user.findMany({
                    where: whereClause,
                    select: {
                        id: true,
                        email: true,
                        name: true,
                        role: true,
                        created_at: true,
                        updated_at: true,
                        last_login_at: true,
                        subscription: {
                            select: {
                                id: true,
                                plan: true,
                                status: true,
                                current_period_end: true,
                            }
                        }
                    },
                    skip,
                    take: limit,
                    orderBy: { created_at: 'desc' }
                }),
                prisma_1.prisma.user.count({ where: whereClause })
            ]);
            return reply.send({
                success: true,
                data: {
                    users: users.map(user => ({
                        id: user.id,
                        email: user.email,
                        name: user.name || user.email.split('@')[0],
                        role: user.role,
                        created_at: user.created_at,
                        last_login: user.last_login_at,
                        subscription: user.subscription ? {
                            id: user.subscription.id,
                            plan: user.subscription.plan,
                            status: user.subscription.status,
                            current_period_end: user.subscription.current_period_end,
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
            request.log.error('Error getting users:', error?.message || String(error));
            if (error instanceof zod_1.z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid query parameters',
                    details: error.errors,
                });
            }
            return reply.status(500).send({
                success: false,
                error: 'Failed to get users',
            });
        }
    });
    /**
     * GET /api/admin/users/:userId
     * Get a specific user by ID
     */
    fastify.get('/users/:userId', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const { userId } = request.params;
            const user = await prisma_1.prisma.user.findUnique({
                where: { id: userId },
                include: {
                    subscription: {
                        include: {
                            plan_config: {
                                include: {
                                    features: true
                                }
                            }
                        }
                    },
                    usage_tracking: {
                        orderBy: { created_at: 'desc' },
                        take: 1
                    }
                }
            });
            if (!user) {
                return reply.status(404).send({
                    success: false,
                    error: 'User not found',
                });
            }
            return reply.send({
                success: true,
                data: {
                    user: {
                        id: user.id,
                        email: user.email,
                        name: user.name,
                        role: user.role,
                        created_at: user.created_at,
                        last_login: user.last_login_at,
                        subscription: user.subscription ? {
                            id: user.subscription.id,
                            plan: user.subscription.plan,
                            status: user.subscription.status,
                            current_period_end: user.subscription.current_period_end,
                        } : null,
                        mailboxes_count: user.usage_tracking[0]?.mailboxes_count || 0,
                        messages_scanned: user.usage_tracking[0]?.messages_scanned || 0,
                        ai_classifications: user.usage_tracking[0]?.ai_classifications || 0,
                    },
                },
            });
        }
        catch (error) {
            request.log.error('Error getting user:', error?.message || String(error));
            return reply.status(500).send({
                success: false,
                error: 'Failed to get user',
            });
        }
    });
    /**
     * PUT /api/admin/users/:userId
     * Update a user's information
     */
    fastify.put('/users/:userId', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const { userId } = request.params;
            const updateData = UpdateUserSchema.parse(request.body);
            // Check if the user exists
            const existingUser = await prisma_1.prisma.user.findUnique({
                where: { id: userId }
            });
            if (!existingUser) {
                return reply.status(404).send({
                    success: false,
                    error: 'User not found',
                });
            }
            // Update the user
            const updatedUser = await prisma_1.prisma.user.update({
                where: { id: userId },
                data: {
                    name: updateData.name,
                    email: updateData.email,
                    role: updateData.role,
                    updated_at: new Date(),
                },
                include: {
                    subscription: true
                }
            });
            return reply.send({
                success: true,
                message: 'User updated successfully',
                data: {
                    id: updatedUser.id,
                    email: updatedUser.email,
                    name: updatedUser.name,
                    role: updatedUser.role,
                    mfaEnabled: updatedUser.mfa_enabled,
                    createdAt: updatedUser.created_at,
                    updatedAt: updatedUser.updated_at,
                },
            });
        }
        catch (error) {
            request.log.error('Error updating user:', error?.message || String(error));
            if (error instanceof zod_1.z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid request body',
                    details: error.errors,
                });
            }
            return reply.status(500).send({
                success: false,
                error: 'Failed to update user',
            });
        }
    });
    /**
     * PATCH /api/admin/users/:userId/role
     * Update a user's role
     */
    fastify.patch('/users/:userId/role', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const { userId } = request.params;
            const { role } = UpdateUserRoleSchema.parse(request.body);
            // Check if the user exists
            const existingUser = await prisma_1.prisma.user.findUnique({
                where: { id: userId }
            });
            if (!existingUser) {
                return reply.status(404).send({
                    success: false,
                    error: 'User not found',
                });
            }
            // Update the user's role
            const updatedUser = await prisma_1.prisma.user.update({
                where: { id: userId },
                data: {
                    role: role,
                    updated_at: new Date(),
                }
            });
            return reply.send({
                success: true,
                message: `User role updated to ${role}`,
                data: {
                    id: updatedUser.id,
                    email: updatedUser.email,
                    role: updatedUser.role,
                    updatedAt: updatedUser.updated_at,
                },
            });
        }
        catch (error) {
            request.log.error('Error updating user role:', error?.message || String(error));
            if (error instanceof zod_1.z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid request body',
                    details: error.errors,
                });
            }
            return reply.status(500).send({
                success: false,
                error: 'Failed to update user role',
            });
        }
    });
    /**
     * GET /api/admin/users/:userId/usage
     * Get usage statistics for a specific user
     */
    fastify.get('/users/:userId/usage', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const { userId } = request.params;
            // Validate that the user exists
            const user = await prisma_1.prisma.user.findUnique({
                where: { id: userId }
            });
            if (!user) {
                return reply.status(404).send({
                    success: false,
                    error: 'User not found',
                });
            }
            // Get usage data
            const usage = await usage_service_1.usageService.getCurrentUsage(userId);
            return reply.send({
                success: true,
                data: {
                    userId: userId,
                    ...usage,
                },
            });
        }
        catch (error) {
            request.log.error('Error getting user usage:', error?.message || String(error));
            return reply.status(500).send({
                success: false,
                error: 'Failed to get user usage',
            });
        }
    });
    /**
     * GET /api/admin/users/:userId/subscriptions
     * Get subscription history for a specific user
     */
    fastify.get('/users/:userId/subscriptions', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const { userId } = request.params;
            // Validate that the user exists
            const user = await prisma_1.prisma.user.findUnique({
                where: { id: userId }
            });
            if (!user) {
                return reply.status(404).send({
                    success: false,
                    error: 'User not found',
                });
            }
            // Get subscription history
            const subscriptions = await prisma_1.prisma.subscription.findMany({
                where: { user_id: userId },
                orderBy: { created_at: 'desc' }
            });
            return reply.send({
                success: true,
                data: {
                    userId: userId,
                    subscriptions: subscriptions.map(sub => ({
                        id: sub.id,
                        plan: sub.plan,
                        status: sub.status,
                        currentPeriodStart: sub.current_period_start,
                        currentPeriodEnd: sub.current_period_end,
                        cancelAt: sub.cancel_at || undefined,
                        canceledAt: sub.canceled_at || undefined,
                        createdAt: sub.created_at,
                        updatedAt: sub.updated_at,
                        trialStart: sub.trial_start || undefined,
                        trialEnd: sub.trial_end || undefined,
                        stripeCustomerId: sub.stripe_customer_id || undefined,
                        stripeSubscriptionId: sub.stripe_subscription_id || undefined,
                    })),
                },
            });
        }
        catch (error) {
            request.log.error('Error getting user subscriptions:', error?.message || String(error));
            return reply.status(500).send({
                success: false,
                error: 'Failed to get user subscriptions',
            });
        }
    });
    /**
     * POST /api/admin/users/:userId/grant-trial
     * Grant a trial to a specific user
     */
    fastify.post('/users/:userId/grant-trial', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const { userId } = request.params;
            const { trialDays = 7 } = zod_1.z.object({ trialDays: zod_1.z.number().min(1).max(365).optional().default(7) }).parse(request.body);
            // Validate that the user exists
            const user = await prisma_1.prisma.user.findUnique({
                where: { id: userId }
            });
            if (!user) {
                return reply.status(404).send({
                    success: false,
                    error: 'User not found',
                });
            }
            // Grant the trial
            await subscription_service_1.subscriptionService.grantTrial(userId, trialDays);
            // Update usage tracking for the new trial period
            await usage_service_1.usageService.resetUsageForNewPeriod(userId);
            return reply.send({
                success: true,
                message: `Trial granted to user ${user.email} for ${trialDays} days`,
            });
        }
        catch (error) {
            request.log.error('Error granting trial to user:', error?.message || String(error));
            if (error instanceof zod_1.z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid request body',
                    details: error.errors,
                });
            }
            return reply.status(500).send({
                success: false,
                error: 'Failed to grant trial to user',
            });
        }
    });
    /**
     * POST /api/admin/users/:userId/change-plan
     * Change a user's subscription plan
     */
    fastify.post('/users/:userId/change-plan', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const { userId } = request.params;
            const { planName, isUpgrade = true } = zod_1.z.object({
                planName: zod_1.z.enum(['free', 'starter', 'growth', 'business']),
                isUpgrade: zod_1.z.boolean().optional().default(true),
            }).parse(request.body);
            // Validate that the user exists
            const user = await prisma_1.prisma.user.findUnique({
                where: { id: userId }
            });
            if (!user) {
                return reply.status(404).send({
                    success: false,
                    error: 'User not found',
                });
            }
            // Change the user's plan
            await subscription_service_1.subscriptionService.changeUserPlan(userId, planName, isUpgrade);
            return reply.send({
                success: true,
                message: `Plan changed for user ${user.email} to ${planName}`,
            });
        }
        catch (error) {
            request.log.error('Error changing user plan:', error?.message || String(error));
            if (error instanceof zod_1.z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid request body',
                    details: error.errors,
                });
            }
            return reply.status(500).send({
                success: false,
                error: 'Failed to change user plan',
            });
        }
    });
    /**
     * DELETE /api/admin/users/:userId
     * Delete a user account (admin only)
     */
    fastify.delete('/users/:userId', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const { userId } = request.params;
            // Validate that the user exists
            const user = await prisma_1.prisma.user.findUnique({
                where: { id: userId }
            });
            if (!user) {
                return reply.status(404).send({
                    success: false,
                    error: 'User not found',
                });
            }
            // Don't allow deletion of admin or owner users
            if (user.role === 'admin' || user.role === 'owner') {
                return reply.status(400).send({
                    success: false,
                    error: 'Cannot delete admin or owner accounts',
                });
            }
            // Delete the user (this will cascade delete related data due to the Prisma schema)
            await prisma_1.prisma.user.delete({
                where: { id: userId }
            });
            return reply.send({
                success: true,
                message: `User ${user.email} deleted successfully`,
            });
        }
        catch (error) {
            request.log.error('Error deleting user:', error?.message || String(error));
            return reply.status(500).send({
                success: false,
                error: 'Failed to delete user',
            });
        }
    });
    /**
     * GET /api/admin/users/stats
     * Get user statistics
     */
    fastify.get('/users/stats', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            // Get user statistics
            const [totalUsers, activeUsers, usersByRole, usersJoinedThisMonth, usersJoinedLastMonth] = await Promise.all([
                prisma_1.prisma.user.count(),
                prisma_1.prisma.user.count({
                    where: {
                        subscription: {
                            status: 'active'
                        }
                    }
                }),
                prisma_1.prisma.user.groupBy({
                    by: ['role'],
                    _count: true,
                }),
                prisma_1.prisma.user.count({
                    where: {
                        created_at: {
                            gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
                        }
                    }
                }),
                prisma_1.prisma.user.count({
                    where: {
                        created_at: {
                            gte: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1),
                            lt: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
                        }
                    }
                })
            ]);
            return reply.send({
                success: true,
                data: {
                    total: totalUsers,
                    active: activeUsers,
                    byRole: usersByRole,
                    joinedThisMonth: usersJoinedThisMonth,
                    joinedLastMonth: usersJoinedLastMonth,
                    growthRate: usersJoinedLastMonth > 0
                        ? ((usersJoinedThisMonth - usersJoinedLastMonth) / usersJoinedLastMonth) * 100
                        : 0,
                },
            });
        }
        catch (error) {
            request.log.error('Error getting user stats:', error?.message || String(error));
            return reply.status(500).send({
                success: false,
                error: 'Failed to get user statistics',
            });
        }
    });
};
exports.default = AdminUsersRoutes;
