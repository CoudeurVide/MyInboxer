"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminSettingsRoutes = adminSettingsRoutes;
const zod_1 = require("zod");
const prisma_1 = require("../../lib/prisma");
const admin_middleware_1 = require("../../middleware/admin.middleware");
const cron_service_1 = require("../../services/cron.service");
const UpdateSettingsSchema = zod_1.z.object({
    ai_provider: zod_1.z.enum(['openai', 'mistral', 'none']).optional(),
    openai_api_key: zod_1.z.string().optional(),
    mistral_api_key: zod_1.z.string().optional(),
    enable_pre_filter: zod_1.z.boolean().optional(),
    unsubscriber_enabled: zod_1.z.boolean().optional(),
    unsubscriber_timeout: zod_1.z.number().min(5000).max(120000).optional(),
    ml_min_corrections_for_retrain: zod_1.z.number().min(50).max(2000).optional(),
    ml_retrain_interval_hours: zod_1.z.number().min(1).max(168).optional(),
    ml_min_accuracy_improvement: zod_1.z.number().min(0.005).max(0.1).optional(),
    auto_move_suggestion_threshold: zod_1.z.number().min(5).max(100).optional(),
    auto_move_suggestion_enabled: zod_1.z.boolean().optional(),
    default_scan_frequency_minutes: zod_1.z.number().min(15).max(1440).optional(), // 15 min to 24 hours
});
async function adminSettingsRoutes(fastify) {
    // Get system settings
    fastify.get('/settings', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            // Get or create settings
            let settings = await prisma_1.prisma.systemSettings.findFirst();
            if (!settings) {
                // Create default settings with API keys from environment variables
                settings = await prisma_1.prisma.systemSettings.create({
                    data: {
                        ai_provider: 'openai',
                        openai_api_key: process.env.OPENAI_API_KEY || null,
                        mistral_api_key: process.env.MISTRAL_API_KEY || null,
                        unsubscriber_enabled: true,
                        unsubscriber_timeout: 30000,
                    },
                });
            }
            // Check if API keys are configured (from DB or environment)
            const hasOpenAIKey = !!settings.openai_api_key || !!process.env.OPENAI_API_KEY;
            const hasMistralKey = !!settings.mistral_api_key || !!process.env.MISTRAL_API_KEY;
            // Don't return API keys in response (security)
            const response = {
                id: settings.id,
                ai_provider: settings.ai_provider,
                enable_pre_filter: settings.enable_pre_filter,
                unsubscriber_enabled: settings.unsubscriber_enabled,
                unsubscriber_timeout: settings.unsubscriber_timeout,
                ml_min_corrections_for_retrain: settings.ml_min_corrections_for_retrain,
                ml_retrain_interval_hours: settings.ml_retrain_interval_hours,
                ml_min_accuracy_improvement: settings.ml_min_accuracy_improvement,
                auto_move_suggestion_threshold: settings.auto_move_suggestion_threshold,
                auto_move_suggestion_enabled: settings.auto_move_suggestion_enabled,
                default_scan_frequency_minutes: settings.default_scan_frequency_minutes,
                has_openai_key: hasOpenAIKey,
                has_mistral_key: hasMistralKey,
                created_at: settings.created_at,
                updated_at: settings.updated_at,
            };
            return reply.status(200).send({
                success: true,
                data: response,
            });
        }
        catch (error) {
            request.log.error(error);
            return reply.status(500).send({
                success: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: 'Failed to fetch settings',
                },
            });
        }
    });
    // Update system settings
    fastify.patch('/settings', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const validation = UpdateSettingsSchema.safeParse(request.body);
            if (!validation.success) {
                return reply.status(400).send({
                    success: false,
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'Invalid request data',
                        details: validation.error.errors,
                    },
                });
            }
            const updates = validation.data;
            // Get or create settings
            let settings = await prisma_1.prisma.systemSettings.findFirst();
            // Track if scan frequency changed
            const previousScanFrequency = settings?.default_scan_frequency_minutes;
            if (!settings) {
                // Create with updates
                settings = await prisma_1.prisma.systemSettings.create({
                    data: {
                        ai_provider: updates.ai_provider || 'openai',
                        openai_api_key: updates.openai_api_key,
                        mistral_api_key: updates.mistral_api_key,
                        unsubscriber_enabled: updates.unsubscriber_enabled ?? true,
                        unsubscriber_timeout: updates.unsubscriber_timeout ?? 30000,
                        default_scan_frequency_minutes: updates.default_scan_frequency_minutes ?? 60,
                    },
                });
            }
            else {
                // Update existing
                settings = await prisma_1.prisma.systemSettings.update({
                    where: { id: settings.id },
                    data: updates,
                });
            }
            // Restart scan cron jobs if frequency changed
            if (updates.default_scan_frequency_minutes !== undefined &&
                updates.default_scan_frequency_minutes !== previousScanFrequency) {
                try {
                    await (0, cron_service_1.restartScanCronJobs)();
                    request.log.info(`Scan frequency changed from ${previousScanFrequency} to ${updates.default_scan_frequency_minutes} minutes. Cron jobs restarted.`);
                }
                catch (cronError) {
                    request.log.error('Failed to restart scan cron jobs:', cronError);
                    // Don't fail the request, just log the error
                }
            }
            // Don't return API keys in response
            const response = {
                id: settings.id,
                ai_provider: settings.ai_provider,
                enable_pre_filter: settings.enable_pre_filter,
                unsubscriber_enabled: settings.unsubscriber_enabled,
                unsubscriber_timeout: settings.unsubscriber_timeout,
                ml_min_corrections_for_retrain: settings.ml_min_corrections_for_retrain,
                ml_retrain_interval_hours: settings.ml_retrain_interval_hours,
                ml_min_accuracy_improvement: settings.ml_min_accuracy_improvement,
                auto_move_suggestion_threshold: settings.auto_move_suggestion_threshold,
                auto_move_suggestion_enabled: settings.auto_move_suggestion_enabled,
                default_scan_frequency_minutes: settings.default_scan_frequency_minutes,
                has_openai_key: !!settings.openai_api_key || !!process.env.OPENAI_API_KEY,
                has_mistral_key: !!settings.mistral_api_key || !!process.env.MISTRAL_API_KEY,
                created_at: settings.created_at,
                updated_at: settings.updated_at,
            };
            return reply.status(200).send({
                success: true,
                data: response,
                message: 'Settings updated successfully',
            });
        }
        catch (error) {
            request.log.error(error);
            return reply.status(500).send({
                success: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: 'Failed to update settings',
                },
            });
        }
    });
    // Get AI provider configuration (for backend to pass to unsubscriber service)
    fastify.get('/settings/ai-provider', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const settings = await prisma_1.prisma.systemSettings.findFirst();
            if (!settings) {
                return reply.status(200).send({
                    success: true,
                    data: {
                        ai_provider: 'openai', // Default
                    },
                });
            }
            return reply.status(200).send({
                success: true,
                data: {
                    ai_provider: settings.ai_provider,
                },
            });
        }
        catch (error) {
            request.log.error(error);
            return reply.status(500).send({
                success: false,
                error: {
                    code: 'INTERNAL_ERROR',
                    message: 'Failed to fetch AI provider',
                },
            });
        }
    });
}
