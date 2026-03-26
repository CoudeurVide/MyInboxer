"use strict";
/**
 * Email Notification Settings Routes
 * Configure when and how often emails are sent
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.notificationSettingsRoutes = void 0;
const notificationSettingsService = __importStar(require("../../services/email-notification-settings.service"));
const admin_middleware_1 = require("../../middleware/admin.middleware");
const notificationSettingsRoutes = async (app) => {
    /**
     * Get all notification settings
     * GET /api/admin/notification-settings
     */
    app.get('/', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const settings = await notificationSettingsService.getAllNotificationSettings();
            return reply.status(200).send({
                success: true,
                data: { settings },
            });
        }
        catch (error) {
            app.log.error(`Get notification settings error: ${error?.message || error}`);
            return reply.status(500).send({
                success: false,
                error: 'Failed to fetch notification settings',
            });
        }
    });
    /**
     * Get notification settings for a specific template
     * GET /api/admin/notification-settings/:templateKey
     */
    app.get('/:templateKey', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const { templateKey } = request.params;
            const settings = await notificationSettingsService.getNotificationSettings(templateKey);
            if (!settings) {
                return reply.status(404).send({
                    success: false,
                    error: 'Settings not found for this template',
                });
            }
            return reply.status(200).send({
                success: true,
                data: { settings },
            });
        }
        catch (error) {
            app.log.error(`Get notification settings error: ${error?.message || error}`);
            return reply.status(500).send({
                success: false,
                error: 'Failed to fetch notification settings',
            });
        }
    });
    /**
     * Update notification settings for a template
     * PATCH /api/admin/notification-settings/:templateKey
     */
    app.patch('/:templateKey', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const { templateKey } = request.params;
            const body = request.body;
            const settings = await notificationSettingsService.updateNotificationSettings(templateKey, {
                notification_mode: body.notification_mode,
                batch_interval_minutes: body.batch_interval_minutes,
                digest_time: body.digest_time,
                cooldown_minutes: body.cooldown_minutes,
                max_emails_per_day: body.max_emails_per_day,
                min_items_threshold: body.min_items_threshold,
            });
            if (!settings) {
                return reply.status(404).send({
                    success: false,
                    error: 'Settings not found for this template',
                });
            }
            return reply.status(200).send({
                success: true,
                data: {
                    settings,
                    message: 'Notification settings updated successfully',
                },
            });
        }
        catch (error) {
            app.log.error(`Update notification settings error: ${error?.message || error}`);
            return reply.status(500).send({
                success: false,
                error: 'Failed to update notification settings',
            });
        }
    });
    /**
     * Get current email stats for a template
     * GET /api/admin/notification-settings/:templateKey/stats
     */
    app.get('/:templateKey/stats', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const { templateKey } = request.params;
            const stats = notificationSettingsService.getEmailStats(templateKey);
            return reply.status(200).send({
                success: true,
                data: { stats },
            });
        }
        catch (error) {
            app.log.error(`Get email stats error: ${error?.message || error}`);
            return reply.status(500).send({
                success: false,
                error: 'Failed to fetch email stats',
            });
        }
    });
};
exports.notificationSettingsRoutes = notificationSettingsRoutes;
