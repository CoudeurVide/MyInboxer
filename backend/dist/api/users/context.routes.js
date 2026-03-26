"use strict";
/**
 * User Context Routes
 * Handles onboarding questionnaire and user context for AI personalization
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.userContextRoutes = void 0;
const prisma_1 = require("../../lib/prisma");
const zod_1 = require("zod");
// Validation schema for user context
const UserContextSchema = zod_1.z.object({
    user_role: zod_1.z.string().optional(),
    user_role_custom: zod_1.z.string().optional(),
    primary_goal: zod_1.z.string().optional(),
    primary_goal_custom: zod_1.z.string().optional(),
    target_audience: zod_1.z.string().optional(),
    target_audience_custom: zod_1.z.string().optional(),
    whitelist_domains: zod_1.z.array(zod_1.z.string()).optional(),
    deal_breakers: zod_1.z.array(zod_1.z.string()).optional(),
    deal_breakers_custom: zod_1.z.string().optional(),
    spam_handling: zod_1.z.enum(['review_first', 'manual', 'auto_move']).optional(),
    priority_emails: zod_1.z.array(zod_1.z.string()).optional(),
    priority_emails_custom: zod_1.z.string().optional(),
    priority_senders: zod_1.z.array(zod_1.z.string()).optional(),
    priority_senders_custom: zod_1.z.string().optional(),
    timezone: zod_1.z.string().max(50).optional(),
});
const userContextRoutes = async (app) => {
    /**
     * Get user context
     * GET /api/users/context
     * Returns the user's AI personalization context
     */
    app.get('/context', {
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
            // Fetch user context
            const userContext = await prisma_1.prisma.userContext.findUnique({
                where: { user_id: userId },
            });
            // Also get onboarding status
            const user = await prisma_1.prisma.user.findUnique({
                where: { id: userId },
                select: {
                    onboarding_completed: true,
                    email: true,
                },
            });
            // Extract user's own domain from email
            const userDomain = user?.email?.split('@')[1] || '';
            return reply.status(200).send({
                success: true,
                data: {
                    context: userContext,
                    onboarding_completed: user?.onboarding_completed || false,
                    user_domain: userDomain,
                },
            });
        }
        catch (error) {
            console.error('[User Context] Error fetching context:', error);
            return reply.status(500).send({
                success: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: 'Failed to fetch user context',
                },
            });
        }
    });
    /**
     * Save user context (create or update)
     * POST /api/users/context
     * Saves the user's AI personalization context from onboarding
     */
    app.post('/context', {
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
            // Validate request body
            const validation = UserContextSchema.safeParse(request.body);
            if (!validation.success) {
                return reply.status(400).send({
                    success: false,
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'Invalid request data',
                        details: validation.error.errors,
                    },
                });
            }
            const data = validation.data;
            // Clean up whitelist domains (remove empty strings, normalize)
            const cleanedDomains = (data.whitelist_domains || [])
                .map(d => d.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0])
                .filter(d => d.length > 0);
            // Upsert user context
            const userContext = await prisma_1.prisma.userContext.upsert({
                where: { user_id: userId },
                create: {
                    user_id: userId,
                    user_role: data.user_role,
                    user_role_custom: data.user_role_custom,
                    primary_goal: data.primary_goal,
                    primary_goal_custom: data.primary_goal_custom,
                    target_audience: data.target_audience,
                    target_audience_custom: data.target_audience_custom,
                    whitelist_domains: cleanedDomains,
                    deal_breakers: data.deal_breakers || [],
                    deal_breakers_custom: data.deal_breakers_custom,
                    spam_handling: data.spam_handling || 'review_first',
                    priority_emails: data.priority_emails || [],
                    priority_emails_custom: data.priority_emails_custom,
                    priority_senders: data.priority_senders || [],
                    priority_senders_custom: data.priority_senders_custom,
                    timezone: data.timezone,
                },
                update: {
                    user_role: data.user_role,
                    user_role_custom: data.user_role_custom,
                    primary_goal: data.primary_goal,
                    primary_goal_custom: data.primary_goal_custom,
                    target_audience: data.target_audience,
                    target_audience_custom: data.target_audience_custom,
                    whitelist_domains: cleanedDomains,
                    deal_breakers: data.deal_breakers || [],
                    deal_breakers_custom: data.deal_breakers_custom,
                    spam_handling: data.spam_handling,
                    priority_emails: data.priority_emails || [],
                    priority_emails_custom: data.priority_emails_custom,
                    priority_senders: data.priority_senders || [],
                    priority_senders_custom: data.priority_senders_custom,
                    timezone: data.timezone,
                },
            });
            return reply.status(200).send({
                success: true,
                data: userContext,
                message: 'User context saved successfully',
            });
        }
        catch (error) {
            console.error('[User Context] Error saving context:', error);
            return reply.status(500).send({
                success: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: 'Failed to save user context',
                },
            });
        }
    });
    /**
     * Complete onboarding
     * POST /api/users/onboarding/complete
     * Marks the user's onboarding as complete
     */
    app.post('/onboarding/complete', {
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
            // Update user's onboarding status
            await prisma_1.prisma.user.update({
                where: { id: userId },
                data: { onboarding_completed: true },
            });
            return reply.status(200).send({
                success: true,
                message: 'Onboarding completed successfully',
            });
        }
        catch (error) {
            console.error('[User Context] Error completing onboarding:', error);
            return reply.status(500).send({
                success: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: 'Failed to complete onboarding',
                },
            });
        }
    });
    /**
     * Get onboarding status
     * GET /api/users/onboarding/status
     * Returns whether the user has completed onboarding
     */
    app.get('/onboarding/status', {
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
            const user = await prisma_1.prisma.user.findUnique({
                where: { id: userId },
                select: {
                    onboarding_completed: true,
                    mailboxes: {
                        select: { id: true },
                        take: 1,
                    },
                },
            });
            return reply.status(200).send({
                success: true,
                data: {
                    onboarding_completed: user?.onboarding_completed || false,
                    has_mailbox: (user?.mailboxes?.length || 0) > 0,
                },
            });
        }
        catch (error) {
            console.error('[User Context] Error fetching onboarding status:', error);
            return reply.status(500).send({
                success: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: 'Failed to fetch onboarding status',
                },
            });
        }
    });
    /**
     * Check auto-move suggestion status
     * GET /api/users/auto-move-suggestion
     * Returns whether the user should see the auto-move suggestion prompt
     */
    app.get('/auto-move-suggestion', {
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
            // Get user context
            const userContext = await prisma_1.prisma.userContext.findUnique({
                where: { user_id: userId },
            });
            // If user already has auto_move enabled or has dismissed the prompt, don't show
            if (userContext?.spam_handling === 'auto_move' || userContext?.auto_move_prompt_dismissed) {
                return reply.status(200).send({
                    success: true,
                    data: {
                        should_show: false,
                        reason: userContext?.spam_handling === 'auto_move' ? 'already_enabled' : 'dismissed',
                    },
                });
            }
            // Check if we're in the "remind later" period
            if (userContext?.auto_move_prompt_remind_at && new Date(userContext.auto_move_prompt_remind_at) > new Date()) {
                return reply.status(200).send({
                    success: true,
                    data: {
                        should_show: false,
                        reason: 'remind_later',
                        remind_at: userContext.auto_move_prompt_remind_at,
                    },
                });
            }
            // Get system settings for threshold
            const systemSettings = await prisma_1.prisma.systemSettings.findFirst();
            const threshold = systemSettings?.auto_move_suggestion_threshold || 20;
            const suggestionEnabled = systemSettings?.auto_move_suggestion_enabled ?? true;
            if (!suggestionEnabled) {
                return reply.status(200).send({
                    success: true,
                    data: {
                        should_show: false,
                        reason: 'disabled_by_admin',
                    },
                });
            }
            // Count user's reviewed messages (messages with user_verdict set)
            const reviewCount = await prisma_1.prisma.message.count({
                where: {
                    mailbox: {
                        user_id: userId,
                    },
                    user_verdict: {
                        not: null,
                    },
                },
            });
            const shouldShow = reviewCount >= threshold;
            return reply.status(200).send({
                success: true,
                data: {
                    should_show: shouldShow,
                    review_count: reviewCount,
                    threshold: threshold,
                    reason: shouldShow ? 'threshold_reached' : 'below_threshold',
                },
            });
        }
        catch (error) {
            console.error('[User Context] Error checking auto-move suggestion:', error);
            return reply.status(500).send({
                success: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: 'Failed to check auto-move suggestion status',
                },
            });
        }
    });
    /**
     * Update auto-move suggestion response
     * POST /api/users/auto-move-suggestion
     * Updates the user's response to the auto-move suggestion
     */
    app.post('/auto-move-suggestion', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user?.userId;
            const body = request.body;
            if (!userId) {
                return reply.status(401).send({
                    success: false,
                    error: {
                        code: 'UNAUTHORIZED',
                        message: 'User not authenticated',
                    },
                });
            }
            if (!body.action || !['enable', 'dismiss', 'remind_later'].includes(body.action)) {
                return reply.status(400).send({
                    success: false,
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'Invalid action. Must be enable, dismiss, or remind_later',
                    },
                });
            }
            // Update user context based on action
            if (body.action === 'enable') {
                // Enable auto-move for all user's mailboxes
                await prisma_1.prisma.userContext.upsert({
                    where: { user_id: userId },
                    create: {
                        user_id: userId,
                        spam_handling: 'auto_move',
                    },
                    update: {
                        spam_handling: 'auto_move',
                    },
                });
                // Also update all mailboxes to enable auto_move_on_classify
                await prisma_1.prisma.mailbox.updateMany({
                    where: { user_id: userId },
                    data: { auto_move_on_classify: true },
                });
                return reply.status(200).send({
                    success: true,
                    message: 'Auto-move enabled successfully',
                    data: { action: 'enabled' },
                });
            }
            else if (body.action === 'dismiss') {
                // User said "No thanks" - don't show again
                await prisma_1.prisma.userContext.upsert({
                    where: { user_id: userId },
                    create: {
                        user_id: userId,
                        auto_move_prompt_dismissed: true,
                    },
                    update: {
                        auto_move_prompt_dismissed: true,
                    },
                });
                return reply.status(200).send({
                    success: true,
                    message: 'Auto-move suggestion dismissed',
                    data: { action: 'dismissed' },
                });
            }
            else if (body.action === 'remind_later') {
                // User wants to be reminded later - set reminder for 7 days from now
                const remindAt = new Date();
                remindAt.setDate(remindAt.getDate() + 7);
                await prisma_1.prisma.userContext.upsert({
                    where: { user_id: userId },
                    create: {
                        user_id: userId,
                        auto_move_prompt_remind_at: remindAt,
                    },
                    update: {
                        auto_move_prompt_remind_at: remindAt,
                    },
                });
                return reply.status(200).send({
                    success: true,
                    message: 'Reminder set for 7 days from now',
                    data: { action: 'remind_later', remind_at: remindAt },
                });
            }
        }
        catch (error) {
            console.error('[User Context] Error updating auto-move suggestion:', error);
            return reply.status(500).send({
                success: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: 'Failed to update auto-move suggestion',
                },
            });
        }
    });
};
exports.userContextRoutes = userContextRoutes;
