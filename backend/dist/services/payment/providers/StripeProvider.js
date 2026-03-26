"use strict";
/**
 * Stripe Payment Provider
 * Implements IPaymentProvider for Stripe payment processing
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StripeProvider = void 0;
const stripe_1 = __importDefault(require("stripe"));
const prisma_1 = require("../../../lib/prisma");
const logger_1 = require("../../../lib/logger");
class StripeProvider {
    providerName = 'stripe';
    stripe;
    constructor() {
        if (!process.env.STRIPE_SECRET_KEY) {
            throw new Error('STRIPE_SECRET_KEY environment variable is required for Stripe provider');
        }
        this.stripe = new stripe_1.default(process.env.STRIPE_SECRET_KEY, {
            apiVersion: '2023-10-16',
        });
        logger_1.logger.info('Stripe provider initialized');
    }
    // ============================================================================
    // Customer Management
    // ============================================================================
    async createCustomer(params) {
        try {
            const { userId, email, name, metadata } = params;
            // Create a new customer in Stripe
            const customer = await this.stripe.customers.create({
                email,
                name,
                metadata: {
                    userId,
                    ...metadata,
                },
            });
            logger_1.logger.info(`Stripe customer created: ${customer.id} for user ${userId}`);
            return {
                providerCustomerId: customer.id,
                email: customer.email || email,
                name: customer.name || name,
                created: new Date(customer.created * 1000),
                metadata: customer.metadata,
            };
        }
        catch (error) {
            logger_1.logger.error('Failed to create Stripe customer:', error);
            throw error;
        }
    }
    async getCustomer(providerCustomerId) {
        try {
            const customer = await this.stripe.customers.retrieve(providerCustomerId);
            if ('deleted' in customer && customer.deleted) {
                throw new Error(`Stripe customer ${providerCustomerId} has been deleted`);
            }
            // Type guard to ensure it's a proper customer and not a deleted one
            if (customer.deleted) {
                throw new Error(`Stripe customer ${providerCustomerId} has been deleted`);
            }
            const stripeCustomer = customer;
            return {
                providerCustomerId: stripeCustomer.id,
                email: stripeCustomer.email || undefined,
                name: stripeCustomer.name || undefined,
                created: new Date(stripeCustomer.created * 1000),
                metadata: stripeCustomer.metadata,
            };
        }
        catch (error) {
            logger_1.logger.error(`Failed to get Stripe customer ${providerCustomerId}:`, error);
            throw error;
        }
    }
    async getOrCreateCustomer(params, existingCustomerId) {
        try {
            // If we have an existing customer ID, retrieve it
            if (existingCustomerId) {
                try {
                    return await this.getCustomer(existingCustomerId);
                }
                catch (error) {
                    logger_1.logger.warn(`Failed to retrieve existing customer ${existingCustomerId}, creating new one`);
                }
            }
            // Check database for existing customer
            const subscription = await prisma_1.prisma.subscription.findUnique({
                where: { user_id: params.userId },
                select: { stripe_customer_id: true, provider_customer_id: true },
            });
            if (subscription?.stripe_customer_id) {
                try {
                    return await this.getCustomer(subscription.stripe_customer_id);
                }
                catch (error) {
                    logger_1.logger.warn(`Failed to retrieve customer from DB, creating new one`);
                }
            }
            // Create new customer
            return await this.createCustomer(params);
        }
        catch (error) {
            logger_1.logger.error('Failed in getOrCreateCustomer:', error);
            throw error;
        }
    }
    // ============================================================================
    // Checkout & Subscriptions
    // ============================================================================
    async createCheckoutSession(params) {
        try {
            const { userId, priceId, successUrl, cancelUrl, email, trialDays } = params;
            // Get or create customer
            const customerData = await this.getOrCreateCustomer({ userId, email: email || '' });
            // Append session_id to success URL so we can verify immediately on return
            // Stripe replaces {CHECKOUT_SESSION_ID} with the actual session ID
            const successUrlWithSession = successUrl.includes('?')
                ? `${successUrl}&session_id={CHECKOUT_SESSION_ID}`
                : `${successUrl}?session_id={CHECKOUT_SESSION_ID}`;
            // Create checkout session
            const session = await this.stripe.checkout.sessions.create({
                mode: 'subscription',
                customer: customerData.providerCustomerId,
                line_items: [
                    {
                        price: priceId,
                        quantity: 1,
                    },
                ],
                success_url: successUrlWithSession,
                cancel_url: cancelUrl,
                allow_promotion_codes: true,
                ...(trialDays && trialDays > 0 ? { subscription_data: { trial_period_days: trialDays } } : {}),
            });
            logger_1.logger.info(`Stripe checkout session created: ${session.id} for user ${userId}`);
            return {
                checkoutUrl: session.url,
                sessionId: session.id,
            };
        }
        catch (error) {
            logger_1.logger.error('Failed to create Stripe checkout session:', error);
            throw error;
        }
    }
    async createPortalSession(params) {
        try {
            const { providerCustomerId, returnUrl } = params;
            const session = await this.stripe.billingPortal.sessions.create({
                customer: providerCustomerId,
                return_url: returnUrl,
            });
            logger_1.logger.info(`Stripe portal session created for customer ${providerCustomerId}`);
            return {
                portalUrl: session.url,
            };
        }
        catch (error) {
            logger_1.logger.error('Failed to create Stripe portal session:', error);
            throw error;
        }
    }
    async getSubscription(providerSubscriptionId) {
        try {
            const subscription = await this.stripe.subscriptions.retrieve(providerSubscriptionId);
            return this.mapStripeSubscriptionToInternal(subscription);
        }
        catch (error) {
            logger_1.logger.error(`Failed to get Stripe subscription ${providerSubscriptionId}:`, error);
            throw error;
        }
    }
    async syncSubscription(providerSubscriptionId) {
        try {
            const subscription = await this.stripe.subscriptions.retrieve(providerSubscriptionId, {
                expand: ['customer'],
            });
            const subscriptionData = this.mapStripeSubscriptionToInternal(subscription);
            logger_1.logger.info(`Stripe subscription synced: ${providerSubscriptionId}`);
            return subscriptionData;
        }
        catch (error) {
            logger_1.logger.error(`Failed to sync Stripe subscription ${providerSubscriptionId}:`, error);
            throw error;
        }
    }
    async cancelSubscription(providerSubscriptionId) {
        try {
            await this.stripe.subscriptions.cancel(providerSubscriptionId, {
                invoice_now: true,
                prorate: true,
            });
            logger_1.logger.info(`Stripe subscription cancelled: ${providerSubscriptionId}`);
        }
        catch (error) {
            logger_1.logger.error(`Failed to cancel Stripe subscription ${providerSubscriptionId}:`, error);
            throw error;
        }
    }
    // ============================================================================
    // Invoice Management
    // ============================================================================
    async listInvoices(params) {
        try {
            const { providerCustomerId, limit = 10, startingAfter } = params;
            const invoices = await this.stripe.invoices.list({
                customer: providerCustomerId,
                limit,
                ...(startingAfter && { starting_after: startingAfter }),
            });
            return {
                invoices: invoices.data.map((invoice) => ({
                    id: invoice.id,
                    number: invoice.number || undefined,
                    status: invoice.status || 'unknown',
                    amount: invoice.amount_paid,
                    currency: invoice.currency,
                    created: invoice.created, // Return Unix timestamp (seconds) - frontend will multiply by 1000
                    paidAt: invoice.status_transitions.paid_at || undefined, // Unix timestamp (seconds)
                    invoicePdfUrl: invoice.invoice_pdf || undefined,
                    hostedInvoiceUrl: invoice.hosted_invoice_url || undefined,
                })),
                hasMore: invoices.has_more,
            };
        }
        catch (error) {
            logger_1.logger.error('Failed to list Stripe invoices:', error);
            throw error;
        }
    }
    // ============================================================================
    // Webhook Handling
    // ============================================================================
    async validateWebhook(rawBody, signature, secret) {
        try {
            const event = this.stripe.webhooks.constructEvent(rawBody, signature, secret);
            return {
                id: event.id,
                type: event.type,
                data: event.data,
                createdAt: new Date(event.created * 1000),
            };
        }
        catch (error) {
            logger_1.logger.error('Stripe webhook validation failed:', error);
            throw new Error(`Webhook signature verification failed: ${error.message}`);
        }
    }
    async processWebhookEvent(event) {
        try {
            logger_1.logger.info(`Processing Stripe webhook event: ${event.type}`);
            // Handle different event types
            switch (event.type) {
                case 'customer.subscription.created':
                case 'customer.subscription.updated':
                case 'customer.subscription.deleted': {
                    const subscription = event.data.object;
                    const subscriptionData = this.mapStripeSubscriptionToInternal(subscription);
                    return {
                        success: true,
                        subscriptionData,
                    };
                }
                case 'invoice.payment_succeeded':
                case 'invoice.payment_failed': {
                    const invoice = event.data.object;
                    if (invoice.subscription) {
                        const subscription = await this.stripe.subscriptions.retrieve(invoice.subscription);
                        const subscriptionData = this.mapStripeSubscriptionToInternal(subscription);
                        return {
                            success: true,
                            subscriptionData,
                        };
                    }
                    return { success: true };
                }
                case 'checkout.session.completed': {
                    const session = event.data.object;
                    if (session.subscription) {
                        const subscription = await this.stripe.subscriptions.retrieve(session.subscription);
                        const subscriptionData = this.mapStripeSubscriptionToInternal(subscription);
                        return {
                            success: true,
                            subscriptionData,
                        };
                    }
                    return { success: true };
                }
                default:
                    logger_1.logger.debug(`Unhandled Stripe webhook event type: ${event.type}`);
                    return { success: true };
            }
        }
        catch (error) {
            logger_1.logger.error(`Failed to process Stripe webhook event ${event.id}:`, error);
            return {
                success: false,
                error: error.message,
            };
        }
    }
    // ============================================================================
    // Utility Methods
    // ============================================================================
    mapStatusToInternal(providerStatus) {
        switch (providerStatus) {
            case 'active':
                return 'active';
            case 'trialing':
                return 'trialing';
            case 'canceled':
            case 'unpaid':
            case 'incomplete_expired':
                return 'cancelled';
            case 'past_due':
                return 'past_due';
            default:
                logger_1.logger.warn(`Unknown Stripe status: ${providerStatus}, defaulting to cancelled`);
                return 'cancelled';
        }
    }
    async getPlanFromPriceId(providerPriceId) {
        try {
            const planConfig = await prisma_1.prisma.subscriptionPlanConfig.findFirst({
                where: {
                    OR: [
                        { stripe_price_id_monthly: providerPriceId },
                        { stripe_price_id_yearly: providerPriceId },
                    ],
                },
            });
            if (!planConfig) {
                throw new Error(`No plan configuration found for Stripe price ID: ${providerPriceId}`);
            }
            return planConfig.name;
        }
        catch (error) {
            logger_1.logger.error(`Failed to get plan from Stripe price ID ${providerPriceId}:`, error);
            throw error;
        }
    }
    // ============================================================================
    // Private Helper Methods
    // ============================================================================
    mapStripeSubscriptionToInternal(subscription) {
        const billingCycle = subscription.items.data[0]?.price.recurring?.interval === 'year' ? 'yearly' : 'monthly';
        return {
            providerSubscriptionId: subscription.id,
            providerCustomerId: typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
            providerPriceId: subscription.items.data[0]?.price.id || '',
            status: this.mapStatusToInternal(subscription.status),
            currentPeriodStart: new Date(subscription.current_period_start * 1000),
            currentPeriodEnd: new Date(subscription.current_period_end * 1000),
            cancelAt: subscription.cancel_at ? new Date(subscription.cancel_at * 1000) : undefined,
            canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : undefined,
            trialStart: subscription.trial_start ? new Date(subscription.trial_start * 1000) : undefined,
            trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000) : undefined,
            billingCycle,
            metadata: subscription.metadata,
        };
    }
}
exports.StripeProvider = StripeProvider;
