"use strict";
/**
 * Subscription Service for SpamRescue
 * Manages user subscriptions, plan changes, and trial management
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.subscriptionService = exports.SubscriptionService = void 0;
const prisma_1 = require("../lib/prisma");
const logger_1 = require("../lib/logger");
const PaymentService_1 = require("./payment/PaymentService");
const usage_service_1 = require("./usage.service");
class SubscriptionService {
    /**
     * Gets a user's subscription details
     */
    async getUserSubscription(userId) {
        try {
            const subscription = await prisma_1.prisma.subscription.findUnique({
                where: { user_id: userId },
                select: {
                    id: true,
                    user_id: true,
                    plan: true,
                    status: true,
                    current_period_start: true,
                    current_period_end: true,
                    cancel_at: true,
                    created_at: true,
                    updated_at: true,
                    payment_provider: true,
                    stripe_customer_id: true,
                    stripe_subscription_id: true,
                    trial_start: true,
                    trial_end: true,
                    canceled_at: true,
                    billing_cycle: true,
                    payment_method_last4: true,
                    payment_method_brand: true,
                },
            });
            if (!subscription) {
                return null;
            }
            return {
                id: subscription.id,
                userId: subscription.user_id,
                plan: subscription.plan,
                status: subscription.status,
                currentPeriodStart: subscription.current_period_start,
                currentPeriodEnd: subscription.current_period_end,
                cancelAt: subscription.cancel_at || undefined,
                createdAt: subscription.created_at,
                updatedAt: subscription.updated_at,
                paymentProvider: subscription.payment_provider || undefined,
                stripeCustomerId: subscription.stripe_customer_id || undefined,
                stripeSubscriptionId: subscription.stripe_subscription_id || undefined,
                trialStart: subscription.trial_start || undefined,
                trialEnd: subscription.trial_end || undefined,
                canceledAt: subscription.canceled_at || undefined,
                billingCycle: subscription.billing_cycle || undefined,
                paymentMethodLast4: subscription.payment_method_last4 || undefined,
                paymentMethodBrand: subscription.payment_method_brand || undefined,
            };
        }
        catch (error) {
            logger_1.logger.error(`Failed to get subscription for user ${userId}:`, error);
            throw error;
        }
    }
    /**
     * Handles subscription updates from payment provider webhook events
     */
    async handleSubscriptionUpdate(providerSubscriptionId, provider = 'stripe') {
        try {
            // Sync subscription data from payment provider
            await PaymentService_1.paymentService.syncSubscription(providerSubscriptionId, provider);
            // Get the updated subscription data from our database
            const subscription = await prisma_1.prisma.subscription.findFirst({
                where: {
                    OR: [
                        { provider_subscription_id: providerSubscriptionId },
                        ...(provider === 'stripe' ? [{ stripe_subscription_id: providerSubscriptionId }] : []),
                    ],
                },
            });
            if (!subscription) {
                throw new Error(`Subscription not found for ${provider} ID: ${providerSubscriptionId}`);
            }
            // If the subscription was canceled, reset usage for the user
            if (subscription.status === 'cancelled') {
                await usage_service_1.usageService.resetUsageForNewPeriod(subscription.user_id);
            }
            logger_1.logger.info(`Subscription updated for user ${subscription.user_id} from ${provider} event`);
        }
        catch (error) {
            logger_1.logger.error(`Failed to handle subscription update for ${provider} ID ${providerSubscriptionId}:`, error);
            throw error;
        }
    }
    /**
     * Grants a trial period to a user (default 14 days on Starter plan, no credit card required)
     */
    async grantTrial(userId, trialDays = 14) {
        try {
            // Check if the user already has an active trial or subscription
            const existingSub = await prisma_1.prisma.subscription.findUnique({
                where: { user_id: userId }
            });
            if (existingSub) {
                // Don't grant a trial if they already have an active paid subscription
                if (existingSub.status !== 'trialing' && existingSub.plan !== 'free') {
                    throw new Error(`User ${userId} already has an active paid subscription`);
                }
            }
            // Get the Starter plan config to link to the subscription
            const starterPlanConfig = await prisma_1.prisma.subscriptionPlanConfig.findUnique({
                where: { name: 'starter' }
            });
            // Calculate trial end date
            const trialEnd = new Date();
            trialEnd.setDate(trialEnd.getDate() + trialDays);
            // Update or create the subscription with trial information
            // Trial is on Starter plan with all Starter features
            await prisma_1.prisma.subscription.upsert({
                where: { user_id: userId },
                update: {
                    plan: 'starter', // Trial on Starter plan with full features
                    status: 'trialing',
                    trial_start: existingSub?.trial_start || new Date(), // Keep original trial start if exists
                    trial_end: trialEnd,
                    current_period_start: new Date(),
                    current_period_end: trialEnd,
                    plan_config_id: starterPlanConfig?.id, // Link to starter plan config
                    payment_provider: null, // No payment provider for trial
                    stripe_customer_id: null, // No Stripe customer yet
                    stripe_subscription_id: null, // No Stripe subscription yet
                },
                create: {
                    user_id: userId,
                    plan: 'starter', // Trial on Starter plan with full features
                    status: 'trialing',
                    trial_start: new Date(),
                    trial_end: trialEnd,
                    current_period_start: new Date(),
                    current_period_end: trialEnd,
                    plan_config_id: starterPlanConfig?.id, // Link to starter plan config
                }
            });
            logger_1.logger.info(`Trial granted to user ${userId} for ${trialDays} days on Starter plan (no credit card required)`);
        }
        catch (error) {
            logger_1.logger.error(`Failed to grant trial to user ${userId}:`, error);
            throw error;
        }
    }
    /**
     * Checks if a user is eligible for a free trial
     */
    async checkTrialEligibility(userId) {
        try {
            const subscription = await prisma_1.prisma.subscription.findUnique({
                where: { user_id: userId }
            });
            // Check if the user already had a trial
            if (subscription?.trial_start) {
                return {
                    eligibleForTrial: false,
                    trialDays: 0,
                    reason: 'User has already used their trial period'
                };
            }
            // Check if the user has an active paid subscription
            if (subscription && subscription.plan !== 'free') {
                return {
                    eligibleForTrial: false,
                    trialDays: 0,
                    reason: 'User already has an active paid subscription'
                };
            }
            // User is eligible for a trial
            return {
                eligibleForTrial: true,
                trialDays: 14, // Default trial length
            };
        }
        catch (error) {
            logger_1.logger.error(`Failed to check trial eligibility for user ${userId}:`, error);
            throw error;
        }
    }
    /**
     * Checks if a user's subscription is active and they can use the service
     * Returns { canUse: boolean, reason?: string, trialExpired?: boolean, daysUntilExpiry?: number }
     */
    async checkSubscriptionStatus(userId) {
        try {
            const subscription = await prisma_1.prisma.subscription.findUnique({
                where: { user_id: userId },
                select: {
                    status: true,
                    plan: true,
                    trial_end: true,
                    current_period_end: true,
                },
            });
            // No subscription - user needs to select a plan
            if (!subscription) {
                return {
                    canUse: false,
                    reason: 'No subscription found. Please select a plan.',
                    status: 'no_subscription'
                };
            }
            // Check if it's a trial
            if (subscription.status === 'trialing') {
                const now = new Date();
                const trialEnd = subscription.trial_end ? new Date(subscription.trial_end) : null;
                if (trialEnd && now > trialEnd) {
                    // Trial has expired
                    return {
                        canUse: false,
                        reason: 'Your trial has expired. Please upgrade to continue using the service.',
                        trialExpired: true,
                        status: 'trial_expired'
                    };
                }
                // Trial is still active
                const daysLeft = trialEnd ? Math.ceil((trialEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : 0;
                return {
                    canUse: true,
                    daysUntilExpiry: daysLeft,
                    status: 'trialing'
                };
            }
            // Active paid subscription
            if (subscription.status === 'active') {
                return {
                    canUse: true,
                    status: 'active'
                };
            }
            // Past due - give some grace period
            if (subscription.status === 'past_due') {
                return {
                    canUse: true, // Allow limited access
                    reason: 'Your payment is past due. Please update your payment method.',
                    status: 'past_due'
                };
            }
            // Cancelled - can still use until end of period
            if (subscription.status === 'cancelled') {
                const periodEnd = new Date(subscription.current_period_end);
                const now = new Date();
                if (now < periodEnd) {
                    const daysLeft = Math.ceil((periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                    return {
                        canUse: true,
                        reason: `Subscription cancelled. Access ends in ${daysLeft} days.`,
                        daysUntilExpiry: daysLeft,
                        status: 'cancelled'
                    };
                }
                return {
                    canUse: false,
                    reason: 'Your subscription has ended. Please resubscribe to continue.',
                    status: 'expired'
                };
            }
            return {
                canUse: false,
                reason: 'Unknown subscription status',
                status: subscription.status
            };
        }
        catch (error) {
            logger_1.logger.error(`Failed to check subscription status for user ${userId}:`, error);
            // On error, allow access to avoid blocking legitimate users
            return { canUse: true, status: 'error' };
        }
    }
    /**
     * Changes a user's subscription plan (upgrades/downgrades)
     */
    async changeUserPlan(userId, newPlanName, isUpgrade = true) {
        try {
            // Get the new plan configuration
            const newPlanConfig = await prisma_1.prisma.subscriptionPlanConfig.findUnique({
                where: { name: newPlanName },
                include: { features: true }
            });
            if (!newPlanConfig) {
                throw new Error(`Plan ${newPlanName} does not exist`);
            }
            // Get the user's current subscription
            const currentSubscription = await prisma_1.prisma.subscription.findUnique({
                where: { user_id: userId }
            });
            if (!currentSubscription) {
                throw new Error(`No existing subscription found for user ${userId}`);
            }
            // If this is an upgrade, process immediately
            // If this is a downgrade, you might want to apply it at the end of the current billing period
            let effectiveDate = new Date();
            let currentPeriodEnd = new Date();
            if (!isUpgrade) {
                // For downgrades, apply at the end of the current billing period
                effectiveDate = currentSubscription.current_period_end;
                currentPeriodEnd = currentSubscription.current_period_end;
            }
            else {
                // For upgrades, apply immediately
                currentPeriodEnd = new Date();
                currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1); // Next month
            }
            // Update the subscription with plan name AND plan_config_id
            await prisma_1.prisma.subscription.update({
                where: { user_id: userId },
                data: {
                    plan: newPlanName,
                    plan_config_id: newPlanConfig.id,
                    status: 'active',
                    current_period_start: effectiveDate,
                    current_period_end: currentPeriodEnd,
                    updated_at: new Date(),
                }
            });
            // Reset usage tracking for the new plan period if upgrading
            if (isUpgrade) {
                await usage_service_1.usageService.resetUsageForNewPeriod(userId);
            }
            logger_1.logger.info(`Plan changed for user ${userId} to ${newPlanName} (plan_config_id: ${newPlanConfig.id}, upgrade: ${isUpgrade})`);
        }
        catch (error) {
            logger_1.logger.error(`Failed to change plan for user ${userId} to ${newPlanName}:`, error);
            throw error;
        }
    }
    /**
     * Cancels a user's subscription
     */
    async cancelSubscription(userId, immediate = false) {
        try {
            // Get the user's subscription
            const subscription = await prisma_1.prisma.subscription.findUnique({
                where: { user_id: userId },
                select: {
                    id: true,
                    provider_subscription_id: true,
                    stripe_subscription_id: true,
                    current_period_end: true,
                    plan: true,
                },
            });
            if (!subscription) {
                throw new Error(`No subscription found for user ${userId}`);
            }
            // Cancel through payment provider if there's a subscription ID
            const providerSubId = subscription.provider_subscription_id || subscription.stripe_subscription_id;
            if (providerSubId) {
                await PaymentService_1.paymentService.cancelSubscription(userId);
            }
            // Update the subscription status in our database (if not already updated by paymentService)
            const currentSub = await prisma_1.prisma.subscription.findUnique({
                where: { user_id: userId },
            });
            if (currentSub && currentSub.status !== 'cancelled') {
                const updateData = {
                    status: 'cancelled',
                    canceled_at: new Date(),
                };
                // If immediate cancellation, end now; otherwise, cancel at period end
                if (immediate) {
                    updateData.cancel_at = new Date();
                    updateData.current_period_end = new Date();
                }
                else {
                    updateData.cancel_at = subscription.current_period_end;
                }
                await prisma_1.prisma.subscription.update({
                    where: { user_id: userId },
                    data: updateData,
                });
            }
            // Reset usage for the canceled subscription
            await usage_service_1.usageService.resetUsageForNewPeriod(userId);
            logger_1.logger.info(`Subscription cancelled for user ${userId} (immediate: ${immediate})`);
        }
        catch (error) {
            logger_1.logger.error(`Failed to cancel subscription for user ${userId}:`, error);
            throw error;
        }
    }
    /**
     * Updates billing information for a subscription
     */
    async updateBillingInfo(userId, paymentMethodId) {
        try {
            // In a real implementation, you would update the payment method in Stripe
            // and sync the information back to your database
            // First, ensure the user has a Stripe customer
            const customer = await stripeService.getOrCreateCustomer(userId);
            // Update the default payment method for the customer
            // This is a simplified example - real implementation would require
            // more validation and error handling
            logger_1.logger.info(`Billing info updated for user ${userId}`);
        }
        catch (error) {
            logger_1.logger.error(`Failed to update billing info for user ${userId}:`, error);
            throw error;
        }
    }
    /**
     * Applies a coupon or discount to a subscription
     */
    async applyCoupon(userId, couponCode) {
        try {
            // In a real implementation, this would validate the coupon
            // with Stripe and apply it to the user's subscription
            // Check if coupon is valid in Stripe
            // const coupon = await stripe.coupons.retrieve(couponCode);
            // Apply coupon to customer or subscription
            logger_1.logger.info(`Coupon ${couponCode} applied for user ${userId}`);
            return true;
        }
        catch (error) {
            logger_1.logger.error(`Failed to apply coupon ${couponCode} for user ${userId}:`, error);
            return false; // Return false instead of throwing to handle gracefully
        }
    }
}
exports.SubscriptionService = SubscriptionService;
// Export a singleton instance of the subscription service
exports.subscriptionService = new SubscriptionService();
