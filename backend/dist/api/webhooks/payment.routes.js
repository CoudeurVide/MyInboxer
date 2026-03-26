"use strict";
/**
 * Unified Payment Webhook Routes
 * Handles webhooks from all payment providers (Stripe, LemonSqueezy, etc.)
 */
Object.defineProperty(exports, "__esModule", { value: true });
const PaymentProviderFactory_1 = require("../../services/payment/PaymentProviderFactory");
const subscription_service_1 = require("../../services/subscription.service");
const prisma_1 = require("../../lib/prisma");
const logger_1 = require("../../lib/logger");
const paymentWebhookRoutes = async (fastify) => {
    /**
     * POST /api/webhooks/payment/:provider
     * Unified webhook endpoint for all payment providers
     * Handles: /payment/stripe, /payment/lemonsqueezy
     */
    fastify.post('/payment/:provider', {
        config: {
            // Disable body parsing to get raw body for signature verification
            rawBody: true,
        },
    }, async (request, reply) => {
        const { provider } = request.params;
        try {
            // Validate provider
            if (!['stripe', 'lemonsqueezy'].includes(provider)) {
                return reply.status(400).send({
                    success: false,
                    error: `Unknown payment provider: ${provider}`,
                });
            }
            const providerType = provider;
            // Check if provider is available
            if (!PaymentProviderFactory_1.PaymentProviderFactory.isProviderAvailable(providerType)) {
                logger_1.logger.error(`Webhook received for unavailable provider: ${provider}`);
                return reply.status(503).send({
                    success: false,
                    error: `Payment provider ${provider} is not configured`,
                });
            }
            // Get raw body and signature
            const rawBody = request.rawBody || JSON.stringify(request.body);
            const signature = this.getSignatureHeader(request, providerType);
            if (!signature) {
                logger_1.logger.error(`No signature header found for ${provider} webhook`);
                return reply.status(400).send({
                    success: false,
                    error: 'Missing webhook signature',
                });
            }
            // Get webhook secret from environment
            const webhookSecret = this.getWebhookSecret(providerType);
            if (!webhookSecret) {
                logger_1.logger.error(`No webhook secret configured for ${provider}`);
                return reply.status(500).send({
                    success: false,
                    error: 'Webhook secret not configured',
                });
            }
            // Get provider instance
            const paymentProvider = PaymentProviderFactory_1.PaymentProviderFactory.getProvider(providerType);
            // Validate and construct webhook event
            const event = await paymentProvider.validateWebhook(rawBody, signature, webhookSecret);
            logger_1.logger.info(`Webhook event received from ${provider}: ${event.type}`);
            // Check for duplicate events (idempotency)
            const existingEvent = await prisma_1.prisma.paymentProviderEvent.findFirst({
                where: {
                    provider: providerType,
                    provider_event_id: event.id,
                },
            });
            if (existingEvent) {
                logger_1.logger.info(`Duplicate webhook event ${event.id} from ${provider}, skipping`);
                return reply.status(200).send({
                    success: true,
                    message: 'Event already processed',
                });
            }
            // Log the event
            await prisma_1.prisma.paymentProviderEvent.create({
                data: {
                    provider: providerType,
                    provider_event_id: event.id,
                    event_type: event.type,
                    payload: event.data,
                    processed: false,
                    created_at: event.createdAt,
                },
            });
            // Process the webhook event
            const result = await paymentProvider.processWebhookEvent(event);
            if (result.success && result.subscriptionData) {
                // Update subscription in database
                const subscription = await prisma_1.prisma.subscription.findFirst({
                    where: {
                        OR: [
                            { provider_subscription_id: result.subscriptionData.providerSubscriptionId },
                            ...(providerType === 'stripe'
                                ? [{ stripe_subscription_id: result.subscriptionData.providerSubscriptionId }]
                                : []),
                        ],
                    },
                });
                if (subscription) {
                    // Use subscription service to handle the update
                    await subscription_service_1.subscriptionService.handleSubscriptionUpdate(result.subscriptionData.providerSubscriptionId, providerType);
                }
                else {
                    logger_1.logger.warn(`Subscription ${result.subscriptionData.providerSubscriptionId} not found in database for ${provider} webhook`);
                }
            }
            // Mark event as processed
            await prisma_1.prisma.paymentProviderEvent.updateMany({
                where: {
                    provider: providerType,
                    provider_event_id: event.id,
                },
                data: {
                    processed: true,
                    processed_at: new Date(),
                    error: result.error || null,
                },
            });
            logger_1.logger.info(`Webhook event ${event.id} from ${provider} processed successfully`);
            return reply.status(200).send({
                success: true,
                message: 'Webhook processed successfully',
            });
        }
        catch (error) {
            logger_1.logger.error(`Failed to process ${provider} webhook:`, error);
            // Log the error in the event table if we have the event ID
            try {
                const eventId = request.body?.id;
                if (eventId) {
                    await prisma_1.prisma.paymentProviderEvent.updateMany({
                        where: {
                            provider: provider,
                            provider_event_id: eventId,
                        },
                        data: {
                            error: error.message,
                            processed_at: new Date(),
                        },
                    });
                }
            }
            catch (logError) {
                logger_1.logger.error('Failed to log webhook error:', logError);
            }
            return reply.status(500).send({
                success: false,
                error: 'Failed to process webhook',
                details: error.message,
            });
        }
    });
    /**
     * Helper: Get signature header based on provider
     */
    function getSignatureHeader(request, provider) {
        switch (provider) {
            case 'stripe':
                return request.headers['stripe-signature'];
            case 'lemonsqueezy':
                return request.headers['x-signature'];
            default:
                return undefined;
        }
    }
    /**
     * Helper: Get webhook secret from environment
     */
    function getWebhookSecret(provider) {
        switch (provider) {
            case 'stripe':
                return process.env.STRIPE_WEBHOOK_SECRET;
            case 'lemonsqueezy':
                return process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
            default:
                return undefined;
        }
    }
};
exports.default = paymentWebhookRoutes;
