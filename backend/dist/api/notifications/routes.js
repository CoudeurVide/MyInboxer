"use strict";
/**
 * Notifications API Routes
 * Endpoints for managing and testing notification channels
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
const zod_1 = require("zod");
const crypto = __importStar(require("crypto"));
const prisma_1 = require("../../lib/prisma");
const slack_service_1 = require("../../services/slack.service");
const telegram_service_1 = require("../../services/telegram.service");
const sms_service_1 = require("../../services/sms.service");
const email_service_1 = require("../../services/email.service");
// Helper function to hash verification codes
function hashCode(code) {
    return crypto.createHash('sha256').update(code).digest('hex');
}
// Constants for phone verification
const VERIFICATION_CODE_LENGTH = 6;
const VERIFICATION_CODE_EXPIRY_MINUTES = 10;
const MAX_VERIFICATION_ATTEMPTS = 5;
// Validation schemas
const TestSlackSchema = zod_1.z.object({
    webhookUrl: zod_1.z.string().url(),
});
const TestTelegramSchema = zod_1.z.object({
    chatId: zod_1.z.string(),
});
const SendVerificationSchema = zod_1.z.object({
    phone: zod_1.z.string(),
});
const VerifyPhoneSchema = zod_1.z.object({
    phone: zod_1.z.string(),
    code: zod_1.z.string(),
});
const UpdateSettingsSchema = zod_1.z.object({
    phone: zod_1.z.string().optional(),
    slackWebhookUrl: zod_1.z.string().optional(),
    telegramChatId: zod_1.z.string().optional(),
});
const UpdatePreferencesSchema = zod_1.z.object({
    // Lead notifications
    lead_found_enabled: zod_1.z.boolean().optional(),
    scan_complete_enabled: zod_1.z.boolean().optional(),
    // Billing & Usage
    usage_warning_enabled: zod_1.z.boolean().optional(),
    limit_reached_enabled: zod_1.z.boolean().optional(),
    subscription_confirmed_enabled: zod_1.z.boolean().optional(),
    payment_receipt_enabled: zod_1.z.boolean().optional(),
    subscription_cancelled_enabled: zod_1.z.boolean().optional(),
    // Welcome
    welcome_email_enabled: zod_1.z.boolean().optional(),
    // Marketing
    marketing_emails_enabled: zod_1.z.boolean().optional(),
    product_updates_enabled: zod_1.z.boolean().optional(),
    // Reports
    weekly_recap_enabled: zod_1.z.boolean().optional(),
    // Channels
    email_enabled: zod_1.z.boolean().optional(),
    slack_enabled: zod_1.z.boolean().optional(),
    telegram_enabled: zod_1.z.boolean().optional(),
    whatsapp_enabled: zod_1.z.boolean().optional(),
});
const notificationRoutes = async (fastify) => {
    /**
     * POST /api/notifications/test/slack
     * Test Slack webhook connection
     */
    fastify.post('/test/slack', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        const userId = request.user?.userId;
        // Validate body
        const validation = TestSlackSchema.safeParse(request.body);
        if (!validation.success) {
            return reply.status(400).send({
                success: false,
                error: 'Invalid request body',
                details: validation.error.issues,
            });
        }
        const { webhookUrl } = validation.data;
        try {
            const success = await (0, slack_service_1.testSlackWebhook)(webhookUrl);
            if (success) {
                return reply.send({
                    success: true,
                    message: 'Slack webhook test successful! Check your Slack channel.',
                });
            }
            else {
                return reply.status(400).send({
                    success: false,
                    error: 'Failed to send test message to Slack webhook',
                });
            }
        }
        catch (error) {
            return reply.status(500).send({
                success: false,
                error: 'Failed to test Slack webhook',
                message: error.message,
            });
        }
    });
    /**
     * POST /api/notifications/test/telegram
     * Test Telegram bot connection
     */
    fastify.post('/test/telegram', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        const userId = request.user?.userId;
        // Validate body
        const validation = TestTelegramSchema.safeParse(request.body);
        if (!validation.success) {
            return reply.status(400).send({
                success: false,
                error: 'Invalid request body',
                details: validation.error.issues,
            });
        }
        const { chatId } = validation.data;
        try {
            const success = await (0, telegram_service_1.testTelegramBot)(chatId);
            if (success) {
                return reply.send({
                    success: true,
                    message: 'Telegram bot test successful! Check your Telegram chat.',
                });
            }
            else {
                return reply.status(400).send({
                    success: false,
                    error: 'Failed to send test message to Telegram. Make sure the bot is configured and you have started a chat with it.',
                });
            }
        }
        catch (error) {
            return reply.status(500).send({
                success: false,
                error: 'Failed to test Telegram bot',
                message: error.message,
            });
        }
    });
    /**
     * GET /api/notifications/telegram/info
     * Get Telegram bot information
     */
    fastify.get('/telegram/info', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        try {
            const botInfo = await (0, telegram_service_1.getTelegramBotInfo)();
            if (botInfo) {
                return reply.send({
                    success: true,
                    data: {
                        username: botInfo.username,
                        firstName: botInfo.first_name,
                        canReadAllGroupMessages: botInfo.can_read_all_group_messages,
                    },
                });
            }
            else {
                return reply.status(503).send({
                    success: false,
                    error: 'Telegram bot not configured',
                });
            }
        }
        catch (error) {
            return reply.status(500).send({
                success: false,
                error: 'Failed to get Telegram bot info',
                message: error.message,
            });
        }
    });
    /**
     * POST /api/notifications/phone/send-verification
     * Send SMS verification code
     */
    fastify.post('/phone/send-verification', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        const userId = request.user?.userId;
        // Validate body
        const validation = SendVerificationSchema.safeParse(request.body);
        if (!validation.success) {
            return reply.status(400).send({
                success: false,
                error: 'Invalid request body',
                details: validation.error.issues,
            });
        }
        const { phone } = validation.data;
        // Validate phone format
        if (!(0, sms_service_1.isValidPhoneNumber)(phone)) {
            return reply.status(400).send({
                success: false,
                error: 'Invalid phone number format. Use E.164 format (e.g., +14155552671)',
            });
        }
        try {
            // Check for rate limiting - max 3 codes per hour per user
            const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
            const recentVerifications = await prisma_1.prisma.phoneVerification.count({
                where: {
                    user_id: userId,
                    created_at: { gte: oneHourAgo },
                },
            });
            if (recentVerifications >= 3) {
                return reply.status(429).send({
                    success: false,
                    error: 'Too many verification attempts. Please try again in an hour.',
                });
            }
            // Generate 6-digit verification code
            const code = Math.floor(100000 + Math.random() * 900000).toString();
            const codeHash = hashCode(code);
            const expiresAt = new Date(Date.now() + VERIFICATION_CODE_EXPIRY_MINUTES * 60 * 1000);
            // Update user's phone (unverified)
            await prisma_1.prisma.user.update({
                where: { id: userId },
                data: {
                    phone: phone,
                    phone_verified: false,
                },
            });
            // Store verification code in database (upsert to handle re-sends)
            await prisma_1.prisma.phoneVerification.upsert({
                where: {
                    user_id_phone: {
                        user_id: userId,
                        phone: phone,
                    },
                },
                update: {
                    code_hash: codeHash,
                    expires_at: expiresAt,
                    attempts: 0,
                    verified: false,
                    created_at: new Date(),
                },
                create: {
                    user_id: userId,
                    phone: phone,
                    code_hash: codeHash,
                    expires_at: expiresAt,
                    attempts: 0,
                    verified: false,
                },
            });
            // Send SMS
            const success = await (0, sms_service_1.sendVerificationCode)(phone, code);
            if (success) {
                return reply.send({
                    success: true,
                    message: 'Verification code sent via SMS. Code expires in 10 minutes.',
                    // In development only, return code for testing
                    ...(process.env.NODE_ENV === 'development' && { code }),
                });
            }
            else {
                return reply.status(503).send({
                    success: false,
                    error: 'Failed to send SMS. Make sure Twilio is configured correctly.',
                });
            }
        }
        catch (error) {
            return reply.status(500).send({
                success: false,
                error: 'Failed to send verification code',
                message: error.message,
            });
        }
    });
    /**
     * POST /api/notifications/phone/verify
     * Verify phone number with code
     */
    fastify.post('/phone/verify', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        const userId = request.user?.userId;
        // Validate body
        const validation = VerifyPhoneSchema.safeParse(request.body);
        if (!validation.success) {
            return reply.status(400).send({
                success: false,
                error: 'Invalid request body',
                details: validation.error.issues,
            });
        }
        const { phone, code } = validation.data;
        try {
            // Check code format
            if (code.length !== VERIFICATION_CODE_LENGTH || !/^\d+$/.test(code)) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid verification code format. Must be 6 digits.',
                });
            }
            // Find the verification record
            const verification = await prisma_1.prisma.phoneVerification.findUnique({
                where: {
                    user_id_phone: {
                        user_id: userId,
                        phone: phone,
                    },
                },
            });
            if (!verification) {
                return reply.status(400).send({
                    success: false,
                    error: 'No verification code found for this phone number. Please request a new code.',
                });
            }
            // Check if already verified
            if (verification.verified) {
                return reply.status(400).send({
                    success: false,
                    error: 'This phone number has already been verified.',
                });
            }
            // Check if code expired
            if (new Date() > verification.expires_at) {
                return reply.status(400).send({
                    success: false,
                    error: 'Verification code has expired. Please request a new code.',
                });
            }
            // Check max attempts
            if (verification.attempts >= MAX_VERIFICATION_ATTEMPTS) {
                return reply.status(429).send({
                    success: false,
                    error: 'Too many failed attempts. Please request a new code.',
                });
            }
            // Increment attempts
            await prisma_1.prisma.phoneVerification.update({
                where: { id: verification.id },
                data: { attempts: verification.attempts + 1 },
            });
            // Verify the code
            const codeHash = hashCode(code);
            if (codeHash !== verification.code_hash) {
                const remainingAttempts = MAX_VERIFICATION_ATTEMPTS - verification.attempts - 1;
                return reply.status(400).send({
                    success: false,
                    error: `Invalid verification code. ${remainingAttempts} attempts remaining.`,
                });
            }
            // Code is valid - mark as verified
            await prisma_1.prisma.$transaction([
                prisma_1.prisma.phoneVerification.update({
                    where: { id: verification.id },
                    data: { verified: true },
                }),
                prisma_1.prisma.user.update({
                    where: { id: userId },
                    data: {
                        phone: phone,
                        phone_verified: true,
                    },
                }),
            ]);
            return reply.send({
                success: true,
                message: 'Phone number verified successfully',
            });
        }
        catch (error) {
            return reply.status(500).send({
                success: false,
                error: 'Failed to verify phone number',
                message: error.message,
            });
        }
    });
    /**
     * GET /api/notifications/settings
     * Get user's notification settings
     */
    fastify.get('/settings', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        const userId = request.user?.userId;
        try {
            const user = await prisma_1.prisma.user.findUnique({
                where: { id: userId },
                select: {
                    phone: true,
                    phone_verified: true,
                    slack_webhook_url: true,
                    telegram_chat_id: true,
                },
            });
            if (!user) {
                return reply.status(404).send({
                    success: false,
                    error: 'User not found',
                });
            }
            return reply.send({
                success: true,
                data: {
                    phone: user.phone,
                    phoneVerified: user.phone_verified,
                    slackWebhookUrl: user.slack_webhook_url,
                    telegramChatId: user.telegram_chat_id,
                },
            });
        }
        catch (error) {
            return reply.status(500).send({
                success: false,
                error: 'Failed to get notification settings',
                message: error.message,
            });
        }
    });
    /**
     * PUT /api/notifications/settings
     * Update user's notification settings
     */
    fastify.put('/settings', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        const userId = request.user?.userId;
        // Validate body
        const validation = UpdateSettingsSchema.safeParse(request.body);
        if (!validation.success) {
            return reply.status(400).send({
                success: false,
                error: 'Invalid request body',
                details: validation.error.issues,
            });
        }
        const { phone, slackWebhookUrl, telegramChatId } = validation.data;
        // Validate phone format if provided
        if (phone && !(0, sms_service_1.isValidPhoneNumber)(phone)) {
            return reply.status(400).send({
                success: false,
                error: 'Invalid phone number format. Use E.164 format (e.g., +14155552671)',
            });
        }
        try {
            const updateData = {};
            if (phone !== undefined) {
                updateData.phone = phone;
                // Reset verification if phone changed
                const currentUser = await prisma_1.prisma.user.findUnique({
                    where: { id: userId },
                    select: { phone: true },
                });
                if (currentUser?.phone !== phone) {
                    updateData.phone_verified = false;
                }
            }
            if (slackWebhookUrl !== undefined) {
                updateData.slack_webhook_url = slackWebhookUrl || null;
            }
            if (telegramChatId !== undefined) {
                updateData.telegram_chat_id = telegramChatId || null;
            }
            const user = await prisma_1.prisma.user.update({
                where: { id: userId },
                data: updateData,
                select: {
                    phone: true,
                    phone_verified: true,
                    slack_webhook_url: true,
                    telegram_chat_id: true,
                },
            });
            return reply.send({
                success: true,
                message: 'Notification settings updated',
                data: {
                    phone: user.phone,
                    phoneVerified: user.phone_verified,
                    slackWebhookUrl: user.slack_webhook_url,
                    telegramChatId: user.telegram_chat_id,
                },
            });
        }
        catch (error) {
            return reply.status(500).send({
                success: false,
                error: 'Failed to update notification settings',
                message: error.message,
            });
        }
    });
    /**
     * GET /api/notifications/preferences
     * Get user's email notification preferences
     */
    fastify.get('/preferences', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        const userId = request.user?.userId;
        try {
            // Get or create preferences with defaults
            let preferences = await prisma_1.prisma.notificationPreferences.findUnique({
                where: { user_id: userId },
            });
            if (!preferences) {
                // Create default preferences
                preferences = await prisma_1.prisma.notificationPreferences.create({
                    data: {
                        user_id: userId,
                    },
                });
            }
            return reply.send({
                success: true,
                data: {
                    // Lead notifications
                    leadFoundEnabled: preferences.lead_found_enabled,
                    scanCompleteEnabled: preferences.scan_complete_enabled,
                    // Billing & Usage
                    usageWarningEnabled: preferences.usage_warning_enabled,
                    limitReachedEnabled: preferences.limit_reached_enabled,
                    subscriptionConfirmedEnabled: preferences.subscription_confirmed_enabled,
                    paymentReceiptEnabled: preferences.payment_receipt_enabled,
                    subscriptionCancelledEnabled: preferences.subscription_cancelled_enabled,
                    // Welcome
                    welcomeEmailEnabled: preferences.welcome_email_enabled,
                    // Marketing
                    marketingEmailsEnabled: preferences.marketing_emails_enabled,
                    productUpdatesEnabled: preferences.product_updates_enabled,
                    // Reports
                    weeklyRecapEnabled: preferences.weekly_recap_enabled,
                    // Channels
                    emailEnabled: preferences.email_enabled,
                    slackEnabled: preferences.slack_enabled,
                    telegramEnabled: preferences.telegram_enabled,
                    whatsappEnabled: preferences.whatsapp_enabled,
                },
            });
        }
        catch (error) {
            console.error('[Notifications] Failed to get preferences:', error);
            return reply.status(500).send({
                success: false,
                error: 'Failed to get notification preferences',
                message: error.message,
            });
        }
    });
    /**
     * PATCH /api/notifications/preferences
     * Update user's email notification preferences
     */
    fastify.patch('/preferences', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        const userId = request.user?.userId;
        // Validate body
        const validation = UpdatePreferencesSchema.safeParse(request.body);
        if (!validation.success) {
            return reply.status(400).send({
                success: false,
                error: 'Invalid request body',
                details: validation.error.issues,
            });
        }
        try {
            // Upsert preferences (create if not exists, update if exists)
            const preferences = await prisma_1.prisma.notificationPreferences.upsert({
                where: { user_id: userId },
                create: {
                    user_id: userId,
                    ...validation.data,
                },
                update: validation.data,
            });
            return reply.send({
                success: true,
                message: 'Notification preferences updated',
                data: {
                    // Lead notifications
                    leadFoundEnabled: preferences.lead_found_enabled,
                    scanCompleteEnabled: preferences.scan_complete_enabled,
                    // Billing & Usage
                    usageWarningEnabled: preferences.usage_warning_enabled,
                    limitReachedEnabled: preferences.limit_reached_enabled,
                    subscriptionConfirmedEnabled: preferences.subscription_confirmed_enabled,
                    paymentReceiptEnabled: preferences.payment_receipt_enabled,
                    subscriptionCancelledEnabled: preferences.subscription_cancelled_enabled,
                    // Welcome
                    welcomeEmailEnabled: preferences.welcome_email_enabled,
                    // Marketing
                    marketingEmailsEnabled: preferences.marketing_emails_enabled,
                    productUpdatesEnabled: preferences.product_updates_enabled,
                    // Reports
                    weeklyRecapEnabled: preferences.weekly_recap_enabled,
                    // Channels
                    emailEnabled: preferences.email_enabled,
                    slackEnabled: preferences.slack_enabled,
                    telegramEnabled: preferences.telegram_enabled,
                    whatsappEnabled: preferences.whatsapp_enabled,
                },
            });
        }
        catch (error) {
            console.error('[Notifications] Failed to update preferences:', error);
            return reply.status(500).send({
                success: false,
                error: 'Failed to update notification preferences',
                message: error.message,
            });
        }
    });
    /**
     * POST /api/notifications/preferences/reset
     * Reset notification preferences to defaults
     */
    fastify.post('/preferences/reset', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        const userId = request.user?.userId;
        try {
            // Delete existing preferences (will trigger default values on next create)
            await prisma_1.prisma.notificationPreferences.deleteMany({
                where: { user_id: userId },
            });
            // Create new preferences with defaults
            const preferences = await prisma_1.prisma.notificationPreferences.create({
                data: {
                    user_id: userId,
                },
            });
            return reply.send({
                success: true,
                message: 'Notification preferences reset to defaults',
                data: {
                    // Lead notifications
                    leadFoundEnabled: preferences.lead_found_enabled,
                    scanCompleteEnabled: preferences.scan_complete_enabled,
                    // Billing & Usage
                    usageWarningEnabled: preferences.usage_warning_enabled,
                    limitReachedEnabled: preferences.limit_reached_enabled,
                    subscriptionConfirmedEnabled: preferences.subscription_confirmed_enabled,
                    paymentReceiptEnabled: preferences.payment_receipt_enabled,
                    subscriptionCancelledEnabled: preferences.subscription_cancelled_enabled,
                    // Welcome
                    welcomeEmailEnabled: preferences.welcome_email_enabled,
                    // Marketing
                    marketingEmailsEnabled: preferences.marketing_emails_enabled,
                    productUpdatesEnabled: preferences.product_updates_enabled,
                    // Reports
                    weeklyRecapEnabled: preferences.weekly_recap_enabled,
                    // Channels
                    emailEnabled: preferences.email_enabled,
                    slackEnabled: preferences.slack_enabled,
                    telegramEnabled: preferences.telegram_enabled,
                    whatsappEnabled: preferences.whatsapp_enabled,
                },
            });
        }
        catch (error) {
            console.error('[Notifications] Failed to reset preferences:', error);
            return reply.status(500).send({
                success: false,
                error: 'Failed to reset notification preferences',
                message: error.message,
            });
        }
    });
    /**
     * POST /api/notifications/test
     * Send a test email to verify email configuration
     */
    fastify.post('/test', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        const userId = request.user?.userId;
        try {
            // Get user email
            const user = await prisma_1.prisma.user.findUnique({
                where: { id: userId },
                select: { email: true, name: true },
            });
            if (!user || !user.email) {
                return reply.status(404).send({
                    success: false,
                    error: 'User not found or email not available',
                });
            }
            // Send test email
            const result = await (0, email_service_1.sendEmail)({
                to: user.email,
                subject: 'MyInboxer - Test Email',
                html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #4F46E5;">Test Email from MyInboxer</h2>
            <p>Hi ${user.name || 'there'},</p>
            <p>This is a test email to verify your email notification configuration is working correctly.</p>
            <p>If you received this email, your notifications are set up properly!</p>
            <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 20px 0;">
            <p style="color: #6B7280; font-size: 14px;">
              You're receiving this because you requested a test email from your MyInboxer dashboard.
            </p>
          </div>
        `,
                text: `Test Email from MyInboxer\n\nHi ${user.name || 'there'},\n\nThis is a test email to verify your email notification configuration is working correctly.\n\nIf you received this email, your notifications are set up properly!`,
            });
            if (result.success) {
                return reply.send({
                    success: true,
                    message: `Test email sent to ${user.email}`,
                    messageId: result.messageId,
                });
            }
            else {
                return reply.status(503).send({
                    success: false,
                    error: 'Failed to send test email',
                    message: result.error,
                });
            }
        }
        catch (error) {
            console.error('[Notifications] Failed to send test email:', error);
            return reply.status(500).send({
                success: false,
                error: 'Failed to send test email',
                message: error.message,
            });
        }
    });
};
exports.default = notificationRoutes;
