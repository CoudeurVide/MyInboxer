"use strict";
/**
 * Reputation API Routes
 * Manage sender reputations
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = reputationRoutes;
const zod_1 = require("zod");
const reputation_service_1 = require("../../services/reputation.service");
// Validation schemas
const GetReputationsSchema = zod_1.z.object({
    score: zod_1.z.enum(['trusted', 'good', 'neutral', 'suspicious', 'blocked']).optional(),
    limit: zod_1.z.coerce.number().int().min(1).max(1000).optional(),
});
const BlockSenderSchema = zod_1.z.object({
    senderEmail: zod_1.z.string().email(),
});
async function reputationRoutes(app) {
    // Require authentication for ALL reputation routes
    app.addHook('onRequest', async (request, reply) => {
        await app.authenticate(request, reply);
    });
    // Get all reputations for current user
    app.get('/', async (request, reply) => {
        const userId = request.user.userId;
        try {
            const { score, limit } = GetReputationsSchema.parse(request.query);
            const reputations = await (0, reputation_service_1.getUserReputations)(userId, {
                score,
                limit,
            });
            // Enrich with labels and emojis for UI
            const enriched = reputations.map(rep => ({
                ...rep,
                emoji: (0, reputation_service_1.getReputationEmoji)(rep.reputation_score),
                label: (0, reputation_service_1.getReputationLabel)(rep.reputation_score),
            }));
            return reply.send({
                success: true,
                data: enriched,
            });
        }
        catch (error) {
            return reply.status(400).send({
                success: false,
                error: {
                    message: error.message || 'Failed to fetch reputations',
                },
            });
        }
    });
    // Get reputation statistics
    app.get('/stats', async (request, reply) => {
        const userId = request.user.userId;
        try {
            const stats = await (0, reputation_service_1.getReputationStats)(userId);
            return reply.send({
                success: true,
                data: stats,
            });
        }
        catch (error) {
            return reply.status(500).send({
                success: false,
                error: {
                    message: error.message || 'Failed to fetch reputation stats',
                },
            });
        }
    });
    // Get specific sender reputation
    app.get('/sender/:email', async (request, reply) => {
        const userId = request.user.userId;
        const { email } = request.params;
        try {
            const reputation = await (0, reputation_service_1.getSenderReputation)(userId, email);
            if (!reputation) {
                return reply.status(404).send({
                    success: false,
                    error: {
                        message: 'Sender reputation not found',
                    },
                });
            }
            return reply.send({
                success: true,
                data: {
                    ...reputation,
                    emoji: (0, reputation_service_1.getReputationEmoji)(reputation.reputation_score),
                    label: (0, reputation_service_1.getReputationLabel)(reputation.reputation_score),
                },
            });
        }
        catch (error) {
            return reply.status(500).send({
                success: false,
                error: {
                    message: error.message || 'Failed to fetch sender reputation',
                },
            });
        }
    });
    // Block a sender
    app.post('/block', async (request, reply) => {
        const userId = request.user.userId;
        try {
            const { senderEmail } = BlockSenderSchema.parse(request.body);
            const reputation = await (0, reputation_service_1.blockSender)(userId, senderEmail);
            return reply.send({
                success: true,
                data: {
                    ...reputation,
                    emoji: (0, reputation_service_1.getReputationEmoji)(reputation.reputation_score),
                    label: (0, reputation_service_1.getReputationLabel)(reputation.reputation_score),
                },
                message: `Sender ${senderEmail} has been blocked`,
            });
        }
        catch (error) {
            return reply.status(400).send({
                success: false,
                error: {
                    message: error.message || 'Failed to block sender',
                },
            });
        }
    });
    // Unblock a sender
    app.post('/unblock', async (request, reply) => {
        const userId = request.user.userId;
        try {
            const { senderEmail } = BlockSenderSchema.parse(request.body);
            const reputation = await (0, reputation_service_1.unblockSender)(userId, senderEmail);
            if (!reputation) {
                return reply.status(404).send({
                    success: false,
                    error: {
                        message: 'Sender reputation not found',
                    },
                });
            }
            return reply.send({
                success: true,
                data: {
                    ...reputation,
                    emoji: (0, reputation_service_1.getReputationEmoji)(reputation.reputation_score),
                    label: (0, reputation_service_1.getReputationLabel)(reputation.reputation_score),
                },
                message: `Sender ${senderEmail} has been unblocked`,
            });
        }
        catch (error) {
            return reply.status(400).send({
                success: false,
                error: {
                    message: error.message || 'Failed to unblock sender',
                },
            });
        }
    });
    // Get blocked senders (convenience endpoint)
    app.get('/blocked', async (request, reply) => {
        const userId = request.user.userId;
        try {
            const blockedSenders = await (0, reputation_service_1.getUserReputations)(userId, {
                score: 'blocked',
            });
            return reply.send({
                success: true,
                data: blockedSenders.map(rep => ({
                    sender_email: rep.sender_email,
                    sender_domain: rep.sender_domain,
                    blocked_at: rep.updated_at,
                    total_messages: rep.total_messages,
                })),
            });
        }
        catch (error) {
            return reply.status(500).send({
                success: false,
                error: {
                    message: error.message || 'Failed to fetch blocked senders',
                },
            });
        }
    });
    // Get trusted senders (convenience endpoint)
    app.get('/trusted', async (request, reply) => {
        const userId = request.user.userId;
        try {
            const trustedSenders = await (0, reputation_service_1.getUserReputations)(userId, {
                score: 'trusted',
            });
            return reply.send({
                success: true,
                data: trustedSenders.map(rep => ({
                    sender_email: rep.sender_email,
                    sender_domain: rep.sender_domain,
                    lead_count: rep.lead_count,
                    user_confirmed_lead: rep.user_confirmed_lead,
                    last_seen: rep.last_seen,
                })),
            });
        }
        catch (error) {
            return reply.status(500).send({
                success: false,
                error: {
                    message: error.message || 'Failed to fetch trusted senders',
                },
            });
        }
    });
}
