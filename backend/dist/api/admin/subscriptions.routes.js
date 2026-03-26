"use strict";
/**
 * Admin Subscriptions Routes for SpamRescue
 * Handles admin operations for user subscriptions
 */
Object.defineProperty(exports, "__esModule", { value: true });
const zod_1 = require("zod");
const prisma_1 = require("../../lib/prisma");
const admin_middleware_1 = require("../../middleware/admin.middleware");
const subscription_service_1 = require("../../services/subscription.service");
const usage_service_1 = require("../../services/usage.service");
const stripe_service_1 = require("../../services/stripe.service");
// Validation schemas
const GetSubscriptionsSchema = zod_1.z.object({
    page: zod_1.z.coerce.number().min(1).optional().default(1),
    limit: zod_1.z.coerce.number().min(1).max(100).optional().default(20),
    status: zod_1.z.enum(['active', 'cancelled', 'past_due', 'trialing']).optional(),
    plan: zod_1.z.enum(['free', 'starter', 'growth', 'business']).optional(),
    search: zod_1.z.string().optional(),
});
const UpdateSubscriptionSchema = zod_1.z.object({
    plan: zod_1.z.enum(['free', 'starter', 'growth', 'business']).optional(),
    status: zod_1.z.enum(['active', 'cancelled', 'past_due', 'trialing']).optional(),
    cancelAtPeriodEnd: zod_1.z.boolean().optional(),
});
const GrantTrialSchema = zod_1.z.object({
    userId: zod_1.z.string().uuid(),
    trialDays: zod_1.z.number().min(1).max(365).optional().default(7),
});
const ChangePlanSchema = zod_1.z.object({
    userId: zod_1.z.string().uuid(),
    planName: zod_1.z.enum(['free', 'starter', 'growth', 'business']),
    isUpgrade: zod_1.z.boolean().optional().default(true),
});
const AdminSubscriptionRoutes = async (fastify) => {
    /**
     * GET /api/admin/subscriptions
     * Get all subscriptions with optional filters (admin only)
     */
    fastify.get('/subscriptions', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const { page, limit, status, plan } = GetSubscriptionsSchema.parse(request.query);
            const skip = (page - 1) * limit;
            const whereClause = {};
            if (status)
                whereClause.status = status;
            if (plan)
                whereClause.plan = plan;
            const [subscriptions, totalCount] = await Promise.all([
                prisma_1.prisma.subscription.findMany({
                    where: whereClause,
                    include: {
                        user: {
                            select: {
                                id: true,
                                email: true,
                                name: true,
                                created_at: true,
                            }
                        }
                    },
                    skip,
                    take: limit,
                    orderBy: { created_at: 'desc' }
                }),
                prisma_1.prisma.subscription.count({ where: whereClause })
            ]);
            return reply.send({
                success: true,
                data: {
                    subscriptions: subscriptions.map(sub => ({
                        id: sub.id,
                        userId: sub.user_id,
                        user: {
                            id: sub.user.id,
                            email: sub.user.email,
                            name: sub.user.name || sub.user.email.split('@')[0],
                            joinedAt: sub.user.created_at,
                        },
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
            request.log.error('Error getting subscriptions:', error?.message || String(error));
            if (error instanceof zod_1.z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid query parameters',
                    details: error.errors,
                });
            }
            return reply.status(500).send({
                success: false,
                error: 'Failed to get subscriptions',
            });
        }
    });
    /**
     * GET /api/admin/subscriptions/:subscriptionId
     * Get a specific subscription by ID
     */
    fastify.get('/subscriptions/:subscriptionId', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const { subscriptionId } = request.params;
            const subscription = await prisma_1.prisma.subscription.findUnique({
                where: { id: subscriptionId },
                include: {
                    user: {
                        select: {
                            id: true,
                            email: true,
                            name: true,
                            created_at: true,
                        }
                    }
                }
            });
            if (!subscription) {
                return reply.status(404).send({
                    success: false,
                    error: 'Subscription not found',
                });
            }
            return reply.send({
                success: true,
                data: {
                    id: subscription.id,
                    userId: subscription.user_id,
                    user: {
                        id: subscription.user.id,
                        email: subscription.user.email,
                        name: subscription.user.name || subscription.user.email.split('@')[0],
                        joinedAt: subscription.user.created_at,
                    },
                    plan: subscription.plan,
                    status: subscription.status,
                    currentPeriodStart: subscription.current_period_start,
                    currentPeriodEnd: subscription.current_period_end,
                    cancelAt: subscription.cancel_at || undefined,
                    canceledAt: subscription.canceled_at || undefined,
                    createdAt: subscription.created_at,
                    updatedAt: subscription.updated_at,
                    trialStart: subscription.trial_start || undefined,
                    trialEnd: subscription.trial_end || undefined,
                    stripeCustomerId: subscription.stripe_customer_id || undefined,
                    stripeSubscriptionId: subscription.stripe_subscription_id || undefined,
                },
            });
        }
        catch (error) {
            request.log.error('Error getting subscription:', error?.message || String(error));
            return reply.status(500).send({
                success: false,
                error: 'Failed to get subscription',
            });
        }
    });
    /**
     * PUT /api/admin/subscriptions/:subscriptionId
     * Update a subscription (change plan, status, etc.)
     */
    fastify.put('/subscriptions/:subscriptionId', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const { subscriptionId } = request.params;
            const updateData = UpdateSubscriptionSchema.parse(request.body);
            // Get the current subscription to access the user ID
            const currentSubscription = await prisma_1.prisma.subscription.findUnique({
                where: { id: subscriptionId }
            });
            if (!currentSubscription) {
                return reply.status(404).send({
                    success: false,
                    error: 'Subscription not found',
                });
            }
            // Update the subscription
            const updatedSubscription = await prisma_1.prisma.subscription.update({
                where: { id: subscriptionId },
                data: {
                    plan: updateData.plan || undefined,
                    status: updateData.status || undefined,
                    cancel_at: updateData.cancelAtPeriodEnd ? currentSubscription.current_period_end : null,
                    updated_at: new Date(),
                }
            });
            // If the plan was changed, reset usage tracking for the new plan
            if (updateData.plan) {
                await usage_service_1.usageService.resetUsageForNewPeriod(currentSubscription.user_id);
            }
            return reply.send({
                success: true,
                message: 'Subscription updated successfully',
                data: {
                    id: updatedSubscription.id,
                    userId: updatedSubscription.user_id,
                    plan: updatedSubscription.plan,
                    status: updatedSubscription.status,
                    currentPeriodStart: updatedSubscription.current_period_start,
                    currentPeriodEnd: updatedSubscription.current_period_end,
                    cancelAt: updatedSubscription.cancel_at || undefined,
                    canceledAt: updatedSubscription.canceled_at || undefined,
                    createdAt: updatedSubscription.created_at,
                    updatedAt: updatedSubscription.updated_at,
                },
            });
        }
        catch (error) {
            request.log.error('Error updating subscription:', error?.message || String(error));
            if (error instanceof zod_1.z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid request body',
                    details: error.errors,
                });
            }
            return reply.status(500).send({
                success: false,
                error: 'Failed to update subscription',
            });
        }
    });
    /**
     * POST /api/admin/subscriptions/grant-trial
     * Grant a trial to a specific user
     */
    fastify.post('/subscriptions/grant-trial', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const { userId, trialDays } = GrantTrialSchema.parse(request.body);
            // Check if the user exists
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
            request.log.error('Error granting trial:', error?.message || String(error));
            if (error instanceof zod_1.z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid request body',
                    details: error.errors,
                });
            }
            return reply.status(500).send({
                success: false,
                error: 'Failed to grant trial',
            });
        }
    });
    /**
     * POST /api/admin/subscriptions/change-plan
     * Change a user's subscription plan
     */
    fastify.post('/subscriptions/change-plan', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const { userId, planName, isUpgrade } = ChangePlanSchema.parse(request.body);
            // Check if the user exists
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
     * POST /api/admin/subscriptions/cancel
     * Cancel a user's subscription
     */
    fastify.post('/subscriptions/cancel', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const { userId } = zod_1.z.object({ userId: zod_1.z.string().uuid() }).parse(request.body);
            // Check if the user exists
            const user = await prisma_1.prisma.user.findUnique({
                where: { id: userId }
            });
            if (!user) {
                return reply.status(404).send({
                    success: false,
                    error: 'User not found',
                });
            }
            // Get the subscription to check if it's already canceled
            const subscription = await prisma_1.prisma.subscription.findUnique({
                where: { user_id: userId }
            });
            if (!subscription) {
                return reply.status(404).send({
                    success: false,
                    error: 'User has no subscription',
                });
            }
            if (subscription.status === 'cancelled') {
                return reply.status(400).send({
                    success: false,
                    error: 'Subscription is already cancelled',
                });
            }
            // Cancel the subscription
            await subscription_service_1.subscriptionService.cancelSubscription(userId);
            return reply.send({
                success: true,
                message: `Subscription cancelled for user ${user.email}`,
            });
        }
        catch (error) {
            request.log.error('Error cancelling subscription:', error?.message || String(error));
            if (error instanceof zod_1.z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid request body',
                    details: error.errors,
                });
            }
            return reply.status(500).send({
                success: false,
                error: 'Failed to cancel subscription',
            });
        }
    });
    /**
     * GET /api/admin/subscriptions/:userId/usage
     * Get usage data for a specific user
     */
    fastify.get('/subscriptions/:userId/usage', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const { userId } = request.params;
            // Check if the user exists
            const user = await prisma_1.prisma.user.findUnique({
                where: { id: userId },
                include: {
                    subscription: true
                }
            });
            if (!user) {
                return reply.status(404).send({
                    success: false,
                    error: 'User not found',
                });
            }
            if (!user.subscription) {
                return reply.status(404).send({
                    success: false,
                    error: 'User has no subscription',
                });
            }
            // Get current usage data
            const usage = await usage_service_1.usageService.getCurrentUsage(userId);
            return reply.send({
                success: true,
                data: usage,
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
     * GET /api/admin/subscriptions/:subscriptionId/invoices
     * Get invoices for a specific subscription
     */
    fastify.get('/subscriptions/:subscriptionId/invoices', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const { subscriptionId } = request.params;
            const { limit = 10, startingAfter } = request.query;
            // Get the subscription to access the Stripe customer ID
            const subscription = await prisma_1.prisma.subscription.findUnique({
                where: { id: subscriptionId },
                select: { stripe_customer_id: true, user_id: true }
            });
            if (!subscription || !subscription.stripe_customer_id) {
                return reply.status(404).send({
                    success: false,
                    error: 'Subscription not found or has no Stripe customer ID',
                });
            }
            // Retrieve invoices from Stripe
            const stripeInvoices = await stripe_service_1.stripe.invoices.list({
                customer: subscription.stripe_customer_id,
                limit: typeof limit === 'number' ? limit : 10,
                ...(startingAfter && { starting_after: startingAfter }),
            });
            // Format the invoices for the response
            const invoices = stripeInvoices.data.map(invoice => ({
                id: invoice.id,
                number: invoice.number,
                status: invoice.status,
                amount: invoice.amount_paid,
                currency: invoice.currency,
                created: invoice.created,
                paidAt: invoice.status_transitions.paid_at,
                invoicePdf: invoice.invoice_pdf,
                hostedInvoiceUrl: invoice.hosted_invoice_url,
            }));
            return reply.send({
                success: true,
                data: {
                    invoices,
                    hasMore: stripeInvoices.has_more,
                },
            });
        }
        catch (error) {
            request.log.error('Error getting invoices:', error?.message || String(error));
            return reply.status(500).send({
                success: false,
                error: 'Failed to get invoices',
            });
        }
    });
    /**
     * GET /api/admin/subscriptions/stats
     * Get subscription statistics
     */
    fastify.get('/subscriptions/stats', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            // Get subscription statistics
            const [totalSubscriptions, activeSubscriptions, cancelledSubscriptions, subscriptionsByPlan, subscriptionsByStatus] = await Promise.all([
                prisma_1.prisma.subscription.count(),
                prisma_1.prisma.subscription.count({ where: { status: 'active' } }),
                prisma_1.prisma.subscription.count({ where: { status: 'cancelled' } }),
                prisma_1.prisma.subscription.groupBy({
                    by: ['plan'],
                    _count: true,
                }),
                prisma_1.prisma.subscription.groupBy({
                    by: ['status'],
                    _count: true,
                })
            ]);
            return reply.send({
                success: true,
                data: {
                    total: totalSubscriptions,
                    active: activeSubscriptions,
                    cancelled: cancelledSubscriptions,
                    byPlan: subscriptionsByPlan,
                    byStatus: subscriptionsByStatus,
                },
            });
        }
        catch (error) {
            request.log.error('Error getting subscription stats:', error?.message || String(error));
            return reply.status(500).send({
                success: false,
                error: 'Failed to get subscription statistics',
            });
        }
    });
};
exports.default = AdminSubscriptionRoutes;
