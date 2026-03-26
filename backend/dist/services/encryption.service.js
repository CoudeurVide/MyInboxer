"use strict";
/**
 * Encryption Service
 * Handles encryption and decryption of sensitive data
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptionService = exports.EncryptionService = void 0;
const config_1 = require("../lib/config");
const crypto_1 = __importDefault(require("crypto"));
class EncryptionService {
    algorithm = 'aes-256-gcm';
    key;
    constructor() {
        this.key = config_1.config.encryption.masterKey;
    }
    /**
     * Encrypt sensitive data
     */
    encrypt(text) {
        if (!text)
            return text;
        const iv = crypto_1.default.randomBytes(16);
        const cipher = crypto_1.default.createCipheriv(this.algorithm, this.key, iv);
        let encrypted = cipher.update(text, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag();
        // Format: iv:authTag:encrypted
        return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    }
    /**
     * Decrypt sensitive data
     */
    decrypt(encryptedText) {
        if (!encryptedText)
            return encryptedText;
        const parts = encryptedText.split(':');
        if (parts.length !== 3) {
            throw new Error('Invalid encrypted text format');
        }
        const iv = Buffer.from(parts[0], 'hex');
        const authTag = Buffer.from(parts[1], 'hex');
        const encrypted = parts[2];
        const decipher = crypto_1.default.createDecipheriv(this.algorithm, this.key, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encrypted, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }
    /**
     * Encrypt a field with optional fallback handling
     */
    encryptField(field) {
        if (!field)
            return field;
        return this.encrypt(field);
    }
    /**
     * Decrypt a field with optional fallback handling
     */
    decryptField(field) {
        if (!field)
            return field;
        try {
            return this.decrypt(field);
        }
        catch {
            // Return original value if decryption fails to avoid breaking existing data
            return field;
        }
    }
}
exports.EncryptionService = EncryptionService;
exports.encryptionService = new EncryptionService();
