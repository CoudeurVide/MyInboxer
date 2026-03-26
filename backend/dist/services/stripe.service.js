"use strict";
/**
 * Stripe Service for SpamRescue
 * Handles all Stripe operations including customer management, checkout sessions,
 * portal sessions, and subscription synchronization
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripe = exports.stripeService = exports.StripeService = void 0;
const stripe_1 = __importDefault(require("stripe"));
const prisma_1 = require("../lib/prisma");
const logger_1 = require("../lib/logger");
// Initialize Stripe with the secret key from environment variables
const stripe = new stripe_1.default(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2023-10-16',
});
exports.stripe = stripe;
class StripeService {
    /**
     * Creates a Stripe customer for a user if one doesn't exist
     */
    async createCustomer(userId, email, name) {
        try {
            // First check if the user already has a customer ID in our database
            const existingUser = await prisma_1.prisma.user.findUnique({
                where: { id: userId },
                select: {
                    subscription: {
                        select: { stripe_customer_id: true }
                    }
                }
            });
            if (existingUser?.subscription?.stripe_customer_id) {
                // If customer ID exists in our database, return its data
                const customer = await stripe.customers.retrieve(existingUser.subscription.stripe_customer_id);
                return customer;
            }
            // Create a new customer in Stripe
            const customer = await stripe.customers.create({
                email,
                name,
                metadata: {
                    userId: userId,
                },
            });
            // Update the user's subscription record with the customer ID
            await prisma_1.prisma.subscription.upsert({
                where: { user_id: userId },
                update: {
                    stripe_customer_id: customer.id,
                },
                create: {
                    user_id: userId,
                    plan: 'free', // Default to free plan
                    status: 'trialing', // Default status
                    current_period_start: new Date(),
                    current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Default to 30 days in future
                },
            });
            logger_1.logger.info(`Stripe customer created for user ${userId}: ${customer.id}`);
            return customer;
        }
        catch (error) {
            logger_1.logger.error(`Failed to create Stripe customer for user ${userId}:`, error);
            throw error;
        }
    }
    /**
     * Creates a checkout session for subscription
     */
    async createCheckoutSession(params) {
        try {
            const { userId, planName, successUrl, cancelUrl, email, trialDays } = params;
            // Get plan configuration from database
            const planConfig = await prisma_1.prisma.subscriptionPlanConfig.findUnique({
                where: { name: planName },
                include: { features: true }
            });
            if (!planConfig) {
                throw new Error(`Plan ${planName} does not exist`);
            }
            // Ensure the user has a Stripe customer ID
            const customerData = await this.getOrCreateCustomer(userId, email);
            // Determine the appropriate price ID based on billing cycle
            const priceId = planConfig.stripe_price_id_monthly; // Default to monthly for now
            if (!priceId) {
                throw new Error(`No Stripe price ID configured for plan ${planName}`);
            }
            // Create checkout session with Stripe
            const session = await stripe.checkout.sessions.create({
                mode: 'subscription',
                customer: customerData.id,
                line_items: [
                    {
                        price: priceId,
                        quantity: 1,
                    },
                ],
                success_url: successUrl,
                cancel_url: cancelUrl,
                allow_promotion_codes: true,
                ...(trialDays && trialDays > 0 ? { trial_period_days: trialDays } : {}),
            });
            logger_1.logger.info(`Checkout session created for user ${userId} and plan ${planName}`);
            return { url: session.url, sessionId: session.id };
        }
        catch (error) {
            logger_1.logger.error(`Failed to create checkout session for user ${userId}:`, error);
            throw error;
        }
    }
    /**
     * Creates a portal session for customer to manage their subscription
     */
    async createPortalSession(params) {
        try {
            const { userId, returnUrl } = params;
            // Get the user's subscription to retrieve their customer ID
            const subscription = await prisma_1.prisma.subscription.findUnique({
                where: { user_id: userId },
                select: { stripe_customer_id: true }
            });
            if (!subscription?.stripe_customer_id) {
                throw new Error(`User ${userId} does not have a Stripe customer ID`);
            }
            // Create portal session with Stripe
            const session = await stripe.billingPortal.sessions.create({
                customer: subscription.stripe_customer_id,
                return_url: returnUrl,
            });
            logger_1.logger.info(`Portal session created for user ${userId}`);
            return { url: session.url };
        }
        catch (error) {
            logger_1.logger.error(`Failed to create portal session for user ${userId}:`, error);
            throw error;
        }
    }
    /**
     * Retrieves or creates a customer for a user
     */
    async getOrCreateCustomer(userId, email, name) {
        try {
            // First check if the user already has a customer ID in our database
            const existingUser = await prisma_1.prisma.user.findUnique({
                where: { id: userId },
                select: {
                    email: true,
                    name: true,
                    subscription: {
                        select: { stripe_customer_id: true }
                    }
                }
            });
            if (existingUser?.subscription?.stripe_customer_id) {
                // If customer ID exists in our database, return its data
                const customer = await stripe.customers.retrieve(existingUser.subscription.stripe_customer_id);
                return customer;
            }
            // If no customer exists, create one
            const customer = await this.createCustomer(userId, email || existingUser?.email, name || existingUser?.name);
            return customer;
        }
        catch (error) {
            logger_1.logger.error(`Failed to get or create customer for user ${userId}:`, error);
            throw error;
        }
    }
    /**
     * Updates subscription information in our database from Stripe
     */
    async syncSubscriptionFromStripe(stripeSubscriptionId) {
        try {
            // Retrieve subscription data from Stripe
            const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId, {
                expand: ['customer', 'plan']
            });
            const customer = stripeSubscription.customer;
            // Find the user by the Stripe customer ID
            const subscription = await prisma_1.prisma.subscription.findFirst({
                where: { stripe_customer_id: customer.id },
                include: {
                    user: true
                }
            });
            if (!subscription) {
                throw new Error(`No subscription found for Stripe customer ${customer.id}`);
            }
            // Look up the plan config to get both name and ID
            const planConfig = await prisma_1.prisma.subscriptionPlanConfig.findFirst({
                where: {
                    OR: [
                        { stripe_price_id_monthly: stripeSubscription.plan.id },
                        { stripe_price_id_yearly: stripeSubscription.plan.id },
                    ]
                }
            });
            if (!planConfig) {
                throw new Error(`No plan configuration found for price ID: ${stripeSubscription.plan.id}`);
            }
            // Update our database with the Stripe subscription data
            await prisma_1.prisma.subscription.update({
                where: { id: subscription.id },
                data: {
                    stripe_subscription_id: stripeSubscription.id,
                    stripe_price_id: stripeSubscription.plan.id,
                    status: this.mapStripeStatusToInternal(stripeSubscription.status),
                    current_period_start: new Date(stripeSubscription.current_period_start * 1000),
                    current_period_end: new Date(stripeSubscription.current_period_end * 1000),
                    cancel_at: stripeSubscription.cancel_at
                        ? new Date(stripeSubscription.cancel_at * 1000)
                        : null,
                    canceled_at: stripeSubscription.canceled_at
                        ? new Date(stripeSubscription.canceled_at * 1000)
                        : null,
                    billing_cycle: stripeSubscription.plan.interval,
                    plan: planConfig.name,
                    plan_config_id: planConfig.id,
                }
            });
            logger_1.logger.info(`Subscription synced from Stripe for user ${subscription.user_id}: plan=${planConfig.name}, plan_config_id=${planConfig.id}`);
        }
        catch (error) {
            logger_1.logger.error(`Failed to sync subscription from Stripe:`, error);
            throw error;
        }
    }
    /**
     * Cancels a user's subscription in Stripe
     */
    async cancelSubscription(userId) {
        try {
            // Get the user's subscription from our database
            const subscription = await prisma_1.prisma.subscription.findUnique({
                where: { user_id: userId },
                select: { stripe_subscription_id: true }
            });
            if (!subscription?.stripe_subscription_id) {
                throw new Error(`User ${userId} does not have an active subscription in Stripe`);
            }
            // Cancel the subscription in Stripe
            await stripe.subscriptions.cancel(subscription.stripe_subscription_id, {
                invoice_now: true, // Generate final invoice
                prorate: true, // Prorate unused time
            });
            // Update our database to reflect the cancellation
            await prisma_1.prisma.subscription.update({
                where: { user_id: userId },
                data: {
                    status: 'cancelled',
                    canceled_at: new Date(),
                }
            });
            logger_1.logger.info(`Subscription canceled for user ${userId}`);
        }
        catch (error) {
            logger_1.logger.error(`Failed to cancel subscription for user ${userId}:`, error);
            throw error;
        }
    }
    /**
     * Maps Stripe subscription status to our internal status
     */
    mapStripeStatusToInternal(stripeStatus) {
        switch (stripeStatus) {
            case 'active':
            case 'trialing':
                return stripeStatus;
            case 'canceled':
            case 'unpaid': // unpaid invoices can be considered past due
            case 'incomplete_expired':
                return 'cancelled';
            case 'past_due':
                return stripeStatus;
            default:
                // For statuses like 'incomplete', 'paused', etc., default to 'cancelled'
                return 'cancelled';
        }
    }
    /**
     * Gets the plan name based on Stripe price ID
     */
    async getPlanNameFromPriceId(priceId) {
        // Find the plan configuration that matches this price ID
        const planConfig = await prisma_1.prisma.subscriptionPlanConfig.findFirst({
            where: {
                OR: [
                    { stripe_price_id_monthly: priceId },
                    { stripe_price_id_yearly: priceId },
                ]
            }
        });
        if (!planConfig) {
            throw new Error(`No plan configuration found for price ID: ${priceId}`);
        }
        // The name in our database corresponds to the enum value
        return planConfig.name;
    }
}
exports.StripeService = StripeService;
// Export both the service and the stripe instance
exports.stripeService = new StripeService();
