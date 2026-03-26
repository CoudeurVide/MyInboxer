"use strict";
/**
 * Feature Access Middleware for SpamRescue
 * Handles checking if a user has access to a specific feature based on their subscription plan
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireFeatureAccess = requireFeatureAccess;
exports.checkFeatureAccess = checkFeatureAccess;
exports.trackUsageForFeature = trackUsageForFeature;
const logger_1 = require("../lib/logger");
const plan_service_1 = require("../services/plan.service");
const usage_service_1 = require("../services/usage.service");
/**
 * Creates a middleware function that checks if the user has access to a specific feature
 * @param featureKey The key of the feature to check access for
 * @param checkUsageLimit Whether to check usage limits as well (for features like 'max_mailboxes')
 */
function requireFeatureAccess(featureKey, checkUsageLimit = false) {
    return async function (request, reply) {
        try {
            // Verify the user is authenticated first
            await request.jwtVerify();
            // Get the user info from the JWT
            const userId = request.user?.userId;
            if (!userId) {
                return reply.status(401).send({
                    success: false,
                    error: 'Authentication required',
                });
            }
            // Check if the user has access to this feature
            const featureAccess = await plan_service_1.planService.checkFeatureAccess(userId, featureKey);
            if (!featureAccess.hasAccess) {
                logger_1.logger.warn(`User ${userId} attempted to access restricted feature: ${featureKey}`);
                return reply.status(403).send({
                    success: false,
                    error: {
                        code: 'FEATURE_ACCESS_DENIED',
                        message: `Feature access denied: ${featureKey}`,
                        featureKey: featureKey
                    },
                });
            }
            // If this feature has usage limits, check them
            if (checkUsageLimit && featureAccess.limit !== undefined) {
                const usageCheck = await usage_service_1.usageService.checkLimitExceeded(userId, featureKey);
                if (usageCheck.exceeded) {
                    logger_1.logger.warn(`User ${userId} exceeded limit for feature: ${featureKey} (${usageCheck.currentUsage}/${usageCheck.limit})`);
                    return reply.status(403).send({
                        success: false,
                        error: {
                            code: 'USAGE_LIMIT_EXCEEDED',
                            message: `Usage limit exceeded for feature: ${featureKey}`,
                            featureKey: featureKey,
                            currentUsage: usageCheck.currentUsage,
                            limit: usageCheck.limit,
                        },
                    });
                }
            }
            // Attach feature access info to the request for use in handlers
            request.featureAccess = {
                featureKey,
                ...featureAccess
            };
        }
        catch (error) {
            logger_1.logger.error(`Feature access check failed for feature ${featureKey}:`, error);
            return reply.status(500).send({
                success: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: 'Failed to verify feature access',
                },
            });
        }
    };
}
/**
 * Checks if a user has access to a specific feature and logs a warning if not, but doesn't block the request
 */
function checkFeatureAccess(featureKey) {
    return async function (request, reply) {
        try {
            // Verify the user is authenticated first
            await request.jwtVerify();
            // Get the user info from the JWT
            const userId = request.user?.userId;
            if (!userId) {
                // Even if not authenticated, continue without feature check
                return;
            }
            // Check if the user has access to this feature
            const featureAccess = await plan_service_1.planService.checkFeatureAccess(userId, featureKey);
            // Attach feature access info to the request for use in handlers
            request.featureAccess = {
                featureKey,
                ...featureAccess
            };
            // Log if the feature access would be denied (but don't block)
            if (!featureAccess.hasAccess) {
                logger_1.logger.warn(`User ${userId} does not have access to feature: ${featureKey} (allowing request)`);
            }
        }
        catch (error) {
            logger_1.logger.error(`Feature access check failed for feature ${featureKey}:`, error);
            // Don't block the request on error, just continue
        }
    };
}
/**
 * Increases usage for a feature after the request completes (useful for endpoints that consume resources)
 */
function trackUsageForFeature(featureKey, metric = 'apiCalls') {
    return async function (request, reply) {
        try {
            // Get the user info from the JWT
            const userId = request.user?.userId;
            if (!userId) {
                return; // No user, no tracking
            }
            // Wait for the request to complete, then track usage
            reply.then(async () => {
                try {
                    await usage_service_1.usageService.incrementUsage(userId, metric, 1);
                    logger_1.logger.info(`Usage tracked for user ${userId}, feature ${featureKey}, metric ${metric}`);
                }
                catch (error) {
                    logger_1.logger.error(`Failed to track usage for user ${userId}, feature ${featureKey}:`, error);
                }
            });
        }
        catch (error) {
            logger_1.logger.error(`Failed to set up usage tracking for feature ${featureKey}:`, error);
        }
    };
}
