"use strict";
/**
 * Billing Routes for SpamRescue
 * Handles subscription management, payment processing, and usage tracking
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const zod_1 = require("zod");
const PaymentService_1 = require("../../services/payment/PaymentService");
const plan_service_1 = require("../../services/plan.service");
const usage_service_1 = require("../../services/usage.service");
const subscription_service_1 = require("../../services/subscription.service");
const stripe_1 = __importDefault(require("stripe"));
const email_service_1 = require("../../services/email.service");
const prisma_1 = require("../../lib/prisma");
// Validation schemas
const GetSubscriptionSchema = zod_1.z.object({});
const GetUsageSchema = zod_1.z.object({});
const GetPlansSchema = zod_1.z.object({});
const CreateCheckoutSessionSchema = zod_1.z.object({
    planName: zod_1.z.string(),
    returnUrl: zod_1.z.string().url(),
    cancelUrl: zod_1.z.string().url().optional(), // Optional separate cancel URL
    provider: zod_1.z.enum(['stripe', 'lemonsqueezy']).optional(),
    billingCycle: zod_1.z.enum(['monthly', 'yearly']).optional(),
});
const CreatePortalSessionSchema = zod_1.z.object({
    returnUrl: zod_1.z.string().url(),
});
const CancelSubscriptionSchema = zod_1.z.object({
    immediate: zod_1.z.boolean().optional(),
});
const GetInvoicesSchema = zod_1.z.object({
    limit: zod_1.z.coerce.number().min(1).max(100).optional().default(10),
    startingAfter: zod_1.z.string().optional(),
});
const billingRoutes = async (fastify) => {
    /**
     * GET /api/billing/subscription
     * Get current subscription details for the authenticated user
     */
    fastify.get('/subscription', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user.userId;
            const subscription = await subscription_service_1.subscriptionService.getUserSubscription(userId);
            if (!subscription) {
                return reply.status(404).send({
                    success: false,
                    error: 'No subscription found',
                });
            }
            return reply.send({
                success: true,
                data: {
                    subscription: {
                        id: subscription.id,
                        plan: subscription.plan,
                        status: subscription.status,
                        payment_provider: subscription.paymentProvider || 'stripe',
                        billing_cycle: subscription.billingCycle || 'monthly',
                        current_period_start: subscription.currentPeriodStart,
                        current_period_end: subscription.currentPeriodEnd,
                        trial_start: subscription.trialStart || null,
                        trial_end: subscription.trialEnd || null,
                        cancel_at: subscription.cancelAt,
                        payment_method: subscription.paymentMethodLast4 ? {
                            last4: subscription.paymentMethodLast4,
                            brand: subscription.paymentMethodBrand || 'card',
                        } : null,
                    },
                },
            });
        }
        catch (error) {
            request.log.error('Error getting subscription:', error?.message || String(error));
            return reply.status(500).send({
                success: false,
                error: 'Failed to get subscription details',
            });
        }
    });
    /**
     * GET /api/billing/status
     * Check if user can use the service (trial/subscription status)
     */
    fastify.get('/status', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user.userId;
            const status = await subscription_service_1.subscriptionService.checkSubscriptionStatus(userId);
            return reply.send({
                success: true,
                data: status,
            });
        }
        catch (error) {
            request.log.error('Error checking subscription status:', error?.message || String(error));
            return reply.status(500).send({
                success: false,
                error: 'Failed to check subscription status',
            });
        }
    });
    /**
     * GET /api/billing/usage
     * Get current usage statistics for the authenticated user
     */
    fastify.get('/usage', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user.userId;
            const usage = await usage_service_1.usageService.getCurrentUsage(userId);
            // Get ACTUAL mailbox count (more reliable than stored count which can get out of sync)
            const actualMailboxCount = await fastify.prisma.mailbox.count({
                where: { user_id: userId }
            });
            // Helper to calculate percentage safely
            const calculatePercentage = (current, limit) => {
                if (!limit || limit === 0)
                    return 0;
                return Math.min(100, Math.round((current / limit) * 100 * 10) / 10);
            };
            // Calculate percentages - use actual mailbox count for accuracy
            const mailboxesPercentage = calculatePercentage(actualMailboxCount, usage.limits.mailboxes);
            const messagesPercentage = calculatePercentage(usage.messagesScanned, usage.limits.messagesScanned);
            const aiPercentage = calculatePercentage(usage.aiClassifications, usage.limits.aiClassifications);
            // Debug logging
            console.log('=== USAGE DATA DEBUG ===');
            console.log('Mailboxes:', { current: actualMailboxCount, storedCount: usage.mailboxesCount, limit: usage.limits.mailboxes, percentage: mailboxesPercentage });
            console.log('Messages Scanned:', { current: usage.messagesScanned, limit: usage.limits.messagesScanned, percentage: messagesPercentage });
            console.log('AI Classifications:', { current: usage.aiClassifications, limit: usage.limits.aiClassifications, percentage: aiPercentage });
            console.log('======================');
            return reply.send({
                success: true,
                data: {
                    mailboxes: {
                        current: actualMailboxCount, // Use actual count instead of stored count
                        limit: usage.limits.mailboxes || 999999,
                        percentage: mailboxesPercentage,
                    },
                    messages_scanned: {
                        current: usage.messagesScanned,
                        limit: usage.limits.messagesScanned || 999999,
                        percentage: messagesPercentage,
                    },
                    ai_classifications: {
                        current: usage.aiClassifications,
                        limit: usage.limits.aiClassifications || 999999,
                        percentage: aiPercentage,
                    },
                },
            });
        }
        catch (error) {
            request.log.error('Error getting usage:', error?.message || String(error));
            return reply.status(500).send({
                success: false,
                error: 'Failed to get usage details',
            });
        }
    });
    /**
     * GET /api/billing/plans
     * Get all available subscription plans (PUBLIC - no auth required)
     */
    fastify.get('/plans', async (request, reply) => {
        try {
            const plans = await plan_service_1.planService.getAllPlans();
            return reply.send({
                success: true,
                data: {
                    plans,
                },
            });
        }
        catch (error) {
            request.log.error('Error getting plans:', error?.message || String(error));
            return reply.status(500).send({
                success: false,
                error: 'Failed to get subscription plans',
            });
        }
    });
    /**
     * GET /api/billing/providers
     * Get list of available payment providers (PUBLIC - no auth required)
     */
    fastify.get('/providers', async (request, reply) => {
        try {
            const availableProviders = PaymentService_1.paymentService.getAvailableProviders();
            const defaultProvider = PaymentService_1.paymentService.getDefaultProvider();
            return reply.send({
                success: true,
                data: {
                    providers: availableProviders,
                    default: defaultProvider,
                },
            });
        }
        catch (error) {
            request.log.error('Error getting payment providers:', error?.message || String(error));
            return reply.status(500).send({
                success: false,
                error: 'Failed to get payment providers',
            });
        }
    });
    /**
     * POST /api/billing/activate-trial
     * Activate a free trial for the user (no payment required for free/starter)
     */
    fastify.post('/activate-trial', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user.userId;
            const { planName } = request.body;
            // Only allow free or starter plans for trial activation without payment
            if (planName !== 'free' && planName !== 'starter') {
                return reply.status(400).send({
                    success: false,
                    error: 'Only free or starter plans can be activated without payment',
                });
            }
            // Check if user already has an active subscription
            const existingSub = await fastify.prisma.subscription.findUnique({
                where: { user_id: userId },
            });
            if (existingSub && existingSub.status === 'active') {
                return reply.status(400).send({
                    success: false,
                    error: 'You already have an active subscription',
                });
            }
            // Grant 14-day trial
            await subscription_service_1.subscriptionService.grantTrial(userId, 14);
            // Update the user to mark plan as selected
            await fastify.prisma.user.update({
                where: { id: userId },
                data: { plan_selected: true },
            });
            return reply.send({
                success: true,
                message: 'Trial activated successfully',
                data: {
                    plan: planName,
                    trialDays: 14,
                },
            });
        }
        catch (error) {
            request.log.error('Error activating trial:', error?.message || String(error));
            return reply.status(500).send({
                success: false,
                error: 'Failed to activate trial',
            });
        }
    });
    /**
     * POST /api/billing/checkout
     * Create a checkout session for subscription (supports multiple providers)
     */
    fastify.post('/checkout', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user.userId;
            const { planName, returnUrl, cancelUrl, provider } = CreateCheckoutSessionSchema.parse(request.body);
            // Get the user's email for the checkout session
            const user = await fastify.prisma.user.findUnique({
                where: { id: userId },
                select: { email: true, name: true }
            });
            if (!user) {
                return reply.status(404).send({
                    success: false,
                    error: 'User not found',
                });
            }
            // Use provided provider or default
            const paymentProvider = (provider || PaymentService_1.paymentService.getDefaultProvider());
            // Add 14-day trial for starter plan
            const trialDays = planName.toLowerCase() === 'starter' ? 14 : undefined;
            // Create checkout session
            // Use separate cancelUrl if provided, otherwise fall back to returnUrl
            // Use proper separator for session_id based on whether returnUrl already has query params
            const separator = returnUrl.includes('?') ? '&' : '?';
            const { checkoutUrl, sessionId } = await PaymentService_1.paymentService.createCheckoutSession({
                userId,
                planName,
                provider: paymentProvider,
                successUrl: `${returnUrl}${separator}session_id={CHECKOUT_SESSION_ID}`,
                cancelUrl: cancelUrl || returnUrl, // Use cancelUrl if provided, otherwise returnUrl
                email: user.email,
                trialDays,
            });
            return reply.send({
                success: true,
                data: {
                    checkoutUrl,
                    sessionId,
                    provider: paymentProvider,
                },
            });
        }
        catch (error) {
            request.log.error('Error creating checkout session:', error?.message || String(error));
            if (error instanceof zod_1.z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid request body',
                    details: error.errors,
                });
            }
            return reply.status(500).send({
                success: false,
                error: 'Failed to create checkout session',
                details: error.message,
            });
        }
    });
    /**
     * POST /api/billing/portal
     * Create a customer portal session for managing subscription (provider-agnostic)
     */
    fastify.post('/portal', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user.userId;
            const { returnUrl } = CreatePortalSessionSchema.parse(request.body);
            const { portalUrl } = await PaymentService_1.paymentService.createPortalSession(userId, returnUrl);
            return reply.send({
                success: true,
                data: {
                    portalUrl,
                },
            });
        }
        catch (error) {
            request.log.error('Error creating portal session:', error?.message || String(error));
            if (error instanceof zod_1.z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid request body',
                    details: error.errors,
                });
            }
            return reply.status(500).send({
                success: false,
                error: 'Failed to create portal session',
            });
        }
    });
    /**
     * POST /api/billing/cancel
     * Cancel user's subscription
     */
    fastify.post('/cancel', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user.userId;
            const parsedBody = CancelSubscriptionSchema.parse(request.body || {});
            const { immediate } = parsedBody;
            await subscription_service_1.subscriptionService.cancelSubscription(userId, immediate || false);
            return reply.send({
                success: true,
                message: 'Subscription cancelled successfully',
            });
        }
        catch (error) {
            request.log.error('Error cancelling subscription:', error?.message || String(error));
            if (error instanceof zod_1.z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid request body',
                    details: error.errors,
                });
            }
            return reply.status(500).send({
                success: false,
                error: 'Failed to cancel subscription',
            });
        }
    });
    /**
     * GET /api/billing/invoices
     * Get user's invoice history (provider-agnostic)
     */
    fastify.get('/invoices', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user.userId;
            const queryParams = GetInvoicesSchema.parse(request.query || {});
            const limit = queryParams.limit || 10;
            // Use payment service to get invoices (auto-detects provider)
            const invoiceResult = await PaymentService_1.paymentService.listInvoices(userId, limit);
            return reply.send({
                success: true,
                data: {
                    invoices: invoiceResult.invoices,
                    hasMore: invoiceResult.hasMore,
                },
            });
        }
        catch (error) {
            console.error('=== INVOICES ERROR ===');
            console.error('Error details:', error);
            console.error('Error stack:', error instanceof Error ? error.stack : 'No stack');
            console.error('=====================');
            request.log.error('Error getting invoices:', error?.message || String(error));
            if (error instanceof zod_1.z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid request parameters',
                    details: error.errors,
                });
            }
            return reply.status(500).send({
                success: false,
                error: 'Failed to get invoices',
                details: error instanceof Error ? error.message : String(error),
            });
        }
    });
    /**
     * GET /api/billing/trial
     * Check if user is eligible for a free trial
     */
    fastify.get('/trial', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user.userId;
            const trialInfo = await subscription_service_1.subscriptionService.checkTrialEligibility(userId);
            return reply.send({
                success: true,
                data: {
                    eligibleForTrial: trialInfo.eligibleForTrial,
                    trialDays: trialInfo.trialDays,
                    reason: trialInfo.reason,
                },
            });
        }
        catch (error) {
            request.log.error('Error checking trial eligibility:', error?.message || String(error));
            return reply.status(500).send({
                success: false,
                error: 'Failed to check trial eligibility',
            });
        }
    });
    /**
     * GET /api/billing/feature-access
     * Check if user has access to a specific feature based on their plan
     */
    fastify.get('/feature-access', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user.userId;
            const { feature } = request.query;
            if (!feature) {
                return reply.status(400).send({
                    success: false,
                    error: 'Feature parameter is required',
                });
            }
            const featureAccess = await plan_service_1.planService.checkFeatureAccess(userId, feature);
            return reply.send({
                success: true,
                data: {
                    feature,
                    hasAccess: featureAccess.hasAccess,
                    limit: featureAccess.limit,
                    currentValue: featureAccess.currentValue,
                },
            });
        }
        catch (error) {
            request.log.error('Error checking feature access:', error?.message || String(error));
            return reply.status(500).send({
                success: false,
                error: 'Failed to check feature access',
            });
        }
    });
    /**
     * POST /api/billing/trial
     * Grant a free trial to the user
     */
    fastify.post('/trial', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user.userId;
            // Check if user is eligible for a trial
            const trialInfo = await subscription_service_1.subscriptionService.checkTrialEligibility(userId);
            if (!trialInfo.eligibleForTrial) {
                return reply.status(400).send({
                    success: false,
                    error: 'User is not eligible for a trial',
                    reason: trialInfo.reason,
                });
            }
            const trialDays = 14;
            await subscription_service_1.subscriptionService.grantTrial(userId, trialDays);
            // Update usage tracking for the new trial period
            await usage_service_1.usageService.resetUsageForNewPeriod(userId);
            // Get user info and send trial started email
            const user = await prisma_1.prisma.user.findUnique({
                where: { id: userId },
                select: { email: true, name: true }
            });
            if (user) {
                const trialEndDate = new Date();
                trialEndDate.setDate(trialEndDate.getDate() + trialDays);
                (0, email_service_1.sendTrialStartedEmailAsync)({
                    recipientEmail: user.email,
                    recipientName: user.name || undefined,
                    planName: 'Starter',
                    trialDays,
                    trialEndDate: trialEndDate.toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    })
                });
                request.log.info(`Trial started email queued for ${user.email}`);
            }
            // Mark user's plan as selected
            await prisma_1.prisma.user.update({
                where: { id: userId },
                data: { plan_selected: true }
            });
            return reply.send({
                success: true,
                message: 'Trial granted successfully',
            });
        }
        catch (error) {
            request.log.error('Error granting trial:', error?.message || String(error));
            return reply.status(500).send({
                success: false,
                error: 'Failed to grant trial',
            });
        }
    });
    /**
     * POST /api/billing/verify-checkout
     * Verify a Stripe checkout session and sync subscription immediately
     * This is called when user returns from Stripe to avoid webhook race condition
     */
    fastify.post('/verify-checkout', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user.userId;
            const { sessionId } = request.body;
            if (!sessionId) {
                return reply.status(400).send({
                    success: false,
                    error: 'Session ID is required',
                });
            }
            request.log.info(`[verify-checkout] Verifying session ${sessionId} for user ${userId}`);
            // Retrieve the checkout session from Stripe
            const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
            const session = await stripe.checkout.sessions.retrieve(sessionId, {
                expand: ['subscription', 'subscription.items.data.price'],
            });
            if (!session) {
                return reply.status(404).send({
                    success: false,
                    error: 'Checkout session not found',
                });
            }
            // Verify the session is completed
            if (session.status !== 'complete') {
                return reply.status(400).send({
                    success: false,
                    error: 'Checkout session is not complete',
                    status: session.status,
                });
            }
            // Get subscription details
            const stripeSubscription = session.subscription;
            if (!stripeSubscription) {
                return reply.status(400).send({
                    success: false,
                    error: 'No subscription found in checkout session',
                });
            }
            const stripeCustomerId = session.customer;
            const stripeSubscriptionId = typeof stripeSubscription === 'string'
                ? stripeSubscription
                : stripeSubscription.id;
            // Get the plan from the price ID
            const priceId = typeof stripeSubscription === 'string'
                ? null
                : stripeSubscription.items?.data[0]?.price?.id;
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
            // Get subscription object if it's expanded
            const subObj = typeof stripeSubscription === 'string'
                ? await stripe.subscriptions.retrieve(stripeSubscription)
                : stripeSubscription;
            // Create or update the subscription record
            await prisma_1.prisma.subscription.upsert({
                where: { user_id: userId },
                create: {
                    user_id: userId,
                    plan: planName,
                    plan_config_id: planConfigId,
                    status: subObj.status === 'trialing' ? 'trialing' : 'active',
                    stripe_customer_id: stripeCustomerId,
                    stripe_subscription_id: stripeSubscriptionId,
                    stripe_price_id: priceId,
                    payment_provider: 'stripe',
                    current_period_start: new Date(subObj.current_period_start * 1000),
                    current_period_end: new Date(subObj.current_period_end * 1000),
                    trial_start: subObj.trial_start ? new Date(subObj.trial_start * 1000) : null,
                    trial_end: subObj.trial_end ? new Date(subObj.trial_end * 1000) : null,
                    billing_cycle: subObj.items?.data[0]?.price?.recurring?.interval === 'year' ? 'yearly' : 'monthly',
                },
                update: {
                    plan: planName,
                    plan_config_id: planConfigId,
                    status: subObj.status === 'trialing' ? 'trialing' : 'active',
                    stripe_customer_id: stripeCustomerId,
                    stripe_subscription_id: stripeSubscriptionId,
                    stripe_price_id: priceId,
                    payment_provider: 'stripe',
                    current_period_start: new Date(subObj.current_period_start * 1000),
                    current_period_end: new Date(subObj.current_period_end * 1000),
                    trial_start: subObj.trial_start ? new Date(subObj.trial_start * 1000) : null,
                    trial_end: subObj.trial_end ? new Date(subObj.trial_end * 1000) : null,
                    billing_cycle: subObj.items?.data[0]?.price?.recurring?.interval === 'year' ? 'yearly' : 'monthly',
                }
            });
            // Mark user's plan as selected and get user info for email
            const updatedUser = await prisma_1.prisma.user.update({
                where: { id: userId },
                data: { plan_selected: true },
                select: { name: true, email: true }
            });
            request.log.info(`[verify-checkout] Subscription synced for user ${userId}: plan=${planName}`);
            // Send subscription confirmation email
            const price = subObj.items?.data[0]?.price;
            const amount = price?.unit_amount ? price.unit_amount / 100 : 0;
            const billingCycle = price?.recurring?.interval === 'year' ? 'yearly' : 'monthly';
            const nextBillingDate = new Date(subObj.current_period_end * 1000).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric'
            });
            (0, email_service_1.sendSubscriptionConfirmationEmailAsync)({
                recipientEmail: updatedUser.email,
                recipientName: updatedUser.name || undefined,
                planName: planName.charAt(0).toUpperCase() + planName.slice(1),
                amount,
                billingCycle,
                nextBillingDate
            });
            request.log.info(`[verify-checkout] Subscription confirmation email queued for ${updatedUser.email}`);
            return reply.send({
                success: true,
                data: {
                    plan: planName,
                    status: subObj.status,
                },
            });
        }
        catch (error) {
            request.log.error('Error verifying checkout session:', error?.message || String(error));
            return reply.status(500).send({
                success: false,
                error: 'Failed to verify checkout session',
                message: error.message,
            });
        }
    });
    /**
     * POST /api/billing/webhook
     * Handle Stripe webhook events for subscription and payment updates
     * This endpoint requires raw body for signature verification
     */
    fastify.post('/webhook', {
        config: {
            rawBody: true, // Preserve raw body for Stripe signature verification
        }
    }, async (request, reply) => {
        try {
            const sig = request.headers['stripe-signature'];
            if (!sig) {
                return reply.status(400).send({ error: 'No Stripe signature found' });
            }
            const stripeKey = process.env.STRIPE_SECRET_KEY;
            const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
            if (!stripeKey || !webhookSecret) {
                request.log.error('Stripe configuration missing');
                return reply.status(500).send({ error: 'Webhook not configured' });
            }
            const stripe = new stripe_1.default(stripeKey, { apiVersion: '2023-10-16' });
            // Verify the event came from Stripe
            let event;
            try {
                const rawBody = request.rawBody || request.body;
                event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
            }
            catch (err) {
                request.log.error(`Webhook signature verification failed: ${err.message}`);
                return reply.status(400).send({ error: `Webhook Error: ${err.message}` });
            }
            // Handle the event
            switch (event.type) {
                case 'customer.subscription.created':
                case 'customer.subscription.updated': {
                    const subscription = event.data.object;
                    const customer = await stripe.customers.retrieve(subscription.customer);
                    if (customer.deleted) {
                        request.log.warn('Customer was deleted, skipping subscription update');
                        break;
                    }
                    // Find user by Stripe customer ID
                    const user = await prisma_1.prisma.user.findFirst({
                        where: { stripe_customer_id: customer.id },
                    });
                    if (user) {
                        // Send subscription confirmation email for new subscriptions
                        if (event.type === 'customer.subscription.created' || subscription.status === 'active') {
                            const plan = await prisma_1.prisma.plan.findFirst({
                                where: { stripe_price_id: subscription.items.data[0]?.price.id },
                            });
                            (0, email_service_1.sendSubscriptionConfirmationEmailAsync)({
                                email: customer.email || user.email,
                                name: customer.name || user.name,
                                planName: plan?.name || 'Pro',
                                billingCycle: subscription.items.data[0]?.price.recurring?.interval === 'year' ? 'yearly' : 'monthly',
                                nextBillingDate: new Date(subscription.current_period_end * 1000).toISOString(),
                                dashboardUrl: `${process.env.FRONTEND_URL || 'https://myinboxer.com'}/dashboard`,
                            });
                        }
                    }
                    break;
                }
                case 'invoice.payment_succeeded': {
                    const invoice = event.data.object;
                    const customer = await stripe.customers.retrieve(invoice.customer);
                    if (customer.deleted) {
                        request.log.warn('Customer was deleted, skipping payment receipt');
                        break;
                    }
                    // Find user by Stripe customer ID
                    const user = await prisma_1.prisma.user.findFirst({
                        where: { stripe_customer_id: customer.id },
                    });
                    if (user) {
                        (0, email_service_1.sendPaymentReceiptEmailAsync)({
                            email: customer.email || user.email,
                            name: customer.name || user.name,
                            amount: (invoice.amount_paid / 100).toFixed(2), // Convert cents to dollars
                            currency: invoice.currency.toUpperCase(),
                            invoiceDate: new Date(invoice.created * 1000).toISOString(),
                            invoiceUrl: invoice.hosted_invoice_url || undefined,
                        });
                    }
                    break;
                }
                case 'customer.subscription.deleted': {
                    const subscription = event.data.object;
                    const customer = await stripe.customers.retrieve(subscription.customer);
                    if (customer.deleted) {
                        request.log.warn('Customer was deleted, skipping cancellation email');
                        break;
                    }
                    // Find user by Stripe customer ID
                    const user = await prisma_1.prisma.user.findFirst({
                        where: { stripe_customer_id: customer.id },
                    });
                    if (user) {
                        const plan = await prisma_1.prisma.plan.findFirst({
                            where: { stripe_price_id: subscription.items.data[0]?.price.id },
                        });
                        (0, email_service_1.sendSubscriptionCancelledEmailAsync)({
                            email: customer.email || user.email,
                            name: customer.name || user.name,
                            planName: plan?.name || 'Pro',
                            endDate: new Date(subscription.current_period_end * 1000),
                            reason: subscription.cancellation_details?.reason || 'User requested',
                        });
                    }
                    break;
                }
                default:
                    request.log.info(`Unhandled webhook event type: ${event.type}`);
            }
            return reply.send({ received: true });
        }
        catch (error) {
            request.log.error('Error processing webhook:', error?.message || String(error));
            return reply.status(500).send({
                success: false,
                error: 'Webhook processing failed',
            });
        }
    });
};
exports.default = billingRoutes;
