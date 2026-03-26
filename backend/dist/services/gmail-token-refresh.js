"use strict";
/**
 * Gmail Token Refresh Service
 * Handles refreshing expired Gmail access tokens using the refresh token
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
exports.refreshGmailToken = refreshGmailToken;
const googleapis_1 = require("googleapis");
const config_1 = require("../lib/config");
const prisma_1 = require("../lib/prisma");
const crypto = __importStar(require("crypto"));
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
 * Refresh an expired Gmail access token using the refresh token
 */
async function refreshGmailToken(mailboxId) {
    try {
        // Get the mailbox with encrypted tokens
        const mailbox = await prisma_1.prisma.mailbox.findUnique({
            where: { id: mailboxId },
        });
        if (!mailbox || !mailbox.refresh_token_encrypted) {
            throw new Error('REFRESH_TOKEN_NOT_FOUND');
        }
        // Decrypt the refresh token
        const refreshToken = encryption.decrypt(mailbox.refresh_token_encrypted);
        // Create OAuth2 client to refresh the token
        const oauth2Client = new googleapis_1.google.auth.OAuth2(config_1.config.oauth.google.clientId, config_1.config.oauth.google.clientSecret, config_1.config.oauth.google.redirectUri);
        // Set the refresh token
        oauth2Client.setCredentials({
            refresh_token: refreshToken,
        });
        // Refresh the access token
        const { credentials } = await oauth2Client.refreshAccessToken();
        if (!credentials.access_token) {
            throw new Error('REFRESH_TOKENS_MISSING');
        }
        // Encrypt the new tokens
        const encryptedAccessToken = encryption.encrypt(credentials.access_token);
        const encryptedRefreshToken = mailbox.refresh_token_encrypted; // Keep the same refresh token if not provided
        // Update the database with new tokens
        const expiresInMs = (credentials.expiry_date || Date.now() + 3600 * 1000) - Date.now();
        const expiresAt = new Date(credentials.expiry_date || Date.now() + 3600 * 1000);
        await prisma_1.prisma.mailbox.update({
            where: { id: mailboxId },
            data: {
                access_token_encrypted: encryptedAccessToken,
                tokens_updated_at: new Date(),
                token_expires_at: expiresAt,
            },
        });
        console.log(`[Gmail Token Refresh] Successfully refreshed token for mailbox ${mailboxId}`);
        return {
            accessToken: credentials.access_token,
            refreshToken: refreshToken,
            expiresAt,
        };
    }
    catch (error) {
        console.error(`[Gmail Token Refresh] Error refreshing token for mailbox ${mailboxId}:`, error);
        throw new Error(`Failed to refresh token: ${error.message}`);
    }
}
