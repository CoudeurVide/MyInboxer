"use strict";
/**
 * Mailbox Service
 * Handles OAuth token management and mailbox operations
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
exports.createOrUpdateMailbox = createOrUpdateMailbox;
exports.getUserMailboxes = getUserMailboxes;
exports.getMailboxWithTokens = getMailboxWithTokens;
exports.updateMailboxStatus = updateMailboxStatus;
exports.updateMailboxSettings = updateMailboxSettings;
exports.deleteMailbox = deleteMailbox;
exports.updateLastSync = updateLastSync;
const prisma_1 = require("../lib/prisma");
const config_1 = require("../lib/config");
const crypto = __importStar(require("crypto"));
const usage_service_1 = require("./usage.service");
const plan_service_1 = require("./plan.service");
/**
 * Encryption utilities for OAuth tokens
 */
class TokenEncryption {
    algorithm = 'aes-256-gcm';
    key;
    constructor() {
        this.key = config_1.config.encryption.masterKey;
    }
    encrypt(text) {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv(this.algorithm, this.key, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag();
        // Format: iv:authTag:encrypted
        return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    }
    decrypt(encryptedText) {
        const parts = encryptedText.split(':');
        if (parts.length !== 3) {
            throw new Error('Invalid encrypted token format');
        }
        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encrypted = parts[2];
        const decipher = crypto.createDecipheriv(this.algorithm, this.key, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }
}
const encryption = new TokenEncryption();
/**
 * Create or update a mailbox
 */
async function createOrUpdateMailbox(data) {
    const { userId, provider, email, accessToken, refreshToken } = data;
    // Default token expiration: 1 hour from now if not provided
    const tokenExpiresAt = data.expiresAt || new Date(Date.now() + 3600 * 1000);
    // Encrypt tokens before storing
    const encryptedAccessToken = encryption.encrypt(accessToken);
    const encryptedRefreshToken = encryption.encrypt(refreshToken);
    // Check if mailbox already exists
    const existing = await prisma_1.prisma.mailbox.findFirst({
        where: {
            user_id: userId,
            email_address: email,
            provider,
        },
    });
    if (existing) {
        // Update existing mailbox (tokens only — do NOT touch last_scan_at,
        // it should only be updated when an actual scan completes via updateLastSync)
        return prisma_1.prisma.mailbox.update({
            where: { id: existing.id },
            data: {
                access_token_encrypted: encryptedAccessToken,
                refresh_token_encrypted: encryptedRefreshToken,
                tokens_updated_at: new Date(),
                token_expires_at: tokenExpiresAt,
                status: 'active',
                consecutive_scan_failures: 0,
                last_scan_error: null,
            },
        });
    }
    // Check plan limit before creating a new mailbox
    const featureAccess = await plan_service_1.planService.checkFeatureAccess(userId, 'max_mailboxes');
    if (!featureAccess.hasAccess) {
        const limit = featureAccess.limit ?? 1;
        const current = featureAccess.currentValue ?? limit;
        throw new Error(`MAILBOX_LIMIT_REACHED: You have reached your plan's limit of ${limit} mailbox${limit === 1 ? '' : 'es'}. Current: ${current}. Please upgrade your plan to connect more mailboxes.`);
    }
    // Create new mailbox (last_scan_at defaults to null — "never scanned")
    const mailbox = await prisma_1.prisma.mailbox.create({
        data: {
            user_id: userId,
            provider,
            email_address: email,
            access_token_encrypted: encryptedAccessToken,
            refresh_token_encrypted: encryptedRefreshToken,
            tokens_updated_at: new Date(),
            token_expires_at: tokenExpiresAt,
            status: 'active',
        },
    });
    // Update usage tracking for mailboxes count
    try {
        await usage_service_1.usageService.updateMailboxesCount(userId);
    }
    catch (error) {
        console.error(`[Mailbox] Failed to update mailboxes count after creating mailbox for user ${userId}:`, error);
    }
    return mailbox;
}
/**
 * Get user's mailboxes
 */
async function getUserMailboxes(userId) {
    // SECURITY: Guard against undefined/invalid userId (Prisma silently ignores undefined filters)
    if (!userId || typeof userId !== 'string') {
        throw new Error('UNAUTHORIZED: userId is required');
    }
    return prisma_1.prisma.mailbox.findMany({
        where: { user_id: userId },
        orderBy: { created_at: 'desc' },
        select: {
            id: true,
            user_id: true,
            provider: true,
            email_address: true,
            status: true,
            last_scan_at: true,
            scan_schedule: true,
            created_at: true,
            auto_move_on_classify: true,
            // Don't return encrypted tokens
        },
    });
}
/**
 * Get mailbox by ID with decrypted tokens
 */
async function getMailboxWithTokens(mailboxId, userId) {
    const mailbox = await prisma_1.prisma.mailbox.findFirst({
        where: {
            id: mailboxId,
            user_id: userId,
        },
    });
    if (!mailbox) {
        throw new Error('MAILBOX_NOT_FOUND');
    }
    // Check if encrypted tokens exist
    if (!mailbox.access_token_encrypted) {
        console.error(`[Mailbox] No access token found for mailbox ${mailboxId}`);
        throw new Error('MAILBOX_TOKENS_MISSING: Access token not found. Please reconnect your mailbox.');
    }
    // Decrypt tokens
    let accessToken = null;
    let refreshToken = null;
    try {
        accessToken = encryption.decrypt(mailbox.access_token_encrypted);
        refreshToken = mailbox.refresh_token_encrypted ? encryption.decrypt(mailbox.refresh_token_encrypted) : null;
        // Log token info for debugging (without exposing the actual token)
        console.log(`[Mailbox] Decrypted access token for mailbox ${mailboxId}: length=${accessToken.length}, starts with=${accessToken.substring(0, 10)}..., has colons=${accessToken.includes(':')}`);
    }
    catch (error) {
        console.error(`[Mailbox] Failed to decrypt tokens for mailbox ${mailboxId}:`, error.message);
        console.error(`[Mailbox] Encrypted token format check: ${mailbox.access_token_encrypted?.split(':').length === 3 ? 'valid (3 parts)' : 'invalid'}`);
        throw new Error('MAILBOX_TOKENS_INVALID: Failed to decrypt tokens. Please reconnect your mailbox.');
    }
    // Validate that decrypted token is not empty
    if (!accessToken || accessToken.trim() === '') {
        console.error(`[Mailbox] Decrypted access token is empty for mailbox ${mailboxId}`);
        throw new Error('MAILBOX_TOKENS_EMPTY: Access token is empty. Please reconnect your mailbox.');
    }
    // Validate token doesn't look like it's still encrypted (has colons in encryption format)
    const parts = accessToken.split(':');
    if (parts.length === 3 && parts.every(p => /^[0-9a-f]+$/i.test(p))) {
        console.error(`[Mailbox] Decrypted token still looks encrypted (has 3 hex parts separated by colons) for mailbox ${mailboxId}`);
        console.error(`[Mailbox] This suggests the encryption key is wrong. Please check MASTER_ENCRYPTION_KEY environment variable.`);
        throw new Error('MAILBOX_TOKENS_CORRUPT: Token appears to be corrupted or encryption key is incorrect. Please reconnect your mailbox.');
    }
    // Note: Removed JWT format validation as OAuth access tokens vary by provider
    // Microsoft/Outlook tokens, for example, are not necessarily in JWT format
    // However, most modern OAuth tokens should have some reasonable length
    if (accessToken.length < 20) {
        console.error(`[Mailbox] Decrypted access token is suspiciously short (${accessToken.length} chars) for mailbox ${mailboxId}`);
        throw new Error('MAILBOX_TOKENS_INVALID: Access token appears to be invalid. Please reconnect your mailbox.');
    }
    return {
        ...mailbox,
        accessToken,
        refreshToken,
    };
}
/**
 * Update mailbox status
 */
async function updateMailboxStatus(mailboxId, userId, status) {
    // Prisma doesn't support composite where in update, so we need to find first
    const mailbox = await prisma_1.prisma.mailbox.findFirst({
        where: {
            id: mailboxId,
            user_id: userId,
        },
    });
    if (!mailbox) {
        throw new Error('MAILBOX_NOT_FOUND');
    }
    return prisma_1.prisma.mailbox.update({
        where: { id: mailboxId },
        data: { status },
    });
}
/**
 * Update mailbox settings
 */
async function updateMailboxSettings(mailboxId, userId, settings) {
    // Find mailbox first to verify ownership
    const mailbox = await prisma_1.prisma.mailbox.findFirst({
        where: {
            id: mailboxId,
            user_id: userId,
        },
    });
    if (!mailbox) {
        throw new Error('MAILBOX_NOT_FOUND');
    }
    // Build update data object with only provided fields
    const updateData = {};
    if (settings.notificationEnabled !== undefined) {
        updateData.notification_enabled = settings.notificationEnabled;
    }
    if (settings.notificationChannels !== undefined) {
        updateData.notification_channels = settings.notificationChannels;
    }
    if (settings.autoWhitelistEnabled !== undefined) {
        updateData.auto_whitelist_enabled = settings.autoWhitelistEnabled;
    }
    if (settings.autoMoveOnClassify !== undefined) {
        updateData.auto_move_on_classify = settings.autoMoveOnClassify;
    }
    if (settings.monitoredFolders !== undefined) {
        updateData.monitored_folders = settings.monitoredFolders;
    }
    // Update mailbox
    return prisma_1.prisma.mailbox.update({
        where: { id: mailboxId },
        data: updateData,
    });
}
/**
 * Delete mailbox
 */
async function deleteMailbox(mailboxId, userId) {
    // Prisma doesn't support composite where in delete, so we need to find first
    const mailbox = await prisma_1.prisma.mailbox.findFirst({
        where: {
            id: mailboxId,
            user_id: userId,
        },
    });
    if (!mailbox) {
        throw new Error('MAILBOX_NOT_FOUND');
    }
    const result = await prisma_1.prisma.mailbox.delete({
        where: { id: mailboxId },
    });
    // Update usage tracking for mailboxes count
    try {
        await usage_service_1.usageService.updateMailboxesCount(mailbox.user_id);
    }
    catch (error) {
        console.error(`[Mailbox] Failed to update mailboxes count after deleting mailbox ${mailboxId}:`, error);
    }
    return result;
}
/**
 * Update mailbox sync timestamp
 */
async function updateLastSync(mailboxId) {
    return prisma_1.prisma.mailbox.update({
        where: { id: mailboxId },
        data: { last_scan_at: new Date() },
    });
}
