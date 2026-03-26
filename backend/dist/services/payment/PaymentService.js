"use strict";
/**
 * Payment Service (Unified)
 * Provider-agnostic payment service that routes to appropriate provider
 * This replaces direct usage of stripe.service.ts
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.paymentService = exports.PaymentService = void 0;
const prisma_1 = require("../../lib/prisma");
const logger_1 = require("../../lib/logger");
const PaymentProviderFactory_1 = require("./PaymentProviderFactory");
class PaymentService {
    /**
     * Creates a checkout session for a subscription
     * @param params Checkout parameters including provider type
     * @returns Checkout session with URL
     */
    async createCheckoutSession(params) {
        try {
            const { provider, userId, planName, successUrl, cancelUrl, email, trialDays } = params;
            logger_1.logger.info(`Creating checkout session for user ${userId} with ${provider} provider`);
            // Get the provider instance
            const paymentProvider = PaymentProviderFactory_1.PaymentProviderFactory.getProvider(provider);
            // Get plan configuration
            const planConfig = await prisma_1.prisma.subscriptionPlanConfig.findUnique({
                where: { name: planName },
            });
            if (!planConfig) {
                throw new Error(`Plan ${planName} not found`);
            }
            // Get the appropriate price ID based on provider
            let priceId;
            if (provider === 'stripe') {
                priceId = planConfig.stripe_price_id_monthly; // Default to monthly
                if (!priceId) {
                    throw new Error(`No Stripe price ID configured for plan ${planName}`);
                }
            }
            else if (provider === 'lemonsqueezy') {
                priceId = planConfig.lemonsqueezy_variant_id_monthly; // Default to monthly
                if (!priceId) {
                    throw new Error(`No LemonSqueezy variant ID configured for plan ${planName}`);
                }
            }
            else {
                throw new Error(`Unsupported payment provider: ${provider}`);
            }
            // Create checkout session through provider
            const checkoutData = await paymentProvider.createCheckoutSession({
                userId,
                planName,
                priceId,
                successUrl,
                cancelUrl,
                email,
                trialDays,
            });
            // NOTE: We do NOT create a subscription record here.
            // The subscription will be created by the Stripe webhook when payment is confirmed.
            // Creating a subscription here would allow users to bypass payment by clicking back.
            logger_1.logger.info(`Checkout session created successfully for user ${userId}`);
            return checkoutData;
        }
        catch (error) {
            logger_1.logger.error('Failed to create checkout session:', error);
            throw error;
        }
    }
    /**
     * Creates a portal session for managing subscription
     * Auto-detects provider from user's subscription
     * @param userId User ID
     * @param returnUrl Return URL after portal actions
     * @returns Portal session with URL
     */
    async createPortalSession(userId, returnUrl) {
        try {
            // Get user's subscription to determine provider
            const subscription = await prisma_1.prisma.subscription.findUnique({
                where: { user_id: userId },
            });
            if (!subscription) {
                throw new Error(`No subscription found for user ${userId}`);
            }
            const provider = subscription.payment_provider || 'stripe';
            const providerCustomerId = subscription.provider_customer_id || subscription.stripe_customer_id;
            if (!providerCustomerId) {
                throw new Error(`No customer ID found for user ${userId}`);
            }
            logger_1.logger.info(`Creating portal session for user ${userId} with ${provider} provider`);
            // Get provider and create portal session
            const paymentProvider = PaymentProviderFactory_1.PaymentProviderFactory.getProvider(provider);
            const portalData = await paymentProvider.createPortalSession({
                userId,
                providerCustomerId,
                returnUrl,
            });
            logger_1.logger.info(`Portal session created successfully for user ${userId}`);
            return portalData;
        }
        catch (error) {
            logger_1.logger.error('Failed to create portal session:', error);
            throw error;
        }
    }
    /**
     * Syncs subscription from payment provider to database
     * @param providerSubscriptionId Provider's subscription ID
     * @param provider Payment provider type
     * @returns Synced subscription data
     */
    async syncSubscription(providerSubscriptionId, provider) {
        try {
            logger_1.logger.info(`Syncing subscription ${providerSubscriptionId} from ${provider} provider`);
            const paymentProvider = PaymentProviderFactory_1.PaymentProviderFactory.getProvider(provider);
            const subscriptionData = await paymentProvider.syncSubscription(providerSubscriptionId);
            // Find subscription in database by provider subscription ID
            const subscription = await prisma_1.prisma.subscription.findFirst({
                where: {
                    OR: [
                        { provider_subscription_id: providerSubscriptionId },
                        ...(provider === 'stripe' ? [{ stripe_subscription_id: providerSubscriptionId }] : []),
                    ],
                },
            });
            if (subscription) {
                // Update existing subscription
                await this.updateSubscriptionInDatabase(subscription.user_id, subscriptionData, provider);
            }
            else {
                logger_1.logger.warn(`Subscription ${providerSubscriptionId} not found in database, may need manual intervention`);
            }
            logger_1.logger.info(`Subscription synced successfully: ${providerSubscriptionId}`);
            return subscriptionData;
        }
        catch (error) {
            logger_1.logger.error(`Failed to sync subscription ${providerSubscriptionId}:`, error);
            throw error;
        }
    }
    /**
     * Cancels a user's subscription
     * Auto-detects provider from user's subscription
     * @param userId User ID
     */
    async cancelSubscription(userId) {
        try {
            // Get user's subscription
            const subscription = await prisma_1.prisma.subscription.findUnique({
                where: { user_id: userId },
            });
            if (!subscription) {
                throw new Error(`No subscription found for user ${userId}`);
            }
            const provider = subscription.payment_provider || 'stripe';
            const providerSubscriptionId = subscription.provider_subscription_id || subscription.stripe_subscription_id;
            if (!providerSubscriptionId) {
                throw new Error(`No provider subscription ID found for user ${userId}`);
            }
            logger_1.logger.info(`Cancelling subscription for user ${userId} with ${provider} provider`);
            // Cancel through provider
            const paymentProvider = PaymentProviderFactory_1.PaymentProviderFactory.getProvider(provider);
            await paymentProvider.cancelSubscription(providerSubscriptionId);
            // Update database
            await prisma_1.prisma.subscription.update({
                where: { user_id: userId },
                data: {
                    status: 'cancelled',
                    canceled_at: new Date(),
                },
            });
            logger_1.logger.info(`Subscription cancelled successfully for user ${userId}`);
        }
        catch (error) {
            logger_1.logger.error(`Failed to cancel subscription for user ${userId}:`, error);
            throw error;
        }
    }
    /**
     * Lists invoices for a user
     * Auto-detects provider from user's subscription
     * @param userId User ID
     * @param limit Number of invoices to retrieve
     * @returns List of invoices
     */
    async listInvoices(userId, limit = 10) {
        try {
            // Get user's subscription
            const subscription = await prisma_1.prisma.subscription.findUnique({
                where: { user_id: userId },
            });
            if (!subscription) {
                return { invoices: [], hasMore: false };
            }
            const provider = subscription.payment_provider || 'stripe';
            const providerCustomerId = subscription.provider_customer_id || subscription.stripe_customer_id;
            if (!providerCustomerId) {
                return { invoices: [], hasMore: false };
            }
            logger_1.logger.info(`Listing invoices for user ${userId} with ${provider} provider`);
            // Get invoices from provider
            const paymentProvider = PaymentProviderFactory_1.PaymentProviderFactory.getProvider(provider);
            const invoices = await paymentProvider.listInvoices({
                providerCustomerId,
                limit,
            });
            return invoices;
        }
        catch (error) {
            logger_1.logger.error(`Failed to list invoices for user ${userId}:`, error);
            throw error;
        }
    }
    /**
     * Gets available payment providers
     * @returns List of available provider names
     */
    getAvailableProviders() {
        return PaymentProviderFactory_1.PaymentProviderFactory.getAvailableProviders();
    }
    /**
     * Gets the default payment provider
     * @returns Default provider name
     */
    getDefaultProvider() {
        return PaymentProviderFactory_1.PaymentProviderFactory.getDefaultProviderType();
    }
    // ============================================================================
    // Private Helper Methods
    // ============================================================================
    /**
     * Updates subscription in database with data from provider
     */
    async updateSubscriptionInDatabase(userId, data, provider) {
        try {
            // Get plan name from price ID
            const paymentProvider = PaymentProviderFactory_1.PaymentProviderFactory.getProvider(provider);
            const planName = await paymentProvider.getPlanFromPriceId(data.providerPriceId);
            // Update subscription
            await prisma_1.prisma.subscription.update({
                where: { user_id: userId },
                data: {
                    payment_provider: provider,
                    provider_customer_id: data.providerCustomerId,
                    provider_subscription_id: data.providerSubscriptionId,
                    provider_price_id: data.providerPriceId,
                    // Also update legacy Stripe fields if it's Stripe
                    ...(provider === 'stripe'
                        ? {
                            stripe_customer_id: data.providerCustomerId,
                            stripe_subscription_id: data.providerSubscriptionId,
                            stripe_price_id: data.providerPriceId,
                        }
                        : {}),
                    plan: planName,
                    status: data.status,
                    current_period_start: data.currentPeriodStart,
                    current_period_end: data.currentPeriodEnd,
                    cancel_at: data.cancelAt,
                    canceled_at: data.canceledAt,
                    trial_start: data.trialStart,
                    trial_end: data.trialEnd,
                    billing_cycle: data.billingCycle,
                    updated_at: new Date(),
                },
            });
            logger_1.logger.info(`Subscription updated in database for user ${userId}`);
        }
        catch (error) {
            logger_1.logger.error(`Failed to update subscription in database for user ${userId}:`, error);
            throw error;
        }
    }
}
exports.PaymentService = PaymentService;
// Export singleton instance
exports.paymentService = new PaymentService();
