"use strict";
/**
 * Email Content Encryption
 * AES-256-GCM encryption for email subjects and bodies
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptEmail = encryptEmail;
exports.decryptEmail = decryptEmail;
exports.encryptEmailWithCompression = encryptEmailWithCompression;
exports.decryptEmailWithDecompression = decryptEmailWithDecompression;
exports.generateEncryptionKey = generateEncryptionKey;
exports.encryptFields = encryptFields;
exports.decryptFields = decryptFields;
exports.isEncrypted = isEncrypted;
exports.encrypt = encrypt;
exports.decrypt = decrypt;
const crypto_1 = __importDefault(require("crypto"));
const zlib_1 = __importDefault(require("zlib"));
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;
// Get encryption key from environment
function getEncryptionKey() {
    const key = process.env.MASTER_ENCRYPTION_KEY;
    if (!key) {
        throw new Error('MASTER_ENCRYPTION_KEY not set in environment');
    }
    // Ensure key is 64 hex characters (32 bytes)
    if (key.length !== 64) {
        throw new Error('MASTER_ENCRYPTION_KEY must be 64 hex characters (32 bytes)');
    }
    return Buffer.from(key, 'hex');
}
/**
 * Encrypt email content
 * @param content Plain text content
 * @returns Encrypted string in format: iv:authTag:encrypted
 */
function encryptEmail(content) {
    if (!content)
        return '';
    try {
        const key = getEncryptionKey();
        const iv = crypto_1.default.randomBytes(IV_LENGTH);
        const cipher = crypto_1.default.createCipheriv(ALGORITHM, key, iv);
        let encrypted = cipher.update(content, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag();
        // Format: iv:authTag:encrypted
        return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    }
    catch (error) {
        console.error('[Encryption] Failed to encrypt content:', error);
        throw new Error('Encryption failed');
    }
}
/**
 * Decrypt email content
 * @param encrypted Encrypted string in format: iv:authTag:encrypted
 * @returns Decrypted plain text
 */
function decryptEmail(encrypted) {
    if (!encrypted)
        return '';
    // Check if already marked as deleted
    if (encrypted === '[DELETED]')
        return '[DELETED]';
    // Check if content is actually encrypted (format: iv:authTag:encrypted)
    const parts = encrypted.split(':');
    if (parts.length !== 3) {
        // Not encrypted format - likely plain text from before encryption was enabled
        // Return as-is (backwards compatible)
        return encrypted;
    }
    try {
        const [ivHex, authTagHex, encryptedData] = parts;
        // Validate hex format (encrypted data should be valid hex)
        const hexRegex = /^[0-9a-fA-F]+$/;
        if (!hexRegex.test(ivHex) || !hexRegex.test(authTagHex) || !hexRegex.test(encryptedData)) {
            // Not valid hex - this is plain text that happens to have colons
            return encrypted;
        }
        const key = getEncryptionKey();
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        // Validate IV and authTag lengths
        if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
            // Invalid lengths - this is plain text
            return encrypted;
        }
        const decipher = crypto_1.default.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }
    catch (error) {
        // Decryption failed - likely plain text content, return as-is
        console.warn('[Encryption] Could not decrypt (likely plain text from before encryption enabled), returning original');
        return encrypted;
    }
}
/**
 * Encrypt large content with compression
 * Compresses before encrypting to save space
 * @param content Plain text content
 * @returns Encrypted string in format: iv:authTag:encrypted
 */
function encryptEmailWithCompression(content) {
    if (!content)
        return '';
    try {
        const key = getEncryptionKey();
        // Compress first
        const compressed = zlib_1.default.gzipSync(content);
        const iv = crypto_1.default.randomBytes(IV_LENGTH);
        const cipher = crypto_1.default.createCipheriv(ALGORITHM, key, iv);
        let encrypted = cipher.update(compressed);
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        const authTag = cipher.getAuthTag();
        // Format: iv:authTag:encrypted (all hex)
        return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
    }
    catch (error) {
        console.error('[Encryption] Failed to encrypt with compression:', error);
        throw new Error('Compression encryption failed');
    }
}
/**
 * Decrypt compressed content
 * @param encrypted Encrypted string in format: iv:authTag:encrypted
 * @returns Decompressed plain text
 */
function decryptEmailWithDecompression(encrypted) {
    if (!encrypted)
        return '';
    if (encrypted === '[DELETED]')
        return '[DELETED]';
    try {
        const parts = encrypted.split(':');
        if (parts.length !== 3) {
            console.error('[Encryption] Invalid encrypted format');
            return '[ERROR: Invalid encrypted format]';
        }
        const [ivHex, authTagHex, encryptedData] = parts;
        const key = getEncryptionKey();
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');
        const decipher = crypto_1.default.createDecipheriv(ALGORITHM, key, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encryptedData, 'hex');
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        // Decompress
        const decompressed = zlib_1.default.gunzipSync(decrypted);
        return decompressed.toString('utf8');
    }
    catch (error) {
        console.error('[Encryption] Failed to decrypt with decompression:', error);
        return '[ERROR: Decompression decryption failed]';
    }
}
/**
 * Generate a new encryption key
 * Use this to generate MASTER_ENCRYPTION_KEY
 * @returns 64-character hex string (32 bytes)
 */
function generateEncryptionKey() {
    return crypto_1.default.randomBytes(KEY_LENGTH).toString('hex');
}
/**
 * Encrypt multiple fields at once
 * @param fields Object with string fields to encrypt
 * @returns Object with encrypted fields
 */
function encryptFields(fields) {
    const encrypted = {};
    for (const [key, value] of Object.entries(fields)) {
        if (value === null || value === undefined) {
            encrypted[key] = null;
        }
        else {
            encrypted[key] = encryptEmail(value);
        }
    }
    return encrypted;
}
/**
 * Decrypt multiple fields at once
 * @param fields Object with encrypted string fields
 * @returns Object with decrypted fields
 */
function decryptFields(fields) {
    const decrypted = {};
    for (const [key, value] of Object.entries(fields)) {
        if (value === null || value === undefined) {
            decrypted[key] = null;
        }
        else {
            decrypted[key] = decryptEmail(value);
        }
    }
    return decrypted;
}
/**
 * Check if content is encrypted
 * @param content String to check
 * @returns true if encrypted format detected
 */
function isEncrypted(content) {
    if (!content)
        return false;
    // Check for our encryption format: hex:hex:hex
    const parts = content.split(':');
    return parts.length === 3 &&
        parts.every(part => /^[0-9a-f]+$/i.test(part));
}
// Legacy functions (for backwards compatibility)
function encrypt(data) {
    return encryptEmail(data);
}
function decrypt(data) {
    return decryptEmail(data);
}
// Log encryption status on startup
console.log(process.env.MASTER_ENCRYPTION_KEY
    ? '✅ Email encryption: Enabled'
    : '⚠️  Email encryption: DISABLED (MASTER_ENCRYPTION_KEY not set)');
