"use strict";
/**
 * Plan Service for SpamRescue
 * Manages subscription plan configurations and feature access
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.planService = exports.PlanService = void 0;
const prisma_1 = require("../lib/prisma");
const plan_features_1 = require("../lib/plan-features");
const logger_1 = require("../lib/logger");
class PlanService {
    /**
     * Gets a plan by name
     */
    async getPlanByName(name) {
        try {
            const planConfig = await prisma_1.prisma.subscriptionPlanConfig.findUnique({
                where: { name },
                include: {
                    features: true
                }
            });
            if (!planConfig) {
                return null;
            }
            return {
                id: planConfig.id,
                name: planConfig.name,
                displayName: planConfig.display_name,
                description: planConfig.description || undefined,
                priceMonthly: planConfig.price_monthly,
                priceYearly: planConfig.price_yearly || undefined,
                stripePriceIdMonthly: planConfig.stripe_price_id_monthly || undefined,
                stripePriceIdYearly: planConfig.stripe_price_id_yearly || undefined,
                isActive: planConfig.is_active,
                sortOrder: planConfig.sort_order,
                features: planConfig.features.map(f => ({
                    key: f.feature_key,
                    value: f.feature_value,
                    type: f.feature_type,
                }))
            };
        }
        catch (error) {
            logger_1.logger.error(`Failed to get plan by name ${name}:`, error);
            throw error;
        }
    }
    /**
     * Gets all available plans
     */
    async getAllPlans() {
        try {
            const planConfigs = await prisma_1.prisma.subscriptionPlanConfig.findMany({
                where: { is_active: true },
                include: {
                    features: true
                },
                orderBy: { sort_order: 'asc' }
            });
            return planConfigs.map(planConfig => ({
                id: planConfig.id,
                name: planConfig.name,
                displayName: planConfig.display_name,
                description: planConfig.description || undefined,
                priceMonthly: planConfig.price_monthly,
                priceYearly: planConfig.price_yearly || undefined,
                stripePriceIdMonthly: planConfig.stripe_price_id_monthly || undefined,
                stripePriceIdYearly: planConfig.stripe_price_id_yearly || undefined,
                isActive: planConfig.is_active,
                sortOrder: planConfig.sort_order,
                features: planConfig.features.map(f => ({
                    key: f.feature_key,
                    value: f.feature_value,
                    type: f.feature_type,
                }))
            }));
        }
        catch (error) {
            logger_1.logger.error('Failed to get all plans:', error);
            throw error;
        }
    }
    /**
     * Checks if a user has access to a specific feature
     */
    async checkFeatureAccess(userId, featureKey) {
        try {
            // Get the user's current subscription
            const subscription = await prisma_1.prisma.subscription.findUnique({
                where: { user_id: userId },
                include: {
                    plan_config: {
                        include: {
                            features: true
                        }
                    }
                }
            });
            if (!subscription || !subscription.plan_config) {
                // If no subscription or plan config found, use free plan defaults
                logger_1.logger.warn(`No subscription found for user ${userId}, defaulting to free plan checks`);
                return this.checkFeatureWithDefaultValue(featureKey);
            }
            // Find the feature in the user's plan
            const planFeature = subscription.plan_config.features.find(f => f.feature_key === featureKey);
            if (!planFeature) {
                // Feature not defined in plan, default to false for boolean, 0 for number, etc.
                return this.checkFeatureWithDefaultValue(featureKey);
            }
            // Get the feature definition to determine type
            const featureDef = (0, plan_features_1.getPlanFeature)(featureKey);
            if (!featureDef) {
                logger_1.logger.warn(`Unknown feature key: ${featureKey}`);
                return this.checkFeatureWithDefaultValue(featureKey);
            }
            // Process based on feature type
            switch (featureDef.type) {
                case 'boolean':
                    // For boolean features, check if the value is 'true'
                    return {
                        hasAccess: planFeature.feature_value.toLowerCase() === 'true'
                    };
                case 'number':
                    // For numeric features, check limits
                    const limit = parseInt(planFeature.feature_value, 10);
                    if (isNaN(limit)) {
                        logger_1.logger.error(`Invalid numeric value for feature ${featureKey}: ${planFeature.feature_value}`);
                        return this.checkFeatureWithDefaultValue(featureKey);
                    }
                    // For certain features, we need to check current usage against the limit
                    if (['max_mailboxes', 'max_ai_classifications_per_month', 'max_storage_mb'].includes(featureKey)) {
                        const currentValue = await this.getCurrentUsageValue(userId, featureKey);
                        return {
                            hasAccess: currentValue < limit,
                            limit,
                            currentValue
                        };
                    }
                    // For other numeric features, just check the limit
                    return {
                        hasAccess: limit > 0,
                        limit
                    };
                case 'string':
                    // For string features, check if non-empty
                    return {
                        hasAccess: planFeature.feature_value.trim().length > 0
                    };
                case 'array':
                    // For array features, check if non-empty
                    return {
                        hasAccess: planFeature.feature_value.trim().length > 0
                    };
                default:
                    return this.checkFeatureWithDefaultValue(featureKey);
            }
        }
        catch (error) {
            logger_1.logger.error(`Failed to check feature access for user ${userId}, feature ${featureKey}:`, error);
            throw error;
        }
    }
    /**
     * Gets the limit for a specific feature for a user
     */
    async getFeatureLimit(userId, featureKey) {
        try {
            // Get the user's current subscription
            const subscription = await prisma_1.prisma.subscription.findUnique({
                where: { user_id: userId },
                include: {
                    plan_config: {
                        include: {
                            features: true
                        }
                    }
                }
            });
            if (!subscription || !subscription.plan_config) {
                // If no subscription found, return default value
                const featureDef = (0, plan_features_1.getPlanFeature)(featureKey);
                if (featureDef && featureDef.type === 'number') {
                    return featureDef.defaultValue;
                }
                return null;
            }
            // Find the feature in the user's plan
            const planFeature = subscription.plan_config.features.find(f => f.feature_key === featureKey);
            if (!planFeature) {
                // Feature not defined in plan, return default
                const featureDef = (0, plan_features_1.getPlanFeature)(featureKey);
                if (featureDef && featureDef.type === 'number') {
                    return featureDef.defaultValue;
                }
                return null;
            }
            // Get the feature definition to determine type
            const featureDef = (0, plan_features_1.getPlanFeature)(featureKey);
            if (!featureDef || featureDef.type !== 'number') {
                return null;
            }
            const limit = parseInt(planFeature.feature_value, 10);
            if (isNaN(limit)) {
                logger_1.logger.error(`Invalid numeric value for feature ${featureKey}: ${planFeature.feature_value}`);
                return null;
            }
            return limit;
        }
        catch (error) {
            logger_1.logger.error(`Failed to get feature limit for user ${userId}, feature ${featureKey}:`, error);
            throw error;
        }
    }
    /**
     * Gets upgrade information for a user
     */
    async getUpgradeInfo(userId, targetPlanName) {
        try {
            // Get the user's current subscription
            const currentSubscription = await prisma_1.prisma.subscription.findUnique({
                where: { user_id: userId },
                include: {
                    plan_config: {
                        include: {
                            features: true
                        }
                    }
                }
            });
            // Get the target plan
            const targetPlan = await prisma_1.prisma.subscriptionPlanConfig.findUnique({
                where: { name: targetPlanName },
                include: {
                    features: true
                }
            });
            if (!currentSubscription || !currentSubscription.plan_config || !targetPlan) {
                throw new Error('Current subscription or target plan not found');
            }
            // Compare features between current and target plans
            const currentFeatures = new Set(currentSubscription.plan_config.features.map(f => f.feature_key));
            const targetFeatures = new Set(targetPlan.features.map(f => f.feature_key));
            // Find features that would be gained
            const featuresGained = [...targetFeatures].filter(feature => !currentFeatures.has(feature));
            // If upgrading (not downgrading), featuresLost is not applicable
            // If downgrading, we'd find features that would be lost
            const isDowngrade = await this.isDowngrade(currentSubscription.plan_config.name, targetPlan.name);
            const featuresLost = isDowngrade
                ? [...currentFeatures].filter(feature => !targetFeatures.has(feature))
                : undefined;
            return {
                canUpgrade: true, // In a real implementation, you might have additional checks
                currentPlanName: currentSubscription.plan_config.name,
                targetPlanName: targetPlan.name,
                featuresGained,
                featuresLost
            };
        }
        catch (error) {
            logger_1.logger.error(`Failed to get upgrade info for user ${userId}, target plan ${targetPlanName}:`, error);
            throw error;
        }
    }
    /**
     * Helper: Checks if the plan change is a downgrade
     */
    async isDowngrade(currentPlanName, targetPlanName) {
        // For simplicity, we'll assume plans are ordered: free -> starter -> growth -> business
        const planOrder = ['free', 'starter', 'growth', 'business'];
        const currentPlanIndex = planOrder.indexOf(currentPlanName);
        const targetPlanIndex = planOrder.indexOf(targetPlanName);
        if (currentPlanIndex === -1 || targetPlanIndex === -1) {
            logger_1.logger.warn(`Unknown plan names: current=${currentPlanName}, target=${targetPlanName}`);
            return false; // Default to not a downgrade if plan name is unknown
        }
        return targetPlanIndex < currentPlanIndex;
    }
    /**
     * Helper: Gets current usage value for a limit-based feature
     */
    async getCurrentUsageValue(userId, featureKey) {
        switch (featureKey) {
            case 'max_mailboxes':
                return await prisma_1.prisma.mailbox.count({
                    where: { user_id: userId }
                });
            case 'max_ai_classifications_per_month':
                // Get current billing period
                const subscription = await prisma_1.prisma.subscription.findUnique({
                    where: { user_id: userId },
                    select: { current_period_start: true, current_period_end: true }
                });
                if (!subscription) {
                    return 0;
                }
                // Count AI classifications in the current period
                const usage = await prisma_1.prisma.usageTracking.findFirst({
                    where: {
                        user_id: userId,
                        period_start: { gte: subscription.current_period_start },
                        period_end: { lte: subscription.current_period_end }
                    }
                });
                return usage?.ai_classifications || 0;
            case 'max_storage_mb':
                // This would require integration with storage tracking
                // For now, return 0
                return 0;
            default:
                return 0;
        }
    }
    /**
     * Helper: Check feature access with default value
     */
    checkFeatureWithDefaultValue(featureKey) {
        const featureDef = (0, plan_features_1.getPlanFeature)(featureKey);
        if (!featureDef) {
            logger_1.logger.warn(`Unknown feature key: ${featureKey}`);
            return { hasAccess: false };
        }
        switch (featureDef.type) {
            case 'boolean':
                return { hasAccess: featureDef.defaultValue };
            case 'number':
                const limit = featureDef.defaultValue;
                return {
                    hasAccess: limit > 0,
                    limit
                };
            case 'string':
            case 'array':
                return { hasAccess: featureDef.defaultValue.trim().length > 0 };
            default:
                return { hasAccess: false };
        }
    }
}
exports.PlanService = PlanService;
// Export a singleton instance of the plan service
exports.planService = new PlanService();
