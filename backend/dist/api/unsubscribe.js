"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.unsubscribeRoutes = unsubscribeRoutes;
const unsubscribe_service_factory_1 = require("../services/unsubscribe/unsubscribe-service-factory");
const prisma_1 = require("../lib/prisma");
const plan_service_1 = require("../services/plan.service");
const usage_service_1 = require("../services/usage.service");
const subscription_guard_middleware_1 = require("../middleware/subscription-guard.middleware");
const unsubscriberApiUrl = process.env.UNSUBSCRIBER_API_URL || 'http://localhost:5000';
// Create the service instance
const unsubscribeService = unsubscribe_service_factory_1.UnsubscribeServiceFactory.create({
    unsubscriberApiUrl
});
// Helper to get AI provider from settings
async function getAIProvider() {
    try {
        const settings = await prisma_1.prisma.systemSettings.findFirst();
        return settings?.ai_provider || 'openai';
    }
    catch (error) {
        console.error('[Unsubscribe] Error fetching AI provider:', error);
        return 'openai'; // Default fallback
    }
}
// Helper to check unsubscriber access
async function checkUnsubscriberAccess(userId) {
    try {
        // Check system settings
        const settings = await prisma_1.prisma.systemSettings.findFirst();
        if (settings && !settings.unsubscriber_enabled) {
            return { allowed: false, reason: 'Unsubscriber is currently disabled by administrator' };
        }
        // Check plan feature access
        const featureAccess = await plan_service_1.planService.checkFeatureAccess(userId, 'unsubscribe_automation');
        if (!featureAccess.hasAccess) {
            return { allowed: false, reason: 'Unsubscriber is not available in your plan. Please upgrade to Growth or Business.' };
        }
        return { allowed: true };
    }
    catch (error) {
        console.error('[Unsubscribe] Error checking access:', error);
        return { allowed: false, reason: 'Failed to verify access' };
    }
}
async function unsubscribeRoutes(fastify) {
    // Unsubscribe a single URL
    fastify.post('/unsubscribe', {
        preHandler: [fastify.authenticate, (0, subscription_guard_middleware_1.requireActiveSubscription)()],
    }, async (request, reply) => {
        try {
            const userId = request.user?.userId;
            if (!userId || typeof userId !== 'string') {
                return reply.code(401).send({ success: false, error: 'Invalid user identity' });
            }
            // Check if user has access to unsubscriber
            const accessCheck = await checkUnsubscriberAccess(userId);
            if (!accessCheck.allowed) {
                return reply.code(403).send({
                    success: false,
                    error: accessCheck.reason,
                    code: 'UNSUBSCRIBER_ACCESS_DENIED'
                });
            }
            // Get AI provider from system settings
            const aiProvider = await getAIProvider();
            const result = await unsubscribeService.unsubscribe(request.body, aiProvider);
            // Track AI usage for unsubscribe operations
            if (result.success && aiProvider !== 'none') {
                await usage_service_1.usageService.incrementUsage(userId, 'aiClassifications', 1).catch(() => { });
            }
            return reply.code(200).send(result);
        }
        catch (error) {
            request.log.error(error);
            return reply.code(500).send({ error: 'Internal server error' });
        }
    });
    // Batch unsubscribe
    fastify.post('/unsubscribe-batch', {
        preHandler: [fastify.authenticate, (0, subscription_guard_middleware_1.requireActiveSubscription)()],
    }, async (request, reply) => {
        try {
            const userId = request.user?.userId;
            if (!userId || typeof userId !== 'string') {
                return reply.code(401).send({ success: false, error: 'Invalid user identity' });
            }
            // Check if user has access to unsubscriber
            const accessCheck = await checkUnsubscriberAccess(userId);
            if (!accessCheck.allowed) {
                return reply.code(403).send({
                    success: false,
                    error: accessCheck.reason,
                    code: 'UNSUBSCRIBER_ACCESS_DENIED'
                });
            }
            // Get AI provider from system settings
            const aiProvider = await getAIProvider();
            const result = await unsubscribeService.batchUnsubscribe(request.body, aiProvider);
            // Track AI usage for batch unsubscribe (count successful AI-assisted operations)
            if (aiProvider !== 'none') {
                const successCount = result.results?.filter((r) => r.status === 'fulfilled' && r.value?.success).length || 0;
                if (successCount > 0) {
                    await usage_service_1.usageService.incrementUsage(userId, 'aiClassifications', successCount).catch(() => { });
                }
            }
            return reply.code(200).send(result);
        }
        catch (error) {
            request.log.error(error);
            return reply.code(500).send({ error: 'Internal server error' });
        }
    });
    // Get status of a specific unsubscribe operation
    fastify.get('/unsubscribe-status/:id', {
        preHandler: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const { id } = request.params;
            const status = await unsubscribeService.getStatus(id);
            if (!status) {
                return reply.code(404).send({ error: 'Status not found' });
            }
            return reply.code(200).send(status);
        }
        catch (error) {
            request.log.error(error);
            return reply.code(500).send({ error: 'Internal server error' });
        }
    });
}
