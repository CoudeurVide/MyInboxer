"use strict";
/**
 * User Routes
 * Provides user-related endpoints
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.userRoutes = void 0;
const auth_service_1 = require("../../services/auth.service");
const prisma_1 = require("../../lib/prisma");
const session_service_1 = require("../../services/session.service");
const security_event_service_1 = require("../../services/security-event.service");
const userRoutes = async (app) => {
    /**
     * Get current user
     * GET /api/users/me
     * Returns authenticated user's profile information
     */
    app.get('/me', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const user = await auth_service_1.authService.getCurrentUser(request);
            return reply.status(200).send({
                success: true,
                data: {
                    user,
                },
            });
        }
        catch (error) {
            if (error.message === 'USER_NOT_FOUND') {
                return reply.status(404).send({
                    success: false,
                    error: {
                        code: 'USER_NOT_FOUND',
                        message: 'User not found',
                    },
                });
            }
            console.error('[Users API] Error fetching current user:', error);
            return reply.status(500).send({
                success: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: 'Failed to fetch user information',
                },
            });
        }
    });
    /**
     * Get user profile with subscription details
     * GET /api/users/profile
     * Returns detailed user profile including plan information
     */
    app.get('/profile', {
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
            // Fetch user with subscription details
            const user = await prisma_1.prisma.user.findUnique({
                where: { id: userId },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                    created_at: true,
                    subscription: {
                        select: {
                            plan: true,
                            status: true,
                            current_period_start: true,
                            current_period_end: true,
                        },
                    },
                },
            });
            if (!user) {
                return reply.status(404).send({
                    success: false,
                    error: {
                        code: 'USER_NOT_FOUND',
                        message: 'User not found',
                    },
                });
            }
            return reply.status(200).send({
                success: true,
                data: {
                    name: user.name || user.email.split('@')[0],
                    email: user.email,
                    role: user.role,
                    plan: user.subscription?.plan || 'free',
                    createdAt: user.created_at,
                    subscriptionStatus: user.subscription?.status || 'trialing',
                },
            });
        }
        catch (error) {
            console.error('[Users API] Error fetching user profile:', error);
            return reply.status(500).send({
                success: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: 'Failed to fetch user profile',
                },
            });
        }
    });
    /**
     * Get user UI preferences
     * GET /api/users/preferences
     * Returns user's UI preferences (theme, dashboard view, etc.)
     */
    app.get('/preferences', {
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
            // Fetch or create user preferences
            let preferences = await prisma_1.prisma.userPreferences.findUnique({
                where: { user_id: userId },
            });
            // Return defaults if no preferences exist yet
            if (!preferences) {
                return reply.status(200).send({
                    success: true,
                    data: {
                        theme: 'light',
                        dashboardView: 'grid',
                        messageSortOrder: 'latest',
                    },
                });
            }
            return reply.status(200).send({
                success: true,
                data: {
                    theme: preferences.theme,
                    dashboardView: preferences.dashboard_view,
                    messageSortOrder: preferences.message_sort_order,
                },
            });
        }
        catch (error) {
            console.error('[Users API] Error fetching user preferences:', error);
            return reply.status(500).send({
                success: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: 'Failed to fetch user preferences',
                },
            });
        }
    });
    /**
     * Update user UI preferences
     * PUT /api/users/preferences
     * Updates user's UI preferences (theme, dashboard view, etc.)
     */
    app.put('/preferences', {
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
            const body = request.body;
            // Validate input
            if (body.theme && !['light', 'dark', 'system'].includes(body.theme)) {
                return reply.status(400).send({
                    success: false,
                    error: {
                        code: 'INVALID_INPUT',
                        message: 'Invalid theme value. Must be "light", "dark", or "system".',
                    },
                });
            }
            if (body.dashboardView && !['grid', 'list'].includes(body.dashboardView)) {
                return reply.status(400).send({
                    success: false,
                    error: {
                        code: 'INVALID_INPUT',
                        message: 'Invalid dashboardView value. Must be "grid" or "list".',
                    },
                });
            }
            if (body.messageSortOrder && !['latest', 'oldest'].includes(body.messageSortOrder)) {
                return reply.status(400).send({
                    success: false,
                    error: {
                        code: 'INVALID_INPUT',
                        message: 'Invalid messageSortOrder value. Must be "latest" or "oldest".',
                    },
                });
            }
            // Upsert user preferences
            const preferences = await prisma_1.prisma.userPreferences.upsert({
                where: { user_id: userId },
                create: {
                    user_id: userId,
                    theme: body.theme || 'light',
                    dashboard_view: body.dashboardView || 'grid',
                    message_sort_order: body.messageSortOrder || 'latest',
                },
                update: {
                    ...(body.theme && { theme: body.theme }),
                    ...(body.dashboardView && { dashboard_view: body.dashboardView }),
                    ...(body.messageSortOrder && { message_sort_order: body.messageSortOrder }),
                },
            });
            return reply.status(200).send({
                success: true,
                data: {
                    theme: preferences.theme,
                    dashboardView: preferences.dashboard_view,
                    messageSortOrder: preferences.message_sort_order,
                },
                message: 'Preferences updated successfully',
            });
        }
        catch (error) {
            console.error('[Users API] Error updating user preferences:', error);
            return reply.status(500).send({
                success: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: 'Failed to update user preferences',
                },
            });
        }
    });
    /**
     * Export all user data (GDPR Subject Access Request)
     * GET /api/users/me/export
     * Returns all personal data associated with the user as JSON
     */
    app.get('/me/export', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user?.userId;
            // SECURITY: Strict userId validation — Prisma treats undefined as "no filter"
            if (!userId || typeof userId !== 'string') {
                return reply.status(401).send({
                    success: false,
                    error: { code: 'UNAUTHORIZED', message: 'User not authenticated' },
                });
            }
            // SECURITY: Verify user exists before exporting
            const user = await prisma_1.prisma.user.findUnique({
                where: { id: userId },
                select: {
                    id: true,
                    email: true,
                    name: true,
                    role: true,
                    phone: true,
                    phone_verified: true,
                    mfa_enabled: true,
                    onboarding_completed: true,
                    created_at: true,
                    updated_at: true,
                    last_login_at: true,
                },
            });
            if (!user) {
                return reply.status(404).send({
                    success: false,
                    error: { code: 'USER_NOT_FOUND', message: 'User not found' },
                });
            }
            // SECURITY: First fetch this user's mailbox IDs explicitly, then use those
            // IDs to query messages. This avoids relying on Prisma relation filters which
            // could silently return all data if the filter value is undefined.
            const userMailboxes = await prisma_1.prisma.mailbox.findMany({
                where: { user_id: userId },
                select: {
                    id: true,
                    provider: true,
                    email_address: true,
                    status: true,
                    monitored_folders: true,
                    created_at: true,
                    last_scan_at: true,
                },
            });
            const userMailboxIds = userMailboxes.map(m => m.id);
            // Fetch remaining user data in parallel
            const [subscription, messages, preferences, notificationPrefs, classificationSettings, customLists, senderReputations, userContext, feedback, auditLogs,] = await Promise.all([
                prisma_1.prisma.subscription.findUnique({
                    where: { user_id: userId },
                    select: {
                        plan: true,
                        status: true,
                        billing_cycle: true,
                        current_period_start: true,
                        current_period_end: true,
                        trial_start: true,
                        trial_end: true,
                        created_at: true,
                    },
                }),
                // SECURITY: Use explicit mailbox_id filter instead of relation filter
                userMailboxIds.length > 0
                    ? prisma_1.prisma.message.findMany({
                        where: { mailbox_id: { in: userMailboxIds } },
                        select: {
                            id: true,
                            mailbox_id: true,
                            subject: true,
                            sender_email: true,
                            sender_name: true,
                            recipient_email: true,
                            verdict: true,
                            user_verdict: true,
                            confidence_score: true,
                            received_at: true,
                            created_at: true,
                        },
                        orderBy: { received_at: 'desc' },
                        take: 10000,
                    })
                    : Promise.resolve([]),
                prisma_1.prisma.userPreferences.findUnique({
                    where: { user_id: userId },
                    select: { theme: true, dashboard_view: true, message_sort_order: true },
                }),
                prisma_1.prisma.notificationPreferences.findUnique({
                    where: { user_id: userId },
                }),
                prisma_1.prisma.classificationSettings.findUnique({
                    where: { user_id: userId },
                }),
                prisma_1.prisma.customList.findMany({
                    where: { user_id: userId },
                    select: { list_type: true, entry_type: true, value: true, reason: true, created_at: true },
                }),
                prisma_1.prisma.senderReputation.findMany({
                    where: { user_id: userId },
                    select: {
                        sender_email: true,
                        sender_domain: true,
                        reputation_score: true,
                        total_messages: true,
                        first_seen: true,
                        last_seen: true,
                    },
                }),
                prisma_1.prisma.userContext.findUnique({
                    where: { user_id: userId },
                }),
                prisma_1.prisma.feedback.findMany({
                    where: { user_id: userId },
                    select: { rating: true, comment: true, page_url: true, created_at: true },
                }),
                prisma_1.prisma.auditLog.findMany({
                    where: { user_id: userId },
                    select: { action: true, resource: true, status: true, timestamp: true },
                    orderBy: { timestamp: 'desc' },
                    take: 1000,
                }),
            ]);
            await (0, security_event_service_1.logSecurityEvent)({
                eventType: 'data_exported',
                userId,
                ipAddress: request.ip,
                userAgent: request.headers['user-agent'] || '',
            });
            // SECURITY: Explicit cache-control to prevent any caching of exported data
            reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, private');
            reply.header('Pragma', 'no-cache');
            return reply.status(200).send({
                success: true,
                data: {
                    exportedAt: new Date().toISOString(),
                    exportedForUserId: userId,
                    exportedForEmail: user.email,
                    user,
                    subscription,
                    mailboxes: userMailboxes,
                    messages: { count: messages.length, items: messages },
                    preferences,
                    notificationPreferences: notificationPrefs,
                    classificationSettings,
                    customLists,
                    senderReputations,
                    userContext,
                    feedback,
                    auditLogs,
                },
            });
        }
        catch (error) {
            console.error('[Users API] Error exporting user data:', error);
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to export user data' },
            });
        }
    });
    /**
     * Delete own account (GDPR Right to Erasure)
     * DELETE /api/users/me
     * Permanently deletes the user and all associated data
     */
    app.delete('/me', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user?.userId;
            if (!userId) {
                return reply.status(401).send({
                    success: false,
                    error: { code: 'UNAUTHORIZED', message: 'User not authenticated' },
                });
            }
            // Verify user exists
            const user = await prisma_1.prisma.user.findUnique({
                where: { id: userId },
                select: { id: true, email: true, role: true },
            });
            if (!user) {
                return reply.status(404).send({
                    success: false,
                    error: { code: 'USER_NOT_FOUND', message: 'User not found' },
                });
            }
            // Prevent the owner from deleting themselves (would orphan the system)
            if (user.role === 'owner') {
                return reply.status(403).send({
                    success: false,
                    error: {
                        code: 'OWNER_CANNOT_DELETE',
                        message: 'The account owner cannot self-delete. Please contact support or transfer ownership first.',
                    },
                });
            }
            // Log the deletion event before deleting (so we have a record)
            await (0, security_event_service_1.logSecurityEvent)({
                eventType: 'account_deleted',
                userId,
                ipAddress: request.ip,
                userAgent: request.headers['user-agent'] || '',
                details: { email: user.email, selfDelete: true },
            });
            // Invalidate all sessions
            await session_service_1.SessionService.invalidateAllUserSessions(userId);
            // Delete the user — Prisma cascades will handle related records
            // (mailboxes, messages, subscription, preferences, etc. all have onDelete: Cascade)
            await prisma_1.prisma.user.delete({
                where: { id: userId },
            });
            // Clear cookies
            reply.clearCookie('accessToken', { path: '/' });
            reply.clearCookie('refreshToken', { path: '/' });
            return reply.status(200).send({
                success: true,
                message: 'Your account and all associated data have been permanently deleted.',
            });
        }
        catch (error) {
            console.error('[Users API] Error deleting user account:', error);
            return reply.status(500).send({
                success: false,
                error: { code: 'INTERNAL_ERROR', message: 'Failed to delete account' },
            });
        }
    });
};
exports.userRoutes = userRoutes;
