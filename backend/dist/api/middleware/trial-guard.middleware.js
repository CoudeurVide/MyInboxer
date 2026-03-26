"use strict";
/**
 * Trial Guard Middleware
 * Blocks access to protected features when trial has expired
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.trialGuardMiddleware = trialGuardMiddleware;
const subscription_service_1 = require("../../services/subscription.service");
async function trialGuardMiddleware(request, reply) {
    try {
        const userId = request.user?.userId;
        if (!userId) {
            return reply.status(401).send({
                success: false,
                error: 'Unauthorized',
            });
        }
        // Check subscription status
        const status = await subscription_service_1.subscriptionService.checkSubscriptionStatus(userId);
        if (!status.canUse) {
            return reply.status(403).send({
                success: false,
                error: status.reason || 'Access denied',
                trialExpired: status.trialExpired || false,
                code: status.status || 'access_denied',
            });
        }
        // If trial is expiring soon, add warning to response headers
        if (status.daysUntilExpiry !== undefined && status.daysUntilExpiry <= 3) {
            reply.header('X-Trial-Days-Left', status.daysUntilExpiry.toString());
            reply.header('X-Trial-Warning', 'Your trial is expiring soon. Please upgrade to continue.');
        }
    }
    catch (error) {
        console.error('[TrialGuard] Error checking subscription status:', error);
        // On error, allow access to avoid blocking legitimate users
    }
}
