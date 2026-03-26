"use strict";
/**
 * User Service
 * Handles user management with encrypted sensitive fields
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.prepareUserDataForStorage = prepareUserDataForStorage;
exports.prepareUserDataForOutput = prepareUserDataForOutput;
exports.updateUserWithEncryption = updateUserWithEncryption;
exports.getUserWithDecryption = getUserWithDecryption;
const prisma_1 = require("../lib/prisma");
const encryption_service_1 = require("./encryption.service");
/**
 * Encrypt sensitive user fields before saving
 */
async function prepareUserDataForStorage(userData) {
    const encryptedData = { ...userData };
    // Encrypt MFA secret if present
    if (userData.mfa_secret) {
        encryptedData.mfa_secret = encryption_service_1.encryptionService.encryptField(userData.mfa_secret);
    }
    // Encrypt phone number if present
    if (userData.phone) {
        encryptedData.phone = encryption_service_1.encryptionService.encryptField(userData.phone);
    }
    // Encrypt Slack webhook URL if present
    if (userData.slack_webhook_url) {
        encryptedData.slack_webhook_url = encryption_service_1.encryptionService.encryptField(userData.slack_webhook_url);
    }
    // Encrypt Telegram chat ID if present
    if (userData.telegram_chat_id) {
        encryptedData.telegram_chat_id = encryption_service_1.encryptionService.encryptField(userData.telegram_chat_id);
    }
    return encryptedData;
}
/**
 * Decrypt sensitive user fields for output
 */
async function prepareUserDataForOutput(userData) {
    const decryptedData = { ...userData };
    // Decrypt MFA secret if present
    if (userData.mfa_secret) {
        decryptedData.mfa_secret = encryption_service_1.encryptionService.decryptField(userData.mfa_secret);
    }
    // Decrypt phone number if present
    if (userData.phone) {
        decryptedData.phone = encryption_service_1.encryptionService.decryptField(userData.phone);
    }
    // Decrypt Slack webhook URL if present
    if (userData.slack_webhook_url) {
        decryptedData.slack_webhook_url = encryption_service_1.encryptionService.decryptField(userData.slack_webhook_url);
    }
    // Decrypt Telegram chat ID if present
    if (userData.telegram_chat_id) {
        decryptedData.telegram_chat_id = encryption_service_1.encryptionService.decryptField(userData.telegram_chat_id);
    }
    return decryptedData;
}
/**
 * Update user with proper encryption of sensitive fields
 */
async function updateUserWithEncryption(userId, userData) {
    // Prepare data for storage (encrypt sensitive fields)
    const encryptedData = await prepareUserDataForStorage(userData);
    // Update user
    const updatedUser = await prisma_1.prisma.user.update({
        where: { id: userId },
        data: encryptedData,
    });
    // Prepare for output (decrypt for response)
    return await prepareUserDataForOutput(updatedUser);
}
/**
 * Get user with proper decryption of sensitive fields
 */
async function getUserWithDecryption(userId) {
    const user = await prisma_1.prisma.user.findUnique({
        where: { id: userId },
    });
    if (!user)
        return null;
    // Prepare for output (decrypt sensitive fields)
    return await prepareUserDataForOutput(user);
}
