"use strict";
/**
 * Zod validation schemas for API requests
 * Based on PRD.md API specifications
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.schemas = exports.UpdateUserSchema = exports.UpdateWebhookSchema = exports.CreateWebhookSchema = exports.ListMessagesQuerySchema = exports.ReviewMessageSchema = exports.UpdateMailboxSchema = exports.CreateMailboxSchema = exports.RefreshTokenSchema = exports.LoginSchema = exports.RegisterSchema = void 0;
const zod_1 = require("zod");
const types_1 = require("../types");
// ============================================================================
// Authentication Schemas
// ============================================================================
exports.RegisterSchema = zod_1.z.object({
    email: zod_1.z.string().email('Invalid email address'),
    password: zod_1.z
        .string()
        .min(12, 'Password must be at least 12 characters')
        .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
        .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
        .regex(/[0-9]/, 'Password must contain at least one number'),
});
exports.LoginSchema = zod_1.z.object({
    email: zod_1.z.string().email('Invalid email address'),
    password: zod_1.z.string().min(1, 'Password is required'),
});
exports.RefreshTokenSchema = zod_1.z.object({
    refresh_token: zod_1.z.string().min(1, 'Refresh token is required'),
});
// ============================================================================
// Mailbox Schemas
// ============================================================================
exports.CreateMailboxSchema = zod_1.z.object({
    provider: zod_1.z.nativeEnum(types_1.EmailProvider),
    email_address: zod_1.z.string().email('Invalid email address'),
    access_token: zod_1.z.string().min(10, 'Invalid access token'),
    refresh_token: zod_1.z.string().min(10, 'Invalid refresh token'),
});
exports.UpdateMailboxSchema = zod_1.z.object({
    scan_frequency: zod_1.z.nativeEnum(types_1.ScanFrequency).optional(),
    notification_enabled: zod_1.z.boolean().optional(),
    auto_whitelist_enabled: zod_1.z.boolean().optional(),
});
// ============================================================================
// Message Schemas
// ============================================================================
exports.ReviewMessageSchema = zod_1.z.object({
    user_verdict: zod_1.z.nativeEnum(types_1.MessageVerdict),
});
exports.ListMessagesQuerySchema = zod_1.z.object({
    mailbox_id: zod_1.z.string().uuid().optional(),
    verdict: zod_1.z.nativeEnum(types_1.MessageVerdict).optional(),
    reviewed: zod_1.z.enum(['true', 'false']).optional(),
    page: zod_1.z.string().regex(/^\d+$/).optional().default('1'),
    limit: zod_1.z.string().regex(/^\d+$/).optional().default('20'),
});
// ============================================================================
// Webhook Schemas
// ============================================================================
exports.CreateWebhookSchema = zod_1.z.object({
    url: zod_1.z.string().url('Invalid webhook URL'),
    events: zod_1.z.array(zod_1.z.string()).min(1, 'At least one event is required'),
});
exports.UpdateWebhookSchema = zod_1.z.object({
    url: zod_1.z.string().url('Invalid webhook URL').optional(),
    events: zod_1.z.array(zod_1.z.string()).min(1).optional(),
    enabled: zod_1.z.boolean().optional(),
});
// ============================================================================
// User Schemas
// ============================================================================
exports.UpdateUserSchema = zod_1.z.object({
    email: zod_1.z.string().email().optional(),
    password: zod_1.z
        .string()
        .min(12)
        .regex(/[A-Z]/)
        .regex(/[a-z]/)
        .regex(/[0-9]/)
        .optional(),
});
// ============================================================================
// Export all schemas
// ============================================================================
exports.schemas = {
    auth: {
        register: exports.RegisterSchema,
        login: exports.LoginSchema,
        refreshToken: exports.RefreshTokenSchema,
    },
    mailbox: {
        create: exports.CreateMailboxSchema,
        update: exports.UpdateMailboxSchema,
    },
    message: {
        review: exports.ReviewMessageSchema,
        listQuery: exports.ListMessagesQuerySchema,
    },
    webhook: {
        create: exports.CreateWebhookSchema,
        update: exports.UpdateWebhookSchema,
    },
    user: {
        update: exports.UpdateUserSchema,
    },
};
