"use strict";
/**
 * Webhook Routes
 * API endpoints for managing user webhooks
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const zod_1 = require("zod");
const prisma_1 = require("../../lib/prisma");
const crypto_1 = __importDefault(require("crypto"));
// Validation schemas
const CreateWebhookSchema = zod_1.z.object({
    url: zod_1.z.string().url('Must be a valid URL'),
    events: zod_1.z.array(zod_1.z.enum(['lead.found', 'scan.complete', 'scan.error', 'mailbox.disconnected'])).min(1, 'Must subscribe to at least one event'),
    enabled: zod_1.z.boolean().default(true),
});
const UpdateWebhookSchema = zod_1.z.object({
    url: zod_1.z.string().url('Must be a valid URL').optional(),
    events: zod_1.z.array(zod_1.z.enum(['lead.found', 'scan.complete', 'scan.error', 'mailbox.disconnected'])).min(1).optional(),
    enabled: zod_1.z.boolean().optional(),
});
const webhookRoutes = async (fastify) => {
    /**
     * GET /api/webhooks
     * List all webhooks for authenticated user
     */
    fastify.get('/', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        const userId = request.user?.userId;
        const webhooks = await prisma_1.prisma.webhook.findMany({
            where: { user_id: userId },
            select: {
                id: true,
                url: true,
                events: true,
                enabled: true,
                created_at: true,
                updated_at: true,
            },
            orderBy: { created_at: 'desc' },
        });
        return reply.send({
            success: true,
            data: { webhooks },
        });
    });
    /**
     * POST /api/webhooks
     * Create a new webhook
     */
    fastify.post('/', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        const userId = request.user.userId;
        // Validate body
        const validation = CreateWebhookSchema.safeParse(request.body);
        if (!validation.success) {
            return reply.status(400).send({
                success: false,
                error: 'Invalid request body',
                details: validation.error.issues,
            });
        }
        const { url, events, enabled } = validation.data;
        // Generate webhook secret for signature verification
        const secret = crypto_1.default.randomBytes(32).toString('hex');
        // Create webhook
        const webhook = await prisma_1.prisma.webhook.create({
            data: {
                user_id: userId,
                url,
                secret,
                events,
                enabled,
            },
            select: {
                id: true,
                url: true,
                secret: true, // Return secret only on creation
                events: true,
                enabled: true,
                created_at: true,
                updated_at: true,
            },
        });
        return reply.status(201).send({
            success: true,
            message: 'Webhook created successfully',
            data: { webhook },
        });
    });
    /**
     * GET /api/webhooks/:webhookId
     * Get a specific webhook
     */
    fastify.get('/:webhookId', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        const { webhookId } = request.params;
        const userId = request.user.userId;
        const webhook = await prisma_1.prisma.webhook.findFirst({
            where: {
                id: webhookId,
                user_id: userId,
            },
            select: {
                id: true,
                url: true,
                events: true,
                enabled: true,
                created_at: true,
                updated_at: true,
            },
        });
        if (!webhook) {
            return reply.status(404).send({
                success: false,
                error: 'Webhook not found',
            });
        }
        return reply.send({
            success: true,
            data: { webhook },
        });
    });
    /**
     * PUT /api/webhooks/:webhookId
     * Update a webhook
     */
    fastify.put('/:webhookId', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        const { webhookId } = request.params;
        const userId = request.user.userId;
        // Validate body
        const validation = UpdateWebhookSchema.safeParse(request.body);
        if (!validation.success) {
            return reply.status(400).send({
                success: false,
                error: 'Invalid request body',
                details: validation.error.issues,
            });
        }
        // Verify webhook ownership
        const existing = await prisma_1.prisma.webhook.findFirst({
            where: {
                id: webhookId,
                user_id: userId,
            },
        });
        if (!existing) {
            return reply.status(404).send({
                success: false,
                error: 'Webhook not found',
            });
        }
        // Update webhook
        const webhook = await prisma_1.prisma.webhook.update({
            where: { id: webhookId },
            data: validation.data,
            select: {
                id: true,
                url: true,
                events: true,
                enabled: true,
                created_at: true,
                updated_at: true,
            },
        });
        return reply.send({
            success: true,
            message: 'Webhook updated successfully',
            data: { webhook },
        });
    });
    /**
     * DELETE /api/webhooks/:webhookId
     * Delete a webhook
     */
    fastify.delete('/:webhookId', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        const { webhookId } = request.params;
        const userId = request.user.userId;
        // Verify webhook ownership
        const existing = await prisma_1.prisma.webhook.findFirst({
            where: {
                id: webhookId,
                user_id: userId,
            },
        });
        if (!existing) {
            return reply.status(404).send({
                success: false,
                error: 'Webhook not found',
            });
        }
        // Delete webhook
        await prisma_1.prisma.webhook.delete({
            where: { id: webhookId },
        });
        return reply.send({
            success: true,
            message: 'Webhook deleted successfully',
        });
    });
    /**
     * POST /api/webhooks/:webhookId/test
     * Send a test webhook event
     */
    fastify.post('/:webhookId/test', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        const { webhookId } = request.params;
        const userId = request.user.userId;
        // Verify webhook ownership
        const webhook = await prisma_1.prisma.webhook.findFirst({
            where: {
                id: webhookId,
                user_id: userId,
            },
        });
        if (!webhook) {
            return reply.status(404).send({
                success: false,
                error: 'Webhook not found',
            });
        }
        // Import webhook service (lazy load to avoid circular dependency)
        const { sendWebhook } = await Promise.resolve().then(() => __importStar(require('../../services/webhook.service')));
        // Send test event
        const testPayload = {
            event: 'test.event',
            timestamp: new Date().toISOString(),
            data: {
                message: 'This is a test webhook from SpamRescue',
            },
        };
        try {
            await sendWebhook(webhook.id, testPayload);
            return reply.send({
                success: true,
                message: 'Test webhook sent successfully',
            });
        }
        catch (error) {
            return reply.status(500).send({
                success: false,
                error: 'Failed to send test webhook',
                message: error.message,
            });
        }
    });
};
exports.default = webhookRoutes;
