"use strict";
/**
 * Webhook Service
 * Handles webhook delivery with retry logic and HMAC signature verification
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendWebhook = sendWebhook;
exports.sendWebhookEvent = sendWebhookEvent;
exports.verifyWebhookSignature = verifyWebhookSignature;
const crypto_1 = __importDefault(require("crypto"));
const prisma_1 = require("../lib/prisma");
/**
 * Generate HMAC-SHA256 signature for webhook payload
 */
function generateSignature(payload, secret) {
    return crypto_1.default
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');
}
/**
 * Send webhook with exponential backoff retry
 */
async function sendWebhook(webhookId, payload, attempt = 1) {
    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [1000, 5000, 15000]; // 1s, 5s, 15s
    try {
        // Get webhook details
        const webhook = await prisma_1.prisma.webhook.findUnique({
            where: { id: webhookId },
            select: {
                url: true,
                secret: true,
                enabled: true,
            },
        });
        if (!webhook || !webhook.enabled) {
            console.log(`Webhook ${webhookId} not found or disabled`);
            return;
        }
        // Prepare payload
        const payloadString = JSON.stringify(payload);
        const signature = generateSignature(payloadString, webhook.secret);
        // Send HTTP POST request
        const response = await fetch(webhook.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-SpamRescue-Signature': signature,
                'X-SpamRescue-Event': payload.event,
                'X-SpamRescue-Timestamp': payload.timestamp,
                'User-Agent': 'SpamRescue-Webhook/1.0',
            },
            body: payloadString,
        });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        console.log(`Webhook ${webhookId} delivered successfully to ${webhook.url}`);
    }
    catch (error) {
        console.error(`Webhook ${webhookId} delivery failed (attempt ${attempt}/${MAX_RETRIES}):`, error.message);
        // Retry with exponential backoff
        if (attempt < MAX_RETRIES) {
            const delay = RETRY_DELAYS[attempt - 1];
            console.log(`Retrying webhook ${webhookId} in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            return sendWebhook(webhookId, payload, attempt + 1);
        }
        else {
            console.error(`Webhook ${webhookId} failed after ${MAX_RETRIES} attempts`);
            throw error;
        }
    }
}
/**
 * Send webhook event to all user's webhooks subscribed to that event
 */
async function sendWebhookEvent(userId, event, data) {
    // Get all enabled webhooks subscribed to this event
    const webhooks = await prisma_1.prisma.webhook.findMany({
        where: {
            user_id: userId,
            enabled: true,
            events: {
                has: event,
            },
        },
        select: {
            id: true,
        },
    });
    if (webhooks.length === 0) {
        // No webhooks configured for this event - this is normal
        return;
    }
    const payload = {
        event,
        timestamp: new Date().toISOString(),
        data,
    };
    // Send webhooks in parallel (fire and forget)
    await Promise.allSettled(webhooks.map(webhook => sendWebhook(webhook.id, payload)));
}
/**
 * Verify webhook signature
 * @param payload - Raw webhook payload string
 * @param signature - Signature from X-SpamRescue-Signature header
 * @param secret - Webhook secret
 */
function verifyWebhookSignature(payload, signature, secret) {
    const expectedSignature = generateSignature(payload, secret);
    return crypto_1.default.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
}
