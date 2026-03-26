"use strict";
/**
 * Subscription Guard Middleware
 * Blocks access to protected endpoints when a user's trial/subscription has expired.
 * This is the server-side enforcement — the frontend also shows banners and overlays,
 * but this middleware ensures users cannot bypass the UI restrictions.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireActiveSubscription = requireActiveSubscription;
const prisma_1 = require("../lib/prisma");
const logger_1 = require("../lib/logger");
/**
 * Middleware that checks if a user has an active subscription or trial.
 * Returns 403 if the trial/subscription has expired.
 * Should be applied to endpoints that require an active subscription (scan, messages, etc.)
 */
function requireActiveSubscription() {
    return async function (request, reply) {
        try {
            // Verify the user is authenticated first
            await request.jwtVerify();
            const userId = request.user?.userId;
            if (!userId) {
                return reply.status(401).send({
                    success: false,
                    error: 'Authentication required',
                });
            }
            const subscription = await prisma_1.prisma.subscription.findUnique({
                where: { user_id: userId },
                select: {
                    status: true,
                    trial_end: true,
                    current_period_end: true,
                    plan: true,
                },
            });
            // No subscription at all
            if (!subscription) {
                return reply.status(403).send({
                    success: false,
                    error: {
                        code: 'NO_SUBSCRIPTION',
                        message: 'No active subscription. Please select a plan to continue.',
                    },
                });
            }
            const now = new Date();
            // Trial expired
            if (subscription.status === 'trialing') {
                if (subscription.trial_end && new Date(subscription.trial_end) < now) {
                    logger_1.logger.warn(`[SubscriptionGuard] User ${userId} trial expired (ended ${subscription.trial_end}), blocking access`);
                    return reply.status(403).send({
                        success: false,
                        error: {
                            code: 'TRIAL_EXPIRED',
                            message: 'Your trial has expired. Please upgrade to continue using the service.',
                            trialExpired: true,
                        },
                    });
                }
                // Trial still active — allow
                return;
            }
            // Active subscription — allow
            if (subscription.status === 'active') {
                return;
            }
            // Past due — allow with grace
            if (subscription.status === 'past_due') {
                return;
            }
            // Cancelled — check if still within period
            if (subscription.status === 'cancelled') {
                if (subscription.current_period_end && new Date(subscription.current_period_end) > now) {
                    // Still within paid period — allow
                    return;
                }
                // Period has ended
                logger_1.logger.warn(`[SubscriptionGuard] User ${userId} subscription expired, blocking access`);
                return reply.status(403).send({
                    success: false,
                    error: {
                        code: 'SUBSCRIPTION_EXPIRED',
                        message: 'Your subscription has ended. Please resubscribe to continue.',
                    },
                });
            }
            // Unknown status — block
            logger_1.logger.warn(`[SubscriptionGuard] User ${userId} has unknown subscription status: ${subscription.status}`);
            return reply.status(403).send({
                success: false,
                error: {
                    code: 'SUBSCRIPTION_INACTIVE',
                    message: 'Your subscription is not active. Please contact support.',
                },
            });
        }
        catch (error) {
            logger_1.logger.error('[SubscriptionGuard] Error checking subscription:', error);
            // On error, allow access to avoid blocking legitimate users
            return;
        }
    };
}
