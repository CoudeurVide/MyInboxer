"use strict";
/**
 * Classification Settings Routes
 * GET /api/classification/settings - Get current classification settings
 * PUT /api/classification/settings - Update classification settings
 * POST /api/classification/settings/reset - Reset to defaults
 * POST /api/classification/settings/test - Test classification with current settings
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.classificationRoutes = void 0;
const prisma_1 = require("../../lib/prisma");
const classifier_service_1 = require("../../services/classifier.service");
const reputation_service_1 = require("../../services/reputation.service");
// Default settings values (matching Prisma schema field names)
const DEFAULT_SETTINGS = {
    not_spam_high_value_weight: 2,
    not_spam_medium_value_weight: 1,
    spam_high_value_weight: 3,
    spam_medium_value_weight: 1,
    promo_weight: 2,
    personalization_weight: 2,
    free_domain_penalty: -1,
    corporate_domain_bonus: 2,
    suspicious_domain_penalty: -3,
    short_domain_penalty: -1,
    not_spam_min_score: 4,
    not_spam_max_spam_score: 6,
    not_spam_high_priority_score: 6,
    spam_min_score: 5,
    spam_max_not_spam_score: 3,
    promo_min_score: 4,
    moderate_not_spam_min_score: 3,
    moderate_not_spam_max_spam: 2,
    not_spam_base_confidence: 0.55,
    not_spam_confidence_multiplier: 0.07,
    spam_base_confidence: 0.60,
    spam_confidence_multiplier: 0.08,
    promo_base_confidence: 0.55,
    promo_confidence_multiplier: 0.08,
    ai_confidence_threshold: 0.55,
    enable_ai_classification: true,
    classification_prompt: null, // null = use default prompt from ai-classifier.service.ts
    enable_email_authentication: true,
    enable_url_analysis: true,
    enable_contact_history: true,
    enable_thread_analysis: true,
    auth_trust_weight: 1.0,
    url_trust_weight: 1.0,
    contact_trust_weight: 1.0,
    spam_mark_to_block: 1,
    legit_mark_to_trust: 3,
};
const classificationRoutes = async (app) => {
    /**
     * Get classification settings (Application-level, accessible by all authenticated users)
     * GET /api/classification/settings
     */
    app.get('/settings', {
        onRequest: [app.authenticate],
        handler: async (request, reply) => {
            try {
                const userId = request.user?.userId;
                if (!userId) {
                    return reply.status(401).send({
                        success: false,
                        error: 'Authentication required',
                    });
                }
                // Get the latest system-wide settings (application-level, not user-specific)
                let settings = await prisma_1.prisma.classificationSettings.findFirst({
                    orderBy: { updated_at: 'desc' },
                });
                // If no settings exist, create with defaults
                if (!settings) {
                    settings = await prisma_1.prisma.classificationSettings.create({
                        data: {
                            user_id: userId, // Legacy field, will be ignored in queries
                            ...DEFAULT_SETTINGS,
                        },
                    });
                }
                return reply.send({
                    success: true,
                    data: settings,
                });
            }
            catch (error) {
                app.log.error('Get classification settings error:', error);
                return reply.status(500).send({
                    success: false,
                    error: 'Failed to get classification settings',
                });
            }
        },
    });
    /**
     * Update classification settings (Admin only - affects all users)
     * PUT /api/classification/settings
     */
    app.put('/settings', {
        onRequest: [app.authenticate],
        handler: async (request, reply) => {
            try {
                const userId = request.user?.userId;
                if (!userId) {
                    return reply.status(401).send({
                        success: false,
                        error: 'Authentication required',
                    });
                }
                // Check if user is admin
                const user = await prisma_1.prisma.user.findUnique({
                    where: { id: userId },
                    select: { role: true },
                });
                if (!user || (user.role !== 'admin' && user.role !== 'owner')) {
                    return reply.status(403).send({
                        success: false,
                        error: {
                            code: 'FORBIDDEN',
                            message: 'Admin access required to modify system settings',
                        },
                    });
                }
                const body = request.body;
                // Validate that only known fields are being updated
                const validFields = Object.keys(DEFAULT_SETTINGS);
                const updateData = {};
                for (const field of validFields) {
                    if (field in body) {
                        updateData[field] = body[field];
                    }
                }
                // Upsert settings (application-level - we use the admin's user_id as the settings owner)
                // Since user_id has a unique constraint, we update existing or create new
                const settings = await prisma_1.prisma.classificationSettings.upsert({
                    where: { user_id: userId },
                    create: {
                        user_id: userId,
                        ...DEFAULT_SETTINGS,
                        ...updateData,
                    },
                    update: updateData,
                });
                app.log.info(`Admin ${userId} updated classification settings`);
                // Invalidate reputation threshold cache so new values take effect immediately
                (0, reputation_service_1.invalidateReputationThresholdCache)();
                return reply.send({
                    success: true,
                    data: settings,
                    message: 'Classification settings updated successfully (affects all users)',
                });
            }
            catch (error) {
                app.log.error('Update classification settings error:', error);
                return reply.status(500).send({
                    success: false,
                    error: 'Failed to update classification settings',
                });
            }
        },
    });
    /**
     * Reset classification settings to defaults (Admin only)
     * POST /api/classification/settings/reset
     */
    app.post('/settings/reset', {
        onRequest: [app.authenticate],
        handler: async (request, reply) => {
            try {
                const userId = request.user?.userId;
                if (!userId) {
                    return reply.status(401).send({
                        success: false,
                        error: 'Authentication required',
                    });
                }
                // Check if user is admin
                const user = await prisma_1.prisma.user.findUnique({
                    where: { id: userId },
                    select: { role: true },
                });
                if (!user || (user.role !== 'admin' && user.role !== 'owner')) {
                    return reply.status(403).send({
                        success: false,
                        error: {
                            code: 'FORBIDDEN',
                            message: 'Admin access required to reset system settings',
                        },
                    });
                }
                // Upsert settings with defaults (application-level)
                const settings = await prisma_1.prisma.classificationSettings.upsert({
                    where: { user_id: userId },
                    create: {
                        user_id: userId,
                        ...DEFAULT_SETTINGS,
                    },
                    update: DEFAULT_SETTINGS,
                });
                app.log.info(`Admin ${userId} reset classification settings to defaults`);
                return reply.send({
                    success: true,
                    data: settings,
                    message: 'Classification settings reset to defaults (affects all users)',
                });
            }
            catch (error) {
                app.log.error('Reset classification settings error:', error);
                return reply.status(500).send({
                    success: false,
                    error: 'Failed to reset classification settings',
                });
            }
        },
    });
    /**
     * Test classification with sample email
     * POST /api/classification/settings/test
     * Body: { subject: string, body: string, from: string }
     */
    app.post('/settings/test', {
        onRequest: [app.authenticate],
        handler: async (request, reply) => {
            try {
                const userId = request.user?.userId;
                if (!userId) {
                    return reply.status(401).send({
                        success: false,
                        error: 'Authentication required',
                    });
                }
                const { subject, body, from } = request.body;
                if (!subject || !body || !from) {
                    return reply.status(400).send({
                        success: false,
                        error: 'Subject, body, and from fields are required',
                    });
                }
                // Get the latest system settings (application-level)
                let settings = await prisma_1.prisma.classificationSettings.findFirst({
                    orderBy: { updated_at: 'desc' },
                });
                // Use defaults if no settings exist
                if (!settings) {
                    settings = await prisma_1.prisma.classificationSettings.create({
                        data: {
                            user_id: userId,
                            ...DEFAULT_SETTINGS,
                        },
                    });
                }
                // Parse email
                const parsedEmail = {
                    subject,
                    bodyText: body,
                    bodyHtml: null,
                    from,
                    fromEmail: from,
                    to: 'test@example.com',
                    date: new Date(),
                };
                // Classify with current system settings + user preferences
                const result = await (0, classifier_service_1.classifyEmailWithSettings)(parsedEmail, settings, userId);
                return reply.send({
                    success: true,
                    data: result,
                });
            }
            catch (error) {
                app.log.error('Test classification error:', error);
                return reply.status(500).send({
                    success: false,
                    error: 'Failed to test classification',
                });
            }
        },
    });
};
exports.classificationRoutes = classificationRoutes;
