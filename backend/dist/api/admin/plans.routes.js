"use strict";
/**
 * Admin Plans Routes for SpamRescue
 * Handles admin operations for subscription plans and features
 */
Object.defineProperty(exports, "__esModule", { value: true });
const zod_1 = require("zod");
const prisma_1 = require("../../lib/prisma");
const plan_features_1 = require("../../lib/plan-features");
const admin_middleware_1 = require("../../middleware/admin.middleware");
// Validation schemas
const CreatePlanSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(50),
    displayName: zod_1.z.string().min(1).max(100),
    description: zod_1.z.string().optional(),
    priceMonthly: zod_1.z.number().int().min(0), // in cents
    priceYearly: zod_1.z.number().int().min(0).nullable().optional(), // in cents - accepts null or undefined
    stripePriceIdMonthly: zod_1.z.string().optional(),
    stripePriceIdYearly: zod_1.z.string().optional(),
    isActive: zod_1.z.boolean().optional().default(true),
    sortOrder: zod_1.z.number().int().optional().default(0),
    features: zod_1.z.array(zod_1.z.object({
        key: zod_1.z.string(),
        value: zod_1.z.string(),
        type: zod_1.z.enum(['number', 'boolean', 'string', 'array']),
    })).optional(),
});
const UpdatePlanSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(50).optional(),
    displayName: zod_1.z.string().min(1).max(100).optional(),
    description: zod_1.z.string().optional(),
    priceMonthly: zod_1.z.number().int().min(0).optional(), // in cents
    priceYearly: zod_1.z.number().int().min(0).nullable().optional(), // in cents - accepts null or undefined
    stripePriceIdMonthly: zod_1.z.string().optional(),
    stripePriceIdYearly: zod_1.z.string().optional(),
    isActive: zod_1.z.boolean().optional(),
    sortOrder: zod_1.z.number().int().optional(),
    features: zod_1.z.array(zod_1.z.object({
        key: zod_1.z.string(),
        value: zod_1.z.string(),
        type: zod_1.z.enum(['number', 'boolean', 'string', 'array']),
    })).optional(),
});
const GetPlansSchema = zod_1.z.object({
    activeOnly: zod_1.z.boolean().optional().default(false),
});
const CreateFeatureSchema = zod_1.z.object({
    key: zod_1.z.string(),
    value: zod_1.z.string(),
    type: zod_1.z.enum(['number', 'boolean', 'string', 'array']),
});
const UpdateFeatureSchema = zod_1.z.object({
    value: zod_1.z.string(),
    type: zod_1.z.enum(['number', 'boolean', 'string', 'array']).optional(),
});
const adminPlansRoutes = async (fastify) => {
    /**
     * GET /api/admin/plans
     * Get all subscription plans (admin only)
     */
    fastify.get('/plans', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const { activeOnly } = GetPlansSchema.parse(request.query);
            const plans = await prisma_1.prisma.subscriptionPlanConfig.findMany({
                where: activeOnly ? { is_active: true } : {},
                include: { features: true },
                orderBy: { sort_order: 'asc' }
            });
            return reply.send({
                success: true,
                data: {
                    plans: plans.map(plan => ({
                        id: plan.id,
                        name: plan.name,
                        displayName: plan.display_name,
                        description: plan.description || undefined,
                        priceMonthly: plan.price_monthly,
                        priceYearly: plan.price_yearly || undefined,
                        stripePriceIdMonthly: plan.stripe_price_id_monthly || undefined,
                        stripePriceIdYearly: plan.stripe_price_id_yearly || undefined,
                        isActive: plan.is_active,
                        sortOrder: plan.sort_order,
                        features: plan.features.map(f => ({
                            id: f.id,
                            key: f.feature_key,
                            value: f.feature_value,
                            type: f.feature_type,
                        })),
                        createdAt: plan.created_at,
                        updatedAt: plan.updated_at,
                    })),
                },
            });
        }
        catch (error) {
            request.log.error('Error getting plans:', error?.message || String(error));
            if (error instanceof zod_1.z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid query parameters',
                    details: error.errors,
                });
            }
            return reply.status(500).send({
                success: false,
                error: 'Failed to get plans',
            });
        }
    });
    /**
     * GET /api/admin/plans/:planId
     * Get a specific subscription plan by ID
     */
    fastify.get('/plans/:planId', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const { planId } = request.params;
            const plan = await prisma_1.prisma.subscriptionPlanConfig.findUnique({
                where: { id: planId },
                include: { features: true }
            });
            if (!plan) {
                return reply.status(404).send({
                    success: false,
                    error: 'Plan not found',
                });
            }
            return reply.send({
                success: true,
                data: {
                    id: plan.id,
                    name: plan.name,
                    displayName: plan.display_name,
                    description: plan.description || undefined,
                    priceMonthly: plan.price_monthly,
                    priceYearly: plan.price_yearly || undefined,
                    stripePriceIdMonthly: plan.stripe_price_id_monthly || undefined,
                    stripePriceIdYearly: plan.stripe_price_id_yearly || undefined,
                    isActive: plan.is_active,
                    sortOrder: plan.sort_order,
                    features: plan.features.map(f => ({
                        id: f.id,
                        key: f.feature_key,
                        value: f.feature_value,
                        type: f.feature_type,
                    })),
                    createdAt: plan.created_at,
                    updatedAt: plan.updated_at,
                },
            });
        }
        catch (error) {
            request.log.error('Error getting plan:', error?.message || String(error));
            return reply.status(500).send({
                success: false,
                error: 'Failed to get plan',
            });
        }
    });
    /**
     * POST /api/admin/plans
     * Create a new subscription plan
     */
    fastify.post('/plans', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const planData = CreatePlanSchema.parse(request.body);
            // Check if a plan with this name already exists
            const existingPlan = await prisma_1.prisma.subscriptionPlanConfig.findUnique({
                where: { name: planData.name }
            });
            if (existingPlan) {
                return reply.status(400).send({
                    success: false,
                    error: 'A plan with this name already exists',
                });
            }
            // Create the new plan
            const newPlan = await prisma_1.prisma.subscriptionPlanConfig.create({
                data: {
                    name: planData.name,
                    display_name: planData.displayName,
                    description: planData.description,
                    price_monthly: planData.priceMonthly,
                    price_yearly: planData.priceYearly,
                    stripe_price_id_monthly: planData.stripePriceIdMonthly,
                    stripe_price_id_yearly: planData.stripePriceIdYearly,
                    is_active: planData.isActive,
                    sort_order: planData.sortOrder,
                    features: planData.features ? {
                        create: planData.features.map(f => ({
                            feature_key: f.key,
                            feature_value: f.value,
                            feature_type: f.type,
                        }))
                    } : undefined,
                },
                include: { features: true }
            });
            return reply.status(201).send({
                success: true,
                message: 'Plan created successfully',
                data: {
                    id: newPlan.id,
                    name: newPlan.name,
                    displayName: newPlan.display_name,
                    description: newPlan.description || undefined,
                    priceMonthly: newPlan.price_monthly,
                    priceYearly: newPlan.price_yearly || undefined,
                    stripePriceIdMonthly: newPlan.stripe_price_id_monthly || undefined,
                    stripePriceIdYearly: newPlan.stripe_price_id_yearly || undefined,
                    isActive: newPlan.is_active,
                    sortOrder: newPlan.sort_order,
                    features: newPlan.features.map(f => ({
                        id: f.id,
                        key: f.feature_key,
                        value: f.feature_value,
                        type: f.feature_type,
                    })),
                    createdAt: newPlan.created_at,
                    updatedAt: newPlan.updated_at,
                },
            });
        }
        catch (error) {
            request.log.error('Error creating plan:', error?.message || String(error));
            if (error instanceof zod_1.z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid request body',
                    details: error.errors,
                });
            }
            return reply.status(500).send({
                success: false,
                error: 'Failed to create plan',
            });
        }
    });
    /**
     * PUT /api/admin/plans/:planId
     * Update an existing subscription plan
     */
    fastify.put('/plans/:planId', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const { planId } = request.params;
            const updateData = UpdatePlanSchema.parse(request.body);
            // Check if the plan exists
            const existingPlan = await prisma_1.prisma.subscriptionPlanConfig.findUnique({
                where: { id: planId },
                include: { features: true }
            });
            if (!existingPlan) {
                return reply.status(404).send({
                    success: false,
                    error: 'Plan not found',
                });
            }
            // Build update data - only include defined fields
            const updateFields = { updated_at: new Date() };
            if (updateData.name !== undefined)
                updateFields.name = updateData.name;
            if (updateData.displayName !== undefined)
                updateFields.display_name = updateData.displayName;
            if (updateData.description !== undefined)
                updateFields.description = updateData.description;
            if (updateData.priceMonthly !== undefined)
                updateFields.price_monthly = updateData.priceMonthly;
            if (updateData.priceYearly !== undefined)
                updateFields.price_yearly = updateData.priceYearly;
            if (updateData.stripePriceIdMonthly !== undefined)
                updateFields.stripe_price_id_monthly = updateData.stripePriceIdMonthly;
            if (updateData.stripePriceIdYearly !== undefined)
                updateFields.stripe_price_id_yearly = updateData.stripePriceIdYearly;
            if (updateData.isActive !== undefined)
                updateFields.is_active = updateData.isActive;
            if (updateData.sortOrder !== undefined)
                updateFields.sort_order = updateData.sortOrder;
            // Update the plan
            const updatedPlan = await prisma_1.prisma.subscriptionPlanConfig.update({
                where: { id: planId },
                data: updateFields,
                include: { features: true }
            });
            // If features were included in the update, update them as well
            if (updateData.features) {
                // Delete existing features
                await prisma_1.prisma.planFeature.deleteMany({
                    where: { plan_id: planId }
                });
                // Create new features
                for (const feature of updateData.features) {
                    await prisma_1.prisma.planFeature.create({
                        data: {
                            plan_id: planId,
                            feature_key: feature.key,
                            feature_value: feature.value,
                            feature_type: feature.type,
                        }
                    });
                }
                // Re-fetch the plan with updated features
                const planWithFeatures = await prisma_1.prisma.subscriptionPlanConfig.findUnique({
                    where: { id: planId },
                    include: { features: true }
                });
                if (planWithFeatures) {
                    return reply.send({
                        success: true,
                        message: 'Plan updated successfully',
                        data: {
                            id: planWithFeatures.id,
                            name: planWithFeatures.name,
                            displayName: planWithFeatures.display_name,
                            description: planWithFeatures.description || undefined,
                            priceMonthly: planWithFeatures.price_monthly,
                            priceYearly: planWithFeatures.price_yearly || undefined,
                            stripePriceIdMonthly: planWithFeatures.stripe_price_id_monthly || undefined,
                            stripePriceIdYearly: planWithFeatures.stripe_price_id_yearly || undefined,
                            isActive: planWithFeatures.is_active,
                            sortOrder: planWithFeatures.sort_order,
                            features: planWithFeatures.features.map(f => ({
                                id: f.id,
                                key: f.feature_key,
                                value: f.feature_value,
                                type: f.feature_type,
                            })),
                            createdAt: planWithFeatures.created_at,
                            updatedAt: planWithFeatures.updated_at,
                        },
                    });
                }
            }
            return reply.send({
                success: true,
                message: 'Plan updated successfully',
                data: {
                    id: updatedPlan.id,
                    name: updatedPlan.name,
                    displayName: updatedPlan.display_name,
                    description: updatedPlan.description || undefined,
                    priceMonthly: updatedPlan.price_monthly,
                    priceYearly: updatedPlan.price_yearly || undefined,
                    stripePriceIdMonthly: updatedPlan.stripe_price_id_monthly || undefined,
                    stripePriceIdYearly: updatedPlan.stripe_price_id_yearly || undefined,
                    isActive: updatedPlan.is_active,
                    sortOrder: updatedPlan.sort_order,
                    features: updatedPlan.features.map(f => ({
                        id: f.id,
                        key: f.feature_key,
                        value: f.feature_value,
                        type: f.feature_type,
                    })),
                    createdAt: updatedPlan.created_at,
                    updatedAt: updatedPlan.updated_at,
                },
            });
        }
        catch (error) {
            request.log.error('Error updating plan:', error?.message || String(error));
            if (error instanceof zod_1.z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid request body',
                    details: error.errors,
                });
            }
            return reply.status(500).send({
                success: false,
                error: 'Failed to update plan',
            });
        }
    });
    /**
     * DELETE /api/admin/plans/:planId
     * Delete a subscription plan
     */
    fastify.delete('/plans/:planId', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const { planId } = request.params;
            // Check if any users are currently on this plan
            // First get the plan name from the config
            const planConfig = await prisma_1.prisma.subscriptionPlanConfig.findUnique({
                where: { id: planId },
                select: { name: true }
            });
            if (!planConfig) {
                return reply.status(404).send({
                    success: false,
                    error: 'Plan not found',
                });
            }
            const activeSubscriptions = await prisma_1.prisma.subscription.count({
                where: {
                    plan: planConfig.name // Match the plan enum value
                }
            });
            if (activeSubscriptions > 0) {
                return reply.status(400).send({
                    success: false,
                    error: `Cannot delete plan with ${activeSubscriptions} active subscriptions. Change user plans first.`,
                });
            }
            // Delete the plan (this will also delete associated features due to cascade)
            await prisma_1.prisma.subscriptionPlanConfig.delete({
                where: { id: planId }
            });
            return reply.send({
                success: true,
                message: 'Plan deleted successfully',
            });
        }
        catch (error) {
            request.log.error('Error deleting plan:', error?.message || String(error));
            return reply.status(500).send({
                success: false,
                error: 'Failed to delete plan',
            });
        }
    });
    /**
     * GET /api/admin/plan-features
     * Get all possible plan features with their definitions
     */
    fastify.get('/plan-features', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            return reply.send({
                success: true,
                data: {
                    features: plan_features_1.PLAN_FEATURES
                },
            });
        }
        catch (error) {
            request.log.error('Error getting plan features:', error?.message || String(error));
            return reply.status(500).send({
                success: false,
                error: 'Failed to get plan features',
            });
        }
    });
    /**
     * POST /api/admin/plans/:planId/features
     * Add a feature to a plan
     */
    fastify.post('/plans/:planId/features', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const { planId } = request.params;
            const featureData = CreateFeatureSchema.parse(request.body);
            // Verify the plan exists
            const plan = await prisma_1.prisma.subscriptionPlanConfig.findUnique({
                where: { id: planId }
            });
            if (!plan) {
                return reply.status(404).send({
                    success: false,
                    error: 'Plan not found',
                });
            }
            // Create the feature
            const feature = await prisma_1.prisma.planFeature.create({
                data: {
                    plan_id: planId,
                    feature_key: featureData.key,
                    feature_value: featureData.value,
                    feature_type: featureData.type,
                }
            });
            return reply.status(201).send({
                success: true,
                message: 'Feature added to plan successfully',
                data: {
                    id: feature.id,
                    key: feature.feature_key,
                    value: feature.feature_value,
                    type: feature.feature_type,
                    planId: feature.plan_id,
                    createdAt: feature.created_at,
                },
            });
        }
        catch (error) {
            request.log.error('Error adding feature to plan:', error?.message || String(error));
            if (error instanceof zod_1.z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid request body',
                    details: error.errors,
                });
            }
            return reply.status(500).send({
                success: false,
                error: 'Failed to add feature to plan',
            });
        }
    });
    /**
     * PUT /api/admin/plans/:planId/features/:featureId
     * Update a feature value for a plan
     */
    fastify.put('/plans/:planId/features/:featureId', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const { planId, featureId } = request.params;
            const updateData = UpdateFeatureSchema.parse(request.body);
            // Verify the feature exists and belongs to the plan
            const feature = await prisma_1.prisma.planFeature.findFirst({
                where: {
                    id: featureId,
                    plan_id: planId
                }
            });
            if (!feature) {
                return reply.status(404).send({
                    success: false,
                    error: 'Feature not found for this plan',
                });
            }
            // Update the feature
            const updatedFeature = await prisma_1.prisma.planFeature.update({
                where: { id: featureId },
                data: {
                    feature_value: updateData.value,
                    feature_type: updateData.type || feature.feature_type,
                }
            });
            return reply.send({
                success: true,
                message: 'Feature updated successfully',
                data: {
                    id: updatedFeature.id,
                    key: updatedFeature.feature_key,
                    value: updatedFeature.feature_value,
                    type: updatedFeature.feature_type,
                    planId: updatedFeature.plan_id,
                    createdAt: updatedFeature.created_at,
                },
            });
        }
        catch (error) {
            request.log.error('Error updating feature:', error?.message || String(error));
            if (error instanceof zod_1.z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid request body',
                    details: error.errors,
                });
            }
            return reply.status(500).send({
                success: false,
                error: 'Failed to update feature',
            });
        }
    });
    /**
     * DELETE /api/admin/plans/:planId/features/:featureId
     * Remove a feature from a plan
     */
    fastify.delete('/plans/:planId/features/:featureId', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const { planId, featureId } = request.params;
            // Verify the feature exists and belongs to the plan
            const feature = await prisma_1.prisma.planFeature.findFirst({
                where: {
                    id: featureId,
                    plan_id: planId
                }
            });
            if (!feature) {
                return reply.status(404).send({
                    success: false,
                    error: 'Feature not found for this plan',
                });
            }
            // Delete the feature
            await prisma_1.prisma.planFeature.delete({
                where: { id: featureId }
            });
            return reply.send({
                success: true,
                message: 'Feature removed from plan successfully',
            });
        }
        catch (error) {
            request.log.error('Error removing feature:', error?.message || String(error));
            return reply.status(500).send({
                success: false,
                error: 'Failed to remove feature',
            });
        }
    });
};
exports.default = adminPlansRoutes;
