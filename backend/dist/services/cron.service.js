"use strict";
/**
 * Cron Service
 * Manages scheduled tasks for automated spam scanning and ML retraining
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduleScan = scheduleScan;
exports.cancelScan = cancelScan;
exports.cancelMailboxScans = cancelMailboxScans;
exports.getActiveJobs = getActiveJobs;
exports.initializeCronJobs = initializeCronJobs;
exports.restartScanCronJobs = restartScanCronJobs;
exports.shutdownCronJobs = shutdownCronJobs;
const node_cron_1 = __importDefault(require("node-cron"));
const prisma_1 = require("../lib/prisma");
const scanner_service_1 = require("./scanner.service");
const outlook_token_refresh_1 = require("./outlook-token-refresh");
const gmail_token_refresh_1 = require("./gmail-token-refresh");
const email_service_1 = require("./email.service");
const config_1 = require("../lib/config");
// Store active cron jobs
const activeCronJobs = new Map();
/**
 * Schedule a recurring scan for a mailbox
 * @param mailboxId - ID of the mailbox to scan
 * @param userId - ID of the user who owns the mailbox
 * @param schedule - Cron expression for scan frequency
 * @returns Job ID
 */
function scheduleScan(mailboxId, userId, schedule) {
    // Validate cron expression
    if (!node_cron_1.default.validate(schedule)) {
        throw new Error('Invalid cron expression');
    }
    // Stop existing job for this mailbox if any
    const existingJob = Array.from(activeCronJobs.values()).find((job) => job.mailboxId === mailboxId);
    if (existingJob) {
        existingJob.task.stop();
        activeCronJobs.delete(existingJob.id);
        console.log(`Stopped existing cron job ${existingJob.id} for mailbox ${mailboxId}`);
    }
    // Create new cron job
    const jobId = `scan_${mailboxId}_${Date.now()}`;
    const task = node_cron_1.default.schedule(schedule, async () => {
        console.log(`[Cron] Running scheduled scan for mailbox ${mailboxId}`);
        try {
            // 1. Check mailbox status - skip if in error state with too many failures
            const mailbox = await prisma_1.prisma.mailbox.findUnique({
                where: { id: mailboxId },
                select: {
                    status: true,
                    provider: true,
                    last_scan_at: true,
                    token_expires_at: true,
                    consecutive_scan_failures: true,
                    last_scan_error: true,
                },
            });
            if (!mailbox) {
                console.error(`[Cron] Mailbox ${mailboxId} not found, skipping scan`);
                return;
            }
            if (mailbox.status === 'disconnected' || mailbox.status === 'paused') {
                console.log(`[Cron] Mailbox ${mailboxId} is ${mailbox.status}, skipping scan`);
                return;
            }
            // Skip mailboxes with unrecoverable errors (revoked tokens, insufficient scopes)
            // These require user action (reconnect) — retrying wastes resources and floods logs
            if (mailbox.status === 'error' && mailbox.last_scan_error) {
                const unrecoverable = ['invalid_grant', 'Insufficient Permission', 'Token has been expired or revoked'];
                if (unrecoverable.some(e => mailbox.last_scan_error.includes(e))) {
                    console.log(`[Cron] Mailbox ${mailboxId} has unrecoverable error, skipping: ${mailbox.last_scan_error.substring(0, 80)}`);
                    return;
                }
            }
            // 1b. Check subscription status - skip if trial expired or subscription inactive
            const subscription = await prisma_1.prisma.subscription.findUnique({
                where: { user_id: userId },
                select: { status: true, trial_end: true, current_period_end: true },
            });
            if (subscription) {
                const now = new Date();
                if (subscription.status === 'trialing' && subscription.trial_end) {
                    if (subscription.trial_end < now) {
                        console.log(`[Cron] User ${userId} trial expired (ended ${subscription.trial_end.toISOString()}), skipping scan for mailbox ${mailboxId}`);
                        return;
                    }
                }
                if (subscription.status === 'cancelled' && subscription.current_period_end < now) {
                    console.log(`[Cron] User ${userId} subscription cancelled and expired, skipping scan for mailbox ${mailboxId}`);
                    return;
                }
            }
            else {
                // No subscription at all — skip scan
                console.log(`[Cron] User ${userId} has no subscription, skipping scan for mailbox ${mailboxId}`);
                return;
            }
            // 2. Proactive token refresh: if token is expired or expires within 5 minutes, refresh first
            if (mailbox.token_expires_at) {
                const fiveMinutesFromNow = new Date(Date.now() + 5 * 60 * 1000);
                if (mailbox.token_expires_at <= fiveMinutesFromNow) {
                    console.log(`[Cron] Token for mailbox ${mailboxId} expires at ${mailbox.token_expires_at.toISOString()}, refreshing proactively...`);
                    try {
                        if (mailbox.provider === 'outlook') {
                            await (0, outlook_token_refresh_1.refreshOutlookToken)(mailboxId);
                        }
                        else if (mailbox.provider === 'gmail') {
                            await (0, gmail_token_refresh_1.refreshGmailToken)(mailboxId);
                        }
                        console.log(`[Cron] ✓ Proactive token refresh succeeded for mailbox ${mailboxId}`);
                    }
                    catch (refreshError) {
                        console.error(`[Cron] ✗ Proactive token refresh failed for mailbox ${mailboxId}:`, refreshError.message);
                        // Continue anyway - scanMailbox has its own retry logic
                    }
                }
            }
            // 3. Run the scan using the main scanMailbox function
            const result = await (0, scanner_service_1.scanMailbox)(mailboxId, userId, {
                maxResults: 100,
                afterDate: mailbox.last_scan_at || undefined,
            });
            // 4. On success: reset error tracking
            if (result.errors.length === 0 || result.scannedCount > 0) {
                await prisma_1.prisma.mailbox.update({
                    where: { id: mailboxId },
                    data: {
                        consecutive_scan_failures: 0,
                        last_scan_error: null,
                        status: 'active', // Recover from error state on successful scan
                    },
                });
                console.log(`[Cron] ✓ Scan completed for mailbox ${mailboxId}: ${result.newMessages} new messages, ${result.legitFound} legit found`);
            }
            else {
                // Scan returned but with only errors (no messages processed)
                const errorMsg = result.errors.join('; ').substring(0, 500);
                const currentFailures = (mailbox.consecutive_scan_failures || 0) + 1;
                await prisma_1.prisma.mailbox.update({
                    where: { id: mailboxId },
                    data: {
                        consecutive_scan_failures: currentFailures,
                        last_scan_error: errorMsg,
                        status: currentFailures >= 5 ? 'error' : 'active',
                    },
                });
                console.warn(`[Cron] ⚠ Scan for mailbox ${mailboxId} returned errors (failure #${currentFailures}): ${errorMsg}`);
            }
        }
        catch (error) {
            // 5. On failure: track consecutive failures
            console.error(`[Cron] ✗ Scheduled scan failed for mailbox ${mailboxId}:`, error.message);
            try {
                const currentMailbox = await prisma_1.prisma.mailbox.findUnique({
                    where: { id: mailboxId },
                    select: { consecutive_scan_failures: true },
                });
                const currentFailures = (currentMailbox?.consecutive_scan_failures || 0) + 1;
                await prisma_1.prisma.mailbox.update({
                    where: { id: mailboxId },
                    data: {
                        consecutive_scan_failures: currentFailures,
                        last_scan_error: (error.message || 'Unknown error').substring(0, 500),
                        status: currentFailures >= 5 ? 'error' : 'active',
                    },
                });
                if (currentFailures >= 5) {
                    console.error(`[Cron] ❌ Mailbox ${mailboxId} marked as 'error' after ${currentFailures} consecutive scan failures`);
                }
            }
            catch (updateError) {
                console.error(`[Cron] Failed to update error tracking for mailbox ${mailboxId}:`, updateError);
            }
        }
    });
    activeCronJobs.set(jobId, {
        id: jobId,
        task,
        mailboxId,
        schedule,
    });
    console.log(`Scheduled cron job ${jobId} for mailbox ${mailboxId} with schedule: ${schedule}`);
    return jobId;
}
/**
 * Cancel a scheduled scan
 * @param jobId - ID of the job to cancel
 */
function cancelScan(jobId) {
    const job = activeCronJobs.get(jobId);
    if (!job) {
        throw new Error('Job not found');
    }
    job.task.stop();
    activeCronJobs.delete(jobId);
    console.log(`Cancelled cron job ${jobId}`);
}
/**
 * Cancel all scans for a mailbox
 * @param mailboxId - ID of the mailbox
 */
function cancelMailboxScans(mailboxId) {
    const jobs = Array.from(activeCronJobs.values()).filter((job) => job.mailboxId === mailboxId);
    jobs.forEach((job) => {
        job.task.stop();
        activeCronJobs.delete(job.id);
        console.log(`Cancelled cron job ${job.id} for mailbox ${mailboxId}`);
    });
}
/**
 * Get all active jobs
 */
function getActiveJobs() {
    return Array.from(activeCronJobs.values()).map((job) => ({
        id: job.id,
        mailboxId: job.mailboxId,
        schedule: job.schedule,
        task: job.task,
    }));
}
/**
 * [REMOVED] Old performScan function was deleted - cron now uses scanMailbox from scanner.service.ts
 */
/**
 * Schedule ML model retraining via cron
 * Runs every 2 hours — checks triggers (feedback threshold, scheduled interval, accuracy drop)
 * and retrains if needed. No BullMQ/Redis required.
 */
function scheduleMLRetraining() {
    const mlRetrainingJob = node_cron_1.default.schedule('0 */2 * * *', async () => {
        console.log('[ML Cron] Running ML retraining check...');
        try {
            // Lazy import to avoid pulling in @tensorflow/tfjs-node at startup
            const { retrainingWorker } = await Promise.resolve().then(() => __importStar(require('./ml-retraining-scheduler.service')));
            await retrainingWorker();
            console.log('[ML Cron] ML retraining check completed');
        }
        catch (error) {
            console.error('[ML Cron] ML retraining failed:', error.message);
        }
    });
    mlRetrainingJob.start();
    console.log('[ML Cron] ✅ ML retraining scheduled (every 2 hours)');
}
/**
 * Schedule data cleanup jobs
 * Runs daily to clean up expired message content
 */
function scheduleDataCleanup() {
    // Daily cleanup at 2 AM UTC (soft delete - keeps metadata)
    const dailyCleanup = node_cron_1.default.schedule('0 2 * * *', async () => {
        console.log('[Cleanup] Running daily message cleanup...');
        try {
            const result = await prisma_1.prisma.$queryRaw `
        SELECT cleanup_expired_messages() as cleaned_count
      `;
            const cleanedCount = result[0]?.cleaned_count || 0;
            console.log(`[Cleanup] ✅ Cleaned ${cleanedCount} expired messages`);
        }
        catch (error) {
            console.error('[Cleanup] ❌ Daily cleanup failed:', error);
        }
    });
    // Weekly hard delete at 3 AM UTC Sunday (completely remove 180+ day old messages)
    const weeklyDelete = node_cron_1.default.schedule('0 3 * * 0', async () => {
        console.log('[Cleanup] Running weekly message deletion...');
        try {
            const result = await prisma_1.prisma.$queryRaw `
        SELECT delete_old_messages() as deleted_count
      `;
            const deletedCount = result[0]?.deleted_count || 0;
            console.log(`[Cleanup] ✅ Deleted ${deletedCount} old messages (180+ days)`);
        }
        catch (error) {
            console.error('[Cleanup] ❌ Weekly delete failed:', error);
        }
    });
    dailyCleanup.start();
    weeklyDelete.start();
    console.log('[Cleanup] ✅ Data cleanup jobs scheduled:');
    console.log('  - Daily soft cleanup: 2 AM UTC');
    console.log('  - Weekly hard delete: 3 AM UTC Sunday');
}
/**
 * Send auto-move suggestion emails to eligible users
 * Users who have reached the threshold but haven't been emailed yet
 */
async function sendAutoMoveSuggestionEmails() {
    console.log('[AutoMove Email] Checking for users who should receive auto-move suggestion email...');
    try {
        // Get system settings for threshold
        const systemSettings = await prisma_1.prisma.systemSettings.findFirst();
        const threshold = systemSettings?.auto_move_suggestion_threshold || 20;
        const suggestionEnabled = systemSettings?.auto_move_suggestion_enabled ?? true;
        if (!suggestionEnabled) {
            console.log('[AutoMove Email] Auto-move suggestion is disabled by admin');
            return;
        }
        // Find users who:
        // 1. Have a user context (completed onboarding)
        // 2. Don't have auto_move enabled yet
        // 3. Haven't dismissed the suggestion
        // 4. Haven't been emailed yet
        // 5. Have reviewed enough emails
        const eligibleUsers = await prisma_1.prisma.$queryRaw `
      SELECT
        uc.user_id,
        u.email as user_email,
        u.name as user_name,
        COUNT(m.id)::int as review_count
      FROM user_contexts uc
      JOIN users u ON u.id = uc.user_id
      LEFT JOIN mailboxes mb ON mb.user_id = uc.user_id
      LEFT JOIN messages m ON m.mailbox_id = mb.id AND m.user_verdict IS NOT NULL
      WHERE
        (uc.spam_handling IS NULL OR uc.spam_handling != 'auto_move')
        AND (uc.auto_move_prompt_dismissed IS NULL OR uc.auto_move_prompt_dismissed = false)
        AND uc.auto_move_email_sent_at IS NULL
        AND (uc.auto_move_prompt_remind_at IS NULL OR uc.auto_move_prompt_remind_at <= NOW())
      GROUP BY uc.user_id, u.email, u.name
      HAVING COUNT(m.id) >= ${threshold}
    `;
        console.log(`[AutoMove Email] Found ${eligibleUsers.length} users eligible for auto-move suggestion email`);
        for (const user of eligibleUsers) {
            try {
                // Send the email
                (0, email_service_1.sendAutoMoveSuggestionEmailAsync)({
                    recipientEmail: user.user_email,
                    recipientName: user.user_name || undefined,
                    reviewCount: user.review_count,
                    enableUrl: `${(config_1.config.appUrl || config_1.config.frontendUrl)}/messages?enable_auto_move=true`,
                    settingsUrl: `${(config_1.config.appUrl || config_1.config.frontendUrl)}/settings`,
                });
                // Mark as emailed
                await prisma_1.prisma.userContext.update({
                    where: { user_id: user.user_id },
                    data: { auto_move_email_sent_at: new Date() },
                });
                console.log(`[AutoMove Email] ✓ Sent auto-move suggestion email to ${user.user_email}`);
            }
            catch (error) {
                console.error(`[AutoMove Email] Failed to send email to ${user.user_email}:`, error);
            }
        }
        console.log('[AutoMove Email] ✓ Auto-move suggestion email job completed');
    }
    catch (error) {
        console.error('[AutoMove Email] ❌ Error sending auto-move suggestion emails:', error);
    }
}
/**
 * Schedule auto-move suggestion email job
 * Runs daily at 10 AM UTC to check for eligible users
 */
function scheduleAutoMoveSuggestionEmails() {
    const dailyEmailJob = node_cron_1.default.schedule('0 10 * * *', async () => {
        await sendAutoMoveSuggestionEmails();
    });
    dailyEmailJob.start();
    console.log('[AutoMove Email] ✅ Auto-move suggestion email job scheduled: 10 AM UTC daily');
}
/**
 * Send weekly recap emails to opted-in users
 * Gathers stats from the past 7 days and sends a summary email
 */
async function sendWeeklyRecapEmails() {
    console.log('[Weekly Recap] Starting weekly recap email job...');
    try {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
        const periodStart = sevenDaysAgo.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        const periodEnd = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        // Find users with weekly recap enabled
        const usersWithRecap = await prisma_1.prisma.notificationPreferences.findMany({
            where: { weekly_recap_enabled: true },
            select: { user_id: true },
        });
        if (usersWithRecap.length === 0) {
            console.log('[Weekly Recap] No users have weekly recap enabled');
            return;
        }
        console.log(`[Weekly Recap] Processing ${usersWithRecap.length} users...`);
        for (const pref of usersWithRecap) {
            try {
                const user = await prisma_1.prisma.user.findUnique({
                    where: { id: pref.user_id },
                    select: { id: true, email: true, name: true },
                });
                if (!user || !user.email)
                    continue;
                // Get user's mailbox IDs
                const mailboxes = await prisma_1.prisma.mailbox.findMany({
                    where: { user_id: user.id, status: 'active' },
                    select: { id: true },
                });
                if (mailboxes.length === 0)
                    continue;
                const mailboxIds = mailboxes.map(m => m.id);
                // Get weekly stats
                const messages = await prisma_1.prisma.message.findMany({
                    where: {
                        mailboxId: { in: mailboxIds },
                        createdAt: { gte: sevenDaysAgo },
                    },
                    select: {
                        verdict: true,
                        user_verdict: true,
                        senderEmail: true,
                    },
                });
                if (messages.length === 0)
                    continue; // Skip if no activity
                const totalScanned = messages.length;
                const legitFound = messages.filter(m => m.verdict === 'legit' || m.verdict === 'lead').length;
                const spamConfirmed = messages.filter(m => m.verdict === 'spam').length;
                const promotions = messages.filter(m => m.verdict === 'promotion').length;
                // Calculate accuracy from user verdicts
                const reviewed = messages.filter(m => m.user_verdict !== null);
                const correctPredictions = reviewed.filter(m => m.verdict === m.user_verdict).length;
                const accuracy = reviewed.length > 0
                    ? Math.round((correctPredictions / reviewed.length) * 100)
                    : 0;
                // Get top rescued senders (legit/lead verdicts)
                const legitMessages = messages.filter(m => m.verdict === 'legit' || m.verdict === 'lead');
                const senderCounts = new Map();
                for (const msg of legitMessages) {
                    senderCounts.set(msg.senderEmail, (senderCounts.get(msg.senderEmail) || 0) + 1);
                }
                const topSenders = Array.from(senderCounts.entries())
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .map(([email, count]) => ({ email, count }));
                (0, email_service_1.sendWeeklyRecapEmailAsync)({
                    recipientEmail: user.email,
                    recipientName: user.name || undefined,
                    totalScanned,
                    legitFound,
                    spamConfirmed,
                    promotions,
                    accuracy,
                    topSenders,
                    periodStart,
                    periodEnd,
                    dashboardUrl: `${(config_1.config.appUrl || config_1.config.frontendUrl)}/dashboard`,
                });
                console.log(`[Weekly Recap] ✓ Sent recap to ${user.email}`);
            }
            catch (error) {
                console.error(`[Weekly Recap] Failed for user ${pref.user_id}:`, error);
            }
        }
        console.log('[Weekly Recap] ✓ Weekly recap job completed');
    }
    catch (error) {
        console.error('[Weekly Recap] ❌ Weekly recap job failed:', error);
    }
}
/**
 * Schedule the weekly recap email job
 * Runs every Monday at 9 AM UTC
 */
function scheduleWeeklyRecapEmails() {
    const weeklyRecapJob = node_cron_1.default.schedule('0 9 * * 1', async () => {
        await sendWeeklyRecapEmails();
    });
    weeklyRecapJob.start();
    console.log('[Weekly Recap] ✅ Weekly recap email job scheduled: Mondays at 9 AM UTC');
}
/**
 * Schedule trial expiration email check
 * Runs daily at 8 AM UTC — finds expired trials and sends notification email
 */
function scheduleTrialExpirationCheck() {
    const trialExpirationJob = node_cron_1.default.schedule('0 8 * * *', async () => {
        console.log('[Trial Expiration] Checking for expired trials...');
        try {
            // Find subscriptions where trial has expired but email hasn't been sent yet
            const expiredTrials = await prisma_1.prisma.subscription.findMany({
                where: {
                    status: 'trialing',
                    trial_end: { lt: new Date() },
                    trial_expiration_email_sent_at: null,
                },
                include: {
                    user: {
                        select: { email: true, name: true },
                    },
                },
            });
            if (expiredTrials.length === 0) {
                console.log('[Trial Expiration] No expired trials found');
                return;
            }
            console.log(`[Trial Expiration] Found ${expiredTrials.length} expired trials`);
            for (const sub of expiredTrials) {
                try {
                    const { sendTrialExpiredEmailAsync } = await Promise.resolve().then(() => __importStar(require('./email.service')));
                    sendTrialExpiredEmailAsync({
                        recipientEmail: sub.user.email,
                        recipientName: sub.user.name || undefined,
                        planName: sub.plan.charAt(0).toUpperCase() + sub.plan.slice(1),
                        pricingUrl: `${(config_1.config.appUrl || config_1.config.frontendUrl)}/pricing`,
                    });
                    // Mark as sent so we don't send again
                    await prisma_1.prisma.subscription.update({
                        where: { id: sub.id },
                        data: { trial_expiration_email_sent_at: new Date() },
                    });
                    console.log(`[Trial Expiration] ✓ Sent trial expired email to ${sub.user.email}`);
                }
                catch (emailError) {
                    console.error(`[Trial Expiration] Failed to send email for subscription ${sub.id}:`, emailError.message);
                }
            }
            console.log('[Trial Expiration] ✓ Trial expiration check completed');
        }
        catch (error) {
            console.error('[Trial Expiration] ❌ Trial expiration check failed:', error.message);
        }
    });
    trialExpirationJob.start();
    console.log('[Trial Expiration] ✅ Trial expiration check scheduled: 8 AM UTC daily');
}
/**
 * Convert minutes to cron expression
 * @param minutes - Interval in minutes
 * @returns Cron expression string
 */
function minutesToCronExpression(minutes) {
    if (minutes <= 0 || minutes > 1440) {
        throw new Error('Invalid minutes value. Must be between 1 and 1440.');
    }
    // For intervals that divide evenly into 60, use minute-based cron
    if (minutes < 60 && 60 % minutes === 0) {
        return `*/${minutes} * * * *`; // Every X minutes
    }
    // For hourly intervals
    if (minutes === 60) {
        return '0 * * * *'; // Every hour at minute 0
    }
    // For intervals that are multiples of 60 (hourly intervals)
    if (minutes >= 60 && minutes % 60 === 0) {
        const hours = minutes / 60;
        if (24 % hours === 0) {
            return `0 */${hours} * * *`; // Every X hours at minute 0
        }
    }
    // For other intervals, approximate to the nearest hour-based schedule
    const hours = Math.round(minutes / 60);
    if (hours <= 1) {
        return '0 * * * *'; // Fallback to hourly
    }
    else if (hours >= 24) {
        return '0 0 * * *'; // Once daily at midnight
    }
    else {
        return `0 */${hours} * * *`; // Every X hours
    }
}
/**
 * Initialize cron jobs from database on startup
 */
async function initializeCronJobs() {
    try {
        // Get system-wide default scan frequency from settings
        let systemSettings = await prisma_1.prisma.systemSettings.findFirst();
        // Create default settings if none exist
        if (!systemSettings) {
            console.log('[Cron] Creating default system settings...');
            systemSettings = await prisma_1.prisma.systemSettings.create({
                data: {
                    ai_provider: 'openai',
                    default_scan_frequency_minutes: 60, // Default 1 hour
                },
            });
        }
        const scanFrequencyMinutes = systemSettings.default_scan_frequency_minutes || 60;
        const cronSchedule = minutesToCronExpression(scanFrequencyMinutes);
        console.log(`[Cron] System-wide scan frequency: ${scanFrequencyMinutes} minutes (cron: ${cronSchedule})`);
        // Get ALL active and error-state mailboxes (error mailboxes get scheduled too so they can recover)
        const mailboxes = await prisma_1.prisma.mailbox.findMany({
            where: {
                status: { in: ['active', 'error'] },
            },
            select: {
                id: true,
                user_id: true,
                email_address: true,
                status: true,
            },
        });
        console.log(`[Cron] Initializing scans for ${mailboxes.length} mailboxes (active + error)`);
        for (const mailbox of mailboxes) {
            try {
                scheduleScan(mailbox.id, mailbox.user_id, cronSchedule);
                console.log(`[Cron] ✓ Scheduled scan for ${mailbox.email_address} (${cronSchedule})`);
            }
            catch (error) {
                console.error(`[Cron] ✗ Failed to schedule scan for mailbox ${mailbox.id}:`, error);
            }
        }
        // Schedule ML retraining via cron (runs every 2 hours)
        scheduleMLRetraining();
        // Schedule data cleanup jobs
        scheduleDataCleanup();
        // Schedule auto-move suggestion emails
        scheduleAutoMoveSuggestionEmails();
        // Schedule weekly recap emails
        scheduleWeeklyRecapEmails();
        // Schedule trial expiration email check
        scheduleTrialExpirationCheck();
        console.log('[Cron] ✅ All cron jobs initialized successfully');
    }
    catch (error) {
        console.error('[Cron] ❌ Failed to initialize cron jobs:', error);
    }
}
/**
 * Restart all scan cron jobs with updated frequency
 * Call this when the admin changes the scan frequency setting
 */
async function restartScanCronJobs() {
    console.log('[Cron] Restarting scan cron jobs with new frequency...');
    // Stop all existing scan jobs
    const scanJobs = Array.from(activeCronJobs.entries()).filter(([key]) => key.startsWith('scan_'));
    for (const [jobId, job] of scanJobs) {
        job.task.stop();
        activeCronJobs.delete(jobId);
        console.log(`[Cron] Stopped job: ${jobId}`);
    }
    // Reinitialize with new frequency
    try {
        const systemSettings = await prisma_1.prisma.systemSettings.findFirst();
        const scanFrequencyMinutes = systemSettings?.default_scan_frequency_minutes || 60;
        const cronSchedule = minutesToCronExpression(scanFrequencyMinutes);
        const mailboxes = await prisma_1.prisma.mailbox.findMany({
            where: { status: { in: ['active', 'error'] } },
            select: { id: true, user_id: true, email_address: true },
        });
        for (const mailbox of mailboxes) {
            try {
                scheduleScan(mailbox.id, mailbox.user_id, cronSchedule);
                console.log(`[Cron] ✓ Rescheduled scan for ${mailbox.email_address}`);
            }
            catch (error) {
                console.error(`[Cron] ✗ Failed to reschedule scan for mailbox ${mailbox.id}:`, error);
            }
        }
        console.log(`[Cron] ✅ Restarted ${mailboxes.length} scan jobs with frequency: ${scanFrequencyMinutes} min`);
    }
    catch (error) {
        console.error('[Cron] ❌ Failed to restart scan cron jobs:', error);
    }
}
/**
 * Shutdown all cron jobs gracefully
 */
function shutdownCronJobs() {
    console.log('Shutting down all cron jobs');
    activeCronJobs.forEach((job) => {
        job.task.stop();
    });
    activeCronJobs.clear();
    console.log('All cron jobs stopped');
}
