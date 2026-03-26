"use strict";
/**
 * Email Action Token
 * Generates and validates secure tokens for email-based actions
 * Allows users to take actions directly from notification emails without logging in
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateActionToken = generateActionToken;
exports.validateActionToken = validateActionToken;
exports.generateActionUrls = generateActionUrls;
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("./config");
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
// Token expiration (48 hours in seconds)
const TOKEN_EXPIRY_SECONDS = 48 * 60 * 60;
/**
 * Get the encryption key from JWT secret
 */
function getKey() {
    // Use JWT secret as base for action token key
    const secret = config_1.config.jwt.accessSecret;
    // Hash it to get exactly 32 bytes
    return crypto_1.default.createHash('sha256').update(secret).digest();
}
/**
 * Generate a secure action token
 */
function generateActionToken(messageId, mailboxId, userId, action) {
    const key = getKey();
    const iv = crypto_1.default.randomBytes(IV_LENGTH);
    const payload = {
        messageId,
        mailboxId,
        userId,
        action,
        exp: Math.floor(Date.now() / 1000) + TOKEN_EXPIRY_SECONDS,
    };
    const cipher = crypto_1.default.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(JSON.stringify(payload), 'utf8', 'base64');
    encrypted += cipher.final('base64');
    const authTag = cipher.getAuthTag();
    // Combine: iv + authTag + encrypted (URL-safe base64)
    const token = Buffer.concat([
        iv,
        authTag,
        Buffer.from(encrypted, 'base64')
    ]).toString('base64url');
    return token;
}
/**
 * Validate and decode an action token
 */
function validateActionToken(token) {
    try {
        const key = getKey();
        const data = Buffer.from(token, 'base64url');
        if (data.length < IV_LENGTH + AUTH_TAG_LENGTH) {
            console.error('[ActionToken] Token too short');
            return null;
        }
        const iv = data.subarray(0, IV_LENGTH);
        const authTag = data.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
        const encrypted = data.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
        const decipher = crypto_1.default.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encrypted);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        const payload = JSON.parse(decrypted.toString('utf8'));
        // Check expiration
        if (payload.exp < Math.floor(Date.now() / 1000)) {
            console.error('[ActionToken] Token expired');
            return null;
        }
        return payload;
    }
    catch (error) {
        console.error('[ActionToken] Failed to validate token:', error);
        return null;
    }
}
/**
 * Generate all action URLs for a message
 */
function generateActionUrls(messageId, mailboxId, userId, baseUrl) {
    const actions = ['rescue', 'spam', 'legit', 'promotion', 'view'];
    const urls = {};
    for (const action of actions) {
        const token = generateActionToken(messageId, mailboxId, userId, action);
        urls[action] = `${baseUrl}/api/messages/email-action/${token}`;
    }
    return urls;
}
