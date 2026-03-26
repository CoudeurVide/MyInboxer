"use strict";
/**
 * Email Notification Settings Service
 * Manages notification frequency, batching, and rate limiting for email templates
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNotificationSettings = getNotificationSettings;
exports.getAllNotificationSettings = getAllNotificationSettings;
exports.updateNotificationSettings = updateNotificationSettings;
exports.canSendEmail = canSendEmail;
exports.recordEmailSent = recordEmailSent;
exports.getEmailStats = getEmailStats;
const prisma_1 = require("../lib/prisma");
// In-memory tracking for rate limiting
const emailSendTracker = new Map();
/**
 * Get notification settings for a template
 */
async function getNotificationSettings(templateKey) {
    try {
        const result = await prisma_1.prisma.$queryRaw `
      SELECT * FROM email_notification_settings
      WHERE template_key = ${templateKey}
      LIMIT 1
    `;
        return result.length > 0 ? result[0] : null;
    }
    catch (error) {
        console.error(`[NotificationSettings] Failed to load settings for "${templateKey}":`, error);
        return null;
    }
}
/**
 * Get all notification settings
 */
async function getAllNotificationSettings() {
    try {
        const result = await prisma_1.prisma.$queryRaw `
      SELECT * FROM email_notification_settings
      ORDER BY template_key
    `;
        return result;
    }
    catch (error) {
        console.error('[NotificationSettings] Failed to load all settings:', error);
        return [];
    }
}
/**
 * Update notification settings for a template
 */
async function updateNotificationSettings(templateKey, updates) {
    try {
        const fields = [];
        if (updates.notification_mode !== undefined) {
            fields.push(`notification_mode = '${updates.notification_mode}'`);
        }
        if (updates.batch_interval_minutes !== undefined) {
            fields.push(`batch_interval_minutes = ${updates.batch_interval_minutes}`);
        }
        if (updates.digest_time !== undefined) {
            fields.push(`digest_time = '${updates.digest_time}'`);
        }
        if (updates.cooldown_minutes !== undefined) {
            fields.push(`cooldown_minutes = ${updates.cooldown_minutes}`);
        }
        if (updates.max_emails_per_day !== undefined) {
            fields.push(`max_emails_per_day = ${updates.max_emails_per_day}`);
        }
        if (updates.min_items_threshold !== undefined) {
            fields.push(`min_items_threshold = ${updates.min_items_threshold}`);
        }
        if (fields.length === 0) {
            throw new Error('No fields to update');
        }
        fields.push(`updated_at = NOW()`);
        const query = `
      UPDATE email_notification_settings
      SET ${fields.join(', ')}
      WHERE template_key = '${templateKey.replace(/'/g, "''")}'
      RETURNING *
    `;
        const result = await prisma_1.prisma.$queryRawUnsafe(query);
        return result.length > 0 ? result[0] : null;
    }
    catch (error) {
        console.error(`[NotificationSettings] Failed to update settings for "${templateKey}":`, error);
        throw error;
    }
}
/**
 * Check if an email can be sent based on notification settings
 */
async function canSendEmail(templateKey, itemCount = 1) {
    const settings = await getNotificationSettings(templateKey);
    if (!settings) {
        // No settings = allow (fail open)
        return { allowed: true };
    }
    // Check minimum items threshold
    if (itemCount < settings.min_items_threshold) {
        return {
            allowed: false,
            reason: `Threshold not met (${itemCount} < ${settings.min_items_threshold})`,
        };
    }
    // Get or create tracker
    const now = Date.now();
    const todayStart = new Date().setHours(0, 0, 0, 0);
    let tracker = emailSendTracker.get(templateKey);
    if (!tracker || tracker.todayReset < todayStart) {
        // Reset daily counter
        tracker = {
            lastSentAt: 0,
            sentToday: 0,
            todayReset: todayStart,
        };
        emailSendTracker.set(templateKey, tracker);
    }
    // Check daily limit
    if (tracker.sentToday >= settings.max_emails_per_day) {
        return {
            allowed: false,
            reason: `Daily limit reached (${tracker.sentToday}/${settings.max_emails_per_day})`,
        };
    }
    // Check cooldown
    const timeSinceLastSend = now - tracker.lastSentAt;
    const cooldownMs = settings.cooldown_minutes * 60 * 1000;
    if (timeSinceLastSend < cooldownMs) {
        const remainingMinutes = Math.ceil((cooldownMs - timeSinceLastSend) / 60000);
        return {
            allowed: false,
            reason: `Cooldown active (${remainingMinutes} min remaining)`,
        };
    }
    return { allowed: true };
}
/**
 * Record that an email was sent (for rate limiting)
 */
function recordEmailSent(templateKey) {
    const now = Date.now();
    const todayStart = new Date().setHours(0, 0, 0, 0);
    let tracker = emailSendTracker.get(templateKey);
    if (!tracker || tracker.todayReset < todayStart) {
        tracker = {
            lastSentAt: now,
            sentToday: 1,
            todayReset: todayStart,
        };
    }
    else {
        tracker.lastSentAt = now;
        tracker.sentToday += 1;
    }
    emailSendTracker.set(templateKey, tracker);
}
/**
 * Get current email send stats for a template
 */
function getEmailStats(templateKey) {
    const tracker = emailSendTracker.get(templateKey);
    if (!tracker) {
        return { sentToday: 0, lastSentAt: null };
    }
    const todayStart = new Date().setHours(0, 0, 0, 0);
    if (tracker.todayReset < todayStart) {
        return { sentToday: 0, lastSentAt: tracker.lastSentAt };
    }
    return {
        sentToday: tracker.sentToday,
        lastSentAt: tracker.lastSentAt,
    };
}
