"use strict";
/**
 * Webhook Service
 * Handles webhook management with encrypted secrets
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.prepareWebhookDataForStorage = prepareWebhookDataForStorage;
exports.prepareWebhookDataForUse = prepareWebhookDataForUse;
exports.createWebhook = createWebhook;
exports.getWebhookForUse = getWebhookForUse;
exports.updateWebhook = updateWebhook;
exports.getWebhooks = getWebhooks;
const prisma_1 = require("../lib/prisma");
const encryption_service_1 = require("./encryption.service");
/**
 * Encrypt webhook secrets before storage
 */
async function prepareWebhookDataForStorage(webhookData) {
    const encryptedData = { ...webhookData };
    // Encrypt webhook secret
    if (webhookData.secret) {
        encryptedData.secret = encryption_service_1.encryptionService.encrypt(webhookData.secret);
    }
    // Encrypt URL if it contains sensitive information
    if (webhookData.url) {
        encryptedData.url = encryption_service_1.encryptionService.encrypt(webhookData.url);
    }
    return encryptedData;
}
/**
 * Decrypt webhook secrets for use
 */
async function prepareWebhookDataForUse(webhookData) {
    const decryptedData = { ...webhookData };
    // Decrypt webhook secret
    if (webhookData.secret) {
        decryptedData.secret = encryption_service_1.encryptionService.decrypt(webhookData.secret);
    }
    // Decrypt URL
    if (webhookData.url) {
        decryptedData.url = encryption_service_1.encryptionService.decrypt(webhookData.url);
    }
    return decryptedData;
}
/**
 * Create webhook with encrypted secrets
 */
async function createWebhook(userId, webhookData) {
    // Prepare data for storage (encrypt sensitive fields)
    const encryptedData = await prepareWebhookDataForStorage(webhookData);
    return prisma_1.prisma.webhook.create({
        data: {
            ...encryptedData,
            user_id: userId,
        },
    });
}
/**
 * Get webhook with decrypted secrets
 */
async function getWebhookForUse(webhookId, userId) {
    const webhook = await prisma_1.prisma.webhook.findFirst({
        where: {
            id: webhookId,
            user_id: userId,
        },
    });
    if (!webhook)
        return null;
    // Prepare for use (decrypt fields)
    return await prepareWebhookDataForUse(webhook);
}
/**
 * Update webhook with encrypted secrets
 */
async function updateWebhook(webhookId, userId, webhookData) {
    // Prepare data for storage (encrypt sensitive fields)
    const encryptedData = await prepareWebhookDataForStorage(webhookData);
    return prisma_1.prisma.webhook.update({
        where: {
            id: webhookId,
            user_id: userId,
        },
        data: encryptedData,
    });
}
/**
 * Get webhook list for display (without exposing secrets)
 */
async function getWebhooks(userId) {
    return prisma_1.prisma.webhook.findMany({
        where: { user_id: userId },
        // Exclude secret from response
        select: {
            id: true,
            url: true, // This will be the encrypted URL, so we should handle this differently
            events: true,
            enabled: true,
            created_at: true,
            updated_at: true,
        },
    });
}
