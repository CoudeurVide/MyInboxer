"use strict";
/**
 * Stripe Webhook Routes for SpamRescue
 * Handles incoming webhook events from Stripe
 */
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = require("../../lib/prisma");
const logger_1 = require("../../lib/logger");
const stripe_service_1 = require("../../services/stripe.service");
const usage_service_1 = require("../../services/usage.service");
const email_service_1 = require("../../services/email.service");
const stripeWebhookRoutes = async (fastify) => {
    /**
     * POST /api/webhooks/stripe
     * Handle incoming Stripe webhook events
     */
    fastify.post('/stripe', async (request, reply) => {
        const sig = request.headers['stripe-signature'];
        if (!sig) {
            logger_1.logger.error('Stripe signature missing from webhook request');
            return reply.status(400).send({ error: 'Missing stripe-signature header' });
        }
        let event;
        try {
            // Verify the webhook signature using the Stripe library
            event = stripe_service_1.stripe.webhooks.constructEvent(request.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
        }
        catch (err) {
            logger_1.logger.error(`Webhook signature verification failed: ${err.message}`);
            return reply.status(400).send({ error: `Webhook signature verification failed: ${err.message}` });
        }
        try {
            // Check if this event was already processed
            const existingEvent = await prisma_1.prisma.stripeEvent.findUnique({
                where: { stripe_event_id: event.id }
            });
            if (existingEvent) {
                logger_1.logger.info(`Duplicate webhook event received: ${event.id}`);
                return reply.status(200).send({ received: true });
            }
            // Process the event based on its type
            switch (event.type) {
                case 'customer.subscription.created':
                case 'customer.subscription.updated':
                    await handleSubscriptionUpdated(event);
                    break;
                case 'customer.subscription.deleted':
                    await handleSubscriptionDeleted(event);
                    break;
                case 'invoice.payment_succeeded':
                    await handleInvoicePaymentSucceeded(event);
                    break;
                case 'invoice.payment_failed':
                    await handleInvoicePaymentFailed(event);
                    break;
                case 'customer.created':
                    // Customer was likely created during checkout but we might receive this event separately
                    await handleCustomerCreated(event);
                    break;
                case 'checkout.session.completed':
                    await handleCheckoutSessionCompleted(event);
                    break;
                default:
                    logger_1.logger.info(`Unhandled Stripe event type: ${event.type}`);
                    break;
            }
            // Record that we've processed this event
            await prisma_1.prisma.stripeEvent.create({
                data: {
                    stripe_event_id: event.id,
                    event_type: event.type,
                    processed: true,
                    payload: event,
                    processed_at: new Date(),
                }
            });
            logger_1.logger.info(`Stripe event processed: ${event.id} - ${event.type}`);
            return reply.status(200).send({ received: true });
        }
        catch (error) {
            logger_1.logger.error(`Error processing Stripe webhook:`, error);
            // Record the failed event
            await prisma_1.prisma.stripeEvent.create({
                data: {
                    stripe_event_id: event.id,
                    event_type: event.type,
                    processed: false,
                    payload: event,
                    error: error.message,
                }
            });
            // Return 500 so Stripe will retry the webhook
            return reply.status(500).send({ error: 'Webhook processing error' });
        }
    });
};
/**
 * Handle subscription updated events (created/updated)
 */
async function handleSubscriptionUpdated(event) {
    logger_1.logger.info(`Processing subscription updated event: ${event.id}`);
    const subscription = event.data.object;
    try {
        // Update subscription in our database from Stripe data
        await stripe_service_1.stripeService.syncSubscriptionFromStripe(subscription.id);
    }
    catch (error) {
        logger_1.logger.error(`Error syncing subscription from Stripe:`, error);
        throw error;
    }
}
/**
 * Handle subscription deleted events
 */
async function handleSubscriptionDeleted(event) {
    logger_1.logger.info(`Processing subscription deleted event: ${event.id}`);
    const subscription = event.data.object;
    try {
        // Find the subscription in our database
        const dbSubscription = await prisma_1.prisma.subscription.findUnique({
            where: { stripe_subscription_id: subscription.id }
        });
        if (!dbSubscription) {
            logger_1.logger.warn(`Subscription ${subscription.id} not found in our database`);
            return;
        }
        // Update the subscription status to cancelled
        await prisma_1.prisma.subscription.update({
            where: { id: dbSubscription.id },
            data: {
                status: 'cancelled',
                canceled_at: new Date(),
                updated_at: new Date(),
            }
        });
        // Reset usage tracking for the cancelled subscription
        await usage_service_1.usageService.resetUsageForNewPeriod(dbSubscription.user_id);
        logger_1.logger.info(`Subscription ${subscription.id} marked as cancelled for user ${dbSubscription.user_id}`);
    }
    catch (error) {
        logger_1.logger.error(`Error handling subscription deletion:`, error);
        throw error;
    }
}
/**
 * Handle successful invoice payment
 */
async function handleInvoicePaymentSucceeded(event) {
    logger_1.logger.info(`Processing invoice payment succeeded event: ${event.id}`);
    const invoice = event.data.object;
    try {
        // In a real implementation, you might want to store payment details
        // or update user's payment status
        // Find the subscription associated with this invoice
        if (invoice.subscription) {
            const dbSubscription = await prisma_1.prisma.subscription.findUnique({
                where: { stripe_subscription_id: invoice.subscription }
            });
            if (dbSubscription) {
                // Update the subscription status to active if it was cancelled
                if (dbSubscription.status === 'past_due') {
                    await prisma_1.prisma.subscription.update({
                        where: { id: dbSubscription.id },
                        data: {
                            status: 'active',
                            updated_at: new Date(),
                        }
                    });
                }
            }
        }
    }
    catch (error) {
        logger_1.logger.error(`Error handling invoice payment succeeded:`, error);
        throw error;
    }
}
/**
 * Handle failed invoice payment
 */
async function handleInvoicePaymentFailed(event) {
    logger_1.logger.info(`Processing invoice payment failed event: ${event.id}`);
    const invoice = event.data.object;
    try {
        // Find the subscription associated with this invoice
        if (invoice.subscription) {
            const dbSubscription = await prisma_1.prisma.subscription.findUnique({
                where: { stripe_subscription_id: invoice.subscription }
            });
            if (dbSubscription) {
                // Update the subscription status to past_due
                await prisma_1.prisma.subscription.update({
                    where: { id: dbSubscription.id },
                    data: {
                        status: 'past_due',
                        updated_at: new Date(),
                    }
                });
            }
        }
    }
    catch (error) {
        logger_1.logger.error(`Error handling invoice payment failed:`, error);
        throw error;
    }
}
/**
 * Handle customer creation
 */
async function handleCustomerCreated(event) {
    logger_1.logger.info(`Processing customer created event: ${event.id}`);
    const customer = event.data.object;
    // In most cases, we should already have the customer from checkout or portal
    // This event is more for logging or additional customer information if needed
    logger_1.logger.info(`Customer created in Stripe: ${customer.id}`);
}
/**
 * Handle checkout session completion
 * This is where the subscription is actually created after successful payment
 */
async function handleCheckoutSessionCompleted(event) {
    logger_1.logger.info(`Processing checkout session completed event: ${event.id}`);
    const session = event.data.object;
    try {
        // The customer has completed the checkout flow
        const stripeCustomerId = session.customer;
        const stripeSubscriptionId = session.subscription;
        const customerEmail = session.customer_email || session.customer_details?.email;
        if (!stripeCustomerId || !stripeSubscriptionId) {
            logger_1.logger.warn('Checkout session missing customer or subscription ID');
            return;
        }
        // Get the Stripe subscription to extract details
        const stripeSubscription = await stripe_service_1.stripe.subscriptions.retrieve(stripeSubscriptionId, {
            expand: ['items.data.price']
        });
        // Get the plan from the price ID
        const priceId = stripeSubscription.items.data[0]?.price.id;
        let planName = 'starter';
        let planConfigId = null;
        if (priceId) {
            const planConfig = await prisma_1.prisma.subscriptionPlanConfig.findFirst({
                where: {
                    OR: [
                        { stripe_price_id_monthly: priceId },
                        { stripe_price_id_yearly: priceId },
                    ]
                }
            });
            if (planConfig) {
                planName = planConfig.name;
                planConfigId = planConfig.id;
            }
        }
        // Find user by email from checkout session
        const user = await prisma_1.prisma.user.findUnique({
            where: { email: customerEmail },
            select: { id: true }
        });
        if (!user) {
            logger_1.logger.error(`No user found for email ${customerEmail} from checkout session`);
            throw new Error(`User not found for email: ${customerEmail}`);
        }
        const userId = user.id;
        // Create or update the subscription record
        // This is where the subscription is officially created after successful payment
        await prisma_1.prisma.subscription.upsert({
            where: { user_id: userId },
            create: {
                user_id: userId,
                plan: planName,
                plan_config_id: planConfigId,
                status: stripeSubscription.status === 'trialing' ? 'trialing' : 'active',
                stripe_customer_id: stripeCustomerId,
                stripe_subscription_id: stripeSubscriptionId,
                stripe_price_id: priceId,
                payment_provider: 'stripe',
                current_period_start: new Date(stripeSubscription.current_period_start * 1000),
                current_period_end: new Date(stripeSubscription.current_period_end * 1000),
                trial_start: stripeSubscription.trial_start ? new Date(stripeSubscription.trial_start * 1000) : null,
                trial_end: stripeSubscription.trial_end ? new Date(stripeSubscription.trial_end * 1000) : null,
                billing_cycle: stripeSubscription.items.data[0]?.price.recurring?.interval === 'year' ? 'yearly' : 'monthly',
            },
            update: {
                plan: planName,
                plan_config_id: planConfigId,
                status: stripeSubscription.status === 'trialing' ? 'trialing' : 'active',
                stripe_customer_id: stripeCustomerId,
                stripe_subscription_id: stripeSubscriptionId,
                stripe_price_id: priceId,
                payment_provider: 'stripe',
                current_period_start: new Date(stripeSubscription.current_period_start * 1000),
                current_period_end: new Date(stripeSubscription.current_period_end * 1000),
                trial_start: stripeSubscription.trial_start ? new Date(stripeSubscription.trial_start * 1000) : null,
                trial_end: stripeSubscription.trial_end ? new Date(stripeSubscription.trial_end * 1000) : null,
                billing_cycle: stripeSubscription.items.data[0]?.price.recurring?.interval === 'year' ? 'yearly' : 'monthly',
            }
        });
        logger_1.logger.info(`Subscription created/updated for user ${userId}: plan=${planName}, status=${stripeSubscription.status}`);
        // Mark the user's plan as selected
        const updatedUser = await prisma_1.prisma.user.update({
            where: { id: userId },
            data: { plan_selected: true },
            select: { name: true, email: true }
        });
        logger_1.logger.info(`Marked plan_selected=true for user ${userId}`);
        // Send subscription confirmation email
        const price = stripeSubscription.items.data[0]?.price;
        const amount = price?.unit_amount ? price.unit_amount / 100 : 0;
        const billingCycle = price?.recurring?.interval === 'year' ? 'yearly' : 'monthly';
        const nextBillingDate = new Date(stripeSubscription.current_period_end * 1000).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        (0, email_service_1.sendSubscriptionConfirmationEmailAsync)({
            recipientEmail: customerEmail,
            recipientName: updatedUser.name || undefined,
            planName: planName.charAt(0).toUpperCase() + planName.slice(1),
            amount,
            billingCycle,
            nextBillingDate
        });
        logger_1.logger.info(`Subscription confirmation email queued for ${customerEmail}`);
        logger_1.logger.info(`Checkout session completed for customer ${stripeCustomerId}, user ${userId}`);
    }
    catch (error) {
        logger_1.logger.error(`Error handling checkout session completed:`, error);
        throw error;
    }
}
exports.default = stripeWebhookRoutes;
