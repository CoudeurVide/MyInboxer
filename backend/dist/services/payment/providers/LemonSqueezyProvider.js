"use strict";
/**
 * LemonSqueezy Payment Provider
 * Implements IPaymentProvider for LemonSqueezy payment processing
 *
 * Note: Requires @lemonsqueezy/lemonsqueezy.js to be installed
 * Run: npm install @lemonsqueezy/lemonsqueezy.js
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LemonSqueezyProvider = void 0;
const crypto_1 = require("crypto");
const prisma_1 = require("../../../lib/prisma");
const logger_1 = require("../../../lib/logger");
class LemonSqueezyProvider {
    providerName = 'lemonsqueezy';
    apiKey;
    storeId;
    baseUrl = 'https://api.lemonsqueezy.com/v1';
    constructor() {
        if (!process.env.LEMONSQUEEZY_API_KEY) {
            throw new Error('LEMONSQUEEZY_API_KEY environment variable is required');
        }
        if (!process.env.LEMONSQUEEZY_STORE_ID) {
            throw new Error('LEMONSQUEEZY_STORE_ID environment variable is required');
        }
        this.apiKey = process.env.LEMONSQUEEZY_API_KEY;
        this.storeId = process.env.LEMONSQUEEZY_STORE_ID;
        logger_1.logger.info('LemonSqueezy provider initialized');
    }
    // ============================================================================
    // Customer Management
    // ============================================================================
    async createCustomer(params) {
        // LemonSqueezy handles customer creation during checkout
        // We'll return a placeholder that will be filled during checkout
        logger_1.logger.info(`LemonSqueezy: Customer will be created during checkout for user ${params.userId}`);
        return {
            providerCustomerId: `pending_${params.userId}`,
            email: params.email,
            name: params.name,
            created: new Date(),
            metadata: params.metadata,
        };
    }
    async getCustomer(providerCustomerId) {
        try {
            const response = await this.makeRequest(`/customers/${providerCustomerId}`);
            const customer = response.data;
            return {
                providerCustomerId: customer.id,
                email: customer.attributes.email,
                name: customer.attributes.name,
                created: new Date(customer.attributes.created_at),
            };
        }
        catch (error) {
            logger_1.logger.error(`Failed to get LemonSqueezy customer ${providerCustomerId}:`, error);
            throw error;
        }
    }
    async getOrCreateCustomer(params, existingCustomerId) {
        if (existingCustomerId && !existingCustomerId.startsWith('pending_')) {
            try {
                return await this.getCustomer(existingCustomerId);
            }
            catch (error) {
                logger_1.logger.warn(`Failed to retrieve existing LemonSqueezy customer, will create during checkout`);
            }
        }
        return await this.createCustomer(params);
    }
    // ============================================================================
    // Checkout & Subscriptions
    // ============================================================================
    async createCheckoutSession(params) {
        try {
            const { userId, priceId, successUrl, cancelUrl, email } = params;
            // Create a checkout URL using LemonSqueezy API
            const response = await this.makeRequest('/checkouts', 'POST', {
                data: {
                    type: 'checkouts',
                    attributes: {
                        checkout_data: {
                            email,
                            custom: {
                                user_id: userId,
                            },
                        },
                    },
                    relationships: {
                        store: {
                            data: {
                                type: 'stores',
                                id: this.storeId,
                            },
                        },
                        variant: {
                            data: {
                                type: 'variants',
                                id: priceId, // LemonSqueezy uses variant IDs
                            },
                        },
                    },
                },
            });
            const checkout = response.data;
            const checkoutUrl = checkout.attributes.url;
            logger_1.logger.info(`LemonSqueezy checkout created for user ${userId}`);
            return {
                checkoutUrl: `${checkoutUrl}?checkout[custom][success_url]=${encodeURIComponent(successUrl)}&checkout[custom][cancel_url]=${encodeURIComponent(cancelUrl)}`,
                sessionId: checkout.id,
            };
        }
        catch (error) {
            logger_1.logger.error('Failed to create LemonSqueezy checkout:', error);
            throw error;
        }
    }
    async createPortalSession(params) {
        try {
            const { providerCustomerId } = params;
            // LemonSqueezy customer portal URL
            const portalUrl = `https://app.lemonsqueezy.com/my-orders`;
            logger_1.logger.info(`LemonSqueezy portal session created for customer ${providerCustomerId}`);
            return {
                portalUrl,
            };
        }
        catch (error) {
            logger_1.logger.error('Failed to create LemonSqueezy portal session:', error);
            throw error;
        }
    }
    async getSubscription(providerSubscriptionId) {
        try {
            const response = await this.makeRequest(`/subscriptions/${providerSubscriptionId}`);
            const subscription = response.data;
            return this.mapLemonSqueezySubscriptionToInternal(subscription);
        }
        catch (error) {
            logger_1.logger.error(`Failed to get LemonSqueezy subscription ${providerSubscriptionId}:`, error);
            throw error;
        }
    }
    async syncSubscription(providerSubscriptionId) {
        try {
            const subscriptionData = await this.getSubscription(providerSubscriptionId);
            logger_1.logger.info(`LemonSqueezy subscription synced: ${providerSubscriptionId}`);
            return subscriptionData;
        }
        catch (error) {
            logger_1.logger.error(`Failed to sync LemonSqueezy subscription ${providerSubscriptionId}:`, error);
            throw error;
        }
    }
    async cancelSubscription(providerSubscriptionId) {
        try {
            await this.makeRequest(`/subscriptions/${providerSubscriptionId}`, 'DELETE');
            logger_1.logger.info(`LemonSqueezy subscription cancelled: ${providerSubscriptionId}`);
        }
        catch (error) {
            logger_1.logger.error(`Failed to cancel LemonSqueezy subscription ${providerSubscriptionId}:`, error);
            throw error;
        }
    }
    // ============================================================================
    // Invoice Management
    // ============================================================================
    async listInvoices(params) {
        try {
            const { providerCustomerId, limit = 10 } = params;
            // Get orders for the customer (LemonSqueezy doesn't have traditional invoices)
            const response = await this.makeRequest(`/orders?filter[customer_id]=${providerCustomerId}&page[size]=${limit}`);
            const orders = response.data || [];
            return {
                invoices: orders.map((order) => ({
                    id: order.id,
                    number: order.attributes.order_number?.toString(),
                    status: order.attributes.status,
                    amount: order.attributes.total,
                    currency: order.attributes.currency,
                    created: Math.floor(new Date(order.attributes.created_at).getTime() / 1000), // Unix timestamp (seconds)
                    paidAt: order.attributes.status === 'paid'
                        ? Math.floor(new Date(order.attributes.created_at).getTime() / 1000)
                        : undefined,
                    invoicePdfUrl: order.attributes.receipt_url,
                    hostedInvoiceUrl: order.attributes.receipt_url,
                })),
                hasMore: false, // LemonSqueezy pagination differs from Stripe
            };
        }
        catch (error) {
            logger_1.logger.error('Failed to list LemonSqueezy invoices:', error);
            throw error;
        }
    }
    // ============================================================================
    // Webhook Handling
    // ============================================================================
    async validateWebhook(rawBody, signature, secret) {
        try {
            // Validate webhook signature using HMAC
            const hmac = (0, crypto_1.createHmac)('sha256', secret);
            const digest = hmac.update(rawBody).digest('hex');
            if (digest !== signature) {
                throw new Error('Invalid webhook signature');
            }
            const payload = JSON.parse(rawBody);
            return {
                id: payload.meta.event_name + '_' + Date.now(),
                type: payload.meta.event_name,
                data: payload.data,
                createdAt: new Date(),
            };
        }
        catch (error) {
            logger_1.logger.error('LemonSqueezy webhook validation failed:', error);
            throw new Error(`Webhook signature verification failed: ${error.message}`);
        }
    }
    async processWebhookEvent(event) {
        try {
            logger_1.logger.info(`Processing LemonSqueezy webhook event: ${event.type}`);
            switch (event.type) {
                case 'subscription_created':
                case 'subscription_updated':
                case 'subscription_cancelled': {
                    const subscription = event.data;
                    const subscriptionData = this.mapLemonSqueezySubscriptionToInternal(subscription);
                    return {
                        success: true,
                        subscriptionData,
                    };
                }
                case 'subscription_payment_success':
                case 'subscription_payment_failed': {
                    const subscriptionId = event.data.attributes.subscription_id;
                    if (subscriptionId) {
                        const subscriptionData = await this.getSubscription(subscriptionId.toString());
                        return {
                            success: true,
                            subscriptionData,
                        };
                    }
                    return { success: true };
                }
                default:
                    logger_1.logger.debug(`Unhandled LemonSqueezy webhook event type: ${event.type}`);
                    return { success: true };
            }
        }
        catch (error) {
            logger_1.logger.error(`Failed to process LemonSqueezy webhook event ${event.id}:`, error);
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
        switch (providerStatus.toLowerCase()) {
            case 'active':
                return 'active';
            case 'on_trial':
                return 'trialing';
            case 'cancelled':
            case 'expired':
            case 'unpaid':
                return 'cancelled';
            case 'past_due':
                return 'past_due';
            default:
                logger_1.logger.warn(`Unknown LemonSqueezy status: ${providerStatus}, defaulting to cancelled`);
                return 'cancelled';
        }
    }
    async getPlanFromPriceId(providerPriceId) {
        try {
            const planConfig = await prisma_1.prisma.subscriptionPlanConfig.findFirst({
                where: {
                    OR: [
                        { lemonsqueezy_variant_id_monthly: providerPriceId },
                        { lemonsqueezy_variant_id_yearly: providerPriceId },
                    ],
                },
            });
            if (!planConfig) {
                throw new Error(`No plan configuration found for LemonSqueezy variant ID: ${providerPriceId}`);
            }
            return planConfig.name;
        }
        catch (error) {
            logger_1.logger.error(`Failed to get plan from LemonSqueezy variant ID ${providerPriceId}:`, error);
            throw error;
        }
    }
    // ============================================================================
    // Private Helper Methods
    // ============================================================================
    async makeRequest(endpoint, method = 'GET', body) {
        const url = `${this.baseUrl}${endpoint}`;
        const response = await fetch(url, {
            method,
            headers: {
                'Accept': 'application/vnd.api+json',
                'Content-Type': 'application/vnd.api+json',
                'Authorization': `Bearer ${this.apiKey}`,
            },
            ...(body && { body: JSON.stringify(body) }),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`LemonSqueezy API error: ${response.status} - ${errorText}`);
        }
        return await response.json();
    }
    mapLemonSqueezySubscriptionToInternal(subscription) {
        const attrs = subscription.attributes;
        // Determine billing cycle from variant (would need to fetch variant details)
        const billingCycle = 'monthly'; // Default, should be fetched from variant
        return {
            providerSubscriptionId: subscription.id,
            providerCustomerId: attrs.customer_id.toString(),
            providerPriceId: attrs.variant_id.toString(),
            status: this.mapStatusToInternal(attrs.status),
            currentPeriodStart: new Date(attrs.created_at),
            currentPeriodEnd: attrs.renews_at ? new Date(attrs.renews_at) : new Date(attrs.created_at),
            cancelAt: attrs.ends_at ? new Date(attrs.ends_at) : undefined,
            trialStart: attrs.trial_ends_at ? new Date(attrs.created_at) : undefined,
            trialEnd: attrs.trial_ends_at ? new Date(attrs.trial_ends_at) : undefined,
            billingCycle,
        };
    }
}
exports.LemonSqueezyProvider = LemonSqueezyProvider;
