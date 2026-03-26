"use strict";
/**
 * Scanner Service
 * Orchestrates email scanning: fetch from email providers → classify → store in DB
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
exports.decryptMessage = decryptMessage;
exports.scanMailbox = scanMailbox;
exports.scanAllUserMailboxes = scanAllUserMailboxes;
exports.getMailboxMessages = getMailboxMessages;
exports.getMessage = getMessage;
exports.updateMessageVerdict = updateMessageVerdict;
exports.getMailboxStats = getMailboxStats;
exports.cleanupOldMessages = cleanupOldMessages;
const prisma_1 = require("../lib/prisma");
const gmail_service_1 = require("./gmail.service");
const outlook_service_1 = require("./outlook.service");
const classifier_service_1 = require("./classifier.service");
const mailbox_service_1 = require("./mailbox.service");
const email_service_1 = require("./email.service");
const sms_service_1 = require("./sms.service");
const slack_service_1 = require("./slack.service");
const telegram_service_1 = require("./telegram.service");
const webhook_service_1 = require("./webhook.service");
const config_1 = require("../lib/config");
const reputation_service_1 = require("./reputation.service");
const metrics_service_1 = require("./metrics.service");
const usage_service_1 = require("./usage.service");
const logger_1 = require("../lib/logger");
const extract_unsubscribe_url_1 = require("../utils/extract-unsubscribe-url");
const encryption_1 = require("../lib/encryption");
const email_action_token_1 = require("../lib/email-action-token");
/**
 * Helper function to decrypt message fields
 * EXPORTED so it can be used in API routes
 */
function decryptMessage(message) {
    if (!message)
        return message;
    try {
        return {
            ...message,
            subject: message.subject ? (0, encryption_1.decryptEmail)(message.subject) : message.subject,
            body_text: message.body_text ? (0, encryption_1.decryptEmail)(message.body_text) : message.body_text,
            body_html: message.body_html ? (0, encryption_1.decryptEmail)(message.body_html) : message.body_html,
        };
    }
    catch (error) {
        logger_1.logger.error('[Scanner] Failed to decrypt message:', error);
        return message; // Return original if decryption fails
    }
}
/**
 * Compare DB messages against what is currently in the user's monitored folders.
 * Any message no longer present on the server is soft-deleted via removed_from_server_at
 * so the UI immediately reflects the user's actual folder state.
 */
async function reconcileRemovedMessages(mailboxId, userId, provider, monitoredFolders) {
    let liveIds;
    try {
        if (provider === 'gmail') {
            liveIds = await (0, gmail_service_1.listAllMessageIds)(mailboxId, userId, monitoredFolders);
        }
        else {
            // Outlook support: skip reconciliation silently until implemented
            logger_1.logger.warn(`[Reconcile] Provider "${provider}" not yet supported, skipping`);
            return 0;
        }
    }
    catch (err) {
        // Non-fatal: if the provider call fails, skip this cycle rather than marking everything removed
        logger_1.logger.error(`[Reconcile] Failed to list live IDs for mailbox ${mailboxId}:`, err.message);
        return 0;
    }
    // Load all DB messages that haven't already been marked removed
    const dbMessages = await prisma_1.prisma.message.findMany({
        where: { mailbox_id: mailboxId, removed_from_server_at: null },
        select: { id: true, provider_message_id: true },
    });
    const staleIds = dbMessages
        .filter(m => !liveIds.has(m.provider_message_id))
        .map(m => m.id);
    if (staleIds.length === 0) return 0;
    await prisma_1.prisma.message.updateMany({
        where: { id: { in: staleIds } },
        data: { removed_from_server_at: new Date() },
    });
    logger_1.logger.debug(`[Reconcile] Marked ${staleIds.length} messages as removed for mailbox ${mailboxId}`);
    return staleIds.length;
}
/**
 * Scan a mailbox for spam emails and classify them
 */
async function scanMailbox(mailboxId, userId, options = {}) {
    const errors = [];
    let scannedCount = 0;
    let newMessages = 0;
    let legitFound = 0;
    let spamFiltered = 0;
    let promotions = 0;
    try {
        logger_1.logger.debug(`[Scanner] Starting scan for mailbox ${mailboxId}`);
        // Get mailbox to determine provider and monitored folders
        const mailbox = await (0, mailbox_service_1.getMailboxWithTokens)(mailboxId, userId);
        const monitoredFolders = mailbox.monitored_folders || ['spam'];
        // Log notification settings for debugging
        logger_1.logger.debug(`[Scanner] Mailbox notification settings: notification_enabled=${mailbox.notification_enabled}, notification_channels=${JSON.stringify(mailbox.notification_channels)}, provider=${mailbox.provider}`);
        // Get user info for notifications
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: userId },
            select: {
                email: true,
                name: true,
                phone: true,
                phone_verified: true,
                slack_webhook_url: true,
                telegram_chat_id: true,
            },
        });
        // Fetch user's classification settings (if any)
        let userSettings = null;
        try {
            userSettings = await prisma_1.prisma.classificationSettings.findUnique({
                where: { user_id: userId },
            });
        }
        catch (error) {
            logger_1.logger.warn('[Scanner] Failed to fetch classification settings:', error);
        }
        // Fetch spam messages based on provider
        let messages = [];
        let parsedEmails = [];
        // Helper function to fetch messages with automatic token refresh on auth errors
        const fetchMessagesWithRetry = async () => {
            try {
                if (mailbox.provider === 'gmail') {
                    logger_1.logger.debug(`[Scanner] Fetching messages from Gmail spam folder...`);
                    const gmailMessages = await (0, gmail_service_1.fetchSpamMessages)(mailboxId, userId, {
                        ...options,
                        monitoredFolders,
                    });
                    messages = gmailMessages;
                    logger_1.logger.debug(`[Scanner] ✅ Fetched ${messages.length} messages from Gmail`);
                    parsedEmails = gmailMessages.map(msg => ({ raw: msg, parsed: (0, gmail_service_1.parseGmailMessage)(msg) }));
                }
                else if (mailbox.provider === 'outlook') {
                    logger_1.logger.debug(`[Scanner] Fetching messages from Outlook junk folder...`);
                    const outlookMessages = await (0, outlook_service_1.fetchSpamMessages)(mailboxId, userId, {
                        ...options,
                        monitoredFolders,
                    });
                    messages = outlookMessages;
                    logger_1.logger.debug(`[Scanner] ✅ Fetched ${messages.length} messages from Outlook`);
                    parsedEmails = outlookMessages.map(msg => ({ raw: msg, parsed: (0, outlook_service_1.parseOutlookMessage)(msg) }));
                }
                else {
                    throw new Error(`Unsupported provider: ${mailbox.provider}`);
                }
            }
            catch (error) {
                const errMsg = error.message || '';
                // Unrecoverable errors: token revoked, scopes insufficient, grant invalid.
                // Token refresh can NOT fix these — user must disconnect and reconnect.
                const isUnrecoverable = errMsg.includes('Insufficient Permission') ||
                    errMsg.includes('invalid_grant') ||
                    errMsg.includes('Token has been expired or revoked');
                if (isUnrecoverable) {
                    const userMsg = 'Please disconnect and re-add your mailbox to grant the required permissions.';
                    logger_1.logger.error(`[Scanner] ❌ Unrecoverable error for mailbox ${mailboxId}: ${errMsg}`);
                    await prisma_1.prisma.mailbox.update({
                        where: { id: mailboxId },
                        data: {
                            status: 'error',
                            last_scan_error: `${errMsg.substring(0, 200)} — ${userMsg}`,
                        },
                    });
                    throw new Error(userMsg);
                }
                // Check if it's an authentication error (token expired/revoked — fixable by refresh)
                const isAuthError = errMsg.includes('Invalid Credentials') ||
                    errMsg.includes('InvalidAuthenticationToken') ||
                    errMsg.includes('Authentication failed') ||
                    errMsg.includes('Unauthorized') ||
                    errMsg.includes('401') ||
                    errMsg.includes('JWT') ||
                    errMsg.includes('token') ||
                    errMsg.includes('CompactToken') ||
                    errMsg.includes('AADSTS') ||
                    errMsg.includes('invalid_grant') ||
                    errMsg.includes('interaction_required') ||
                    error.statusCode === 401 || error.statusCode === 403;
                if (isAuthError) {
                    logger_1.logger.debug(`[Scanner] Authentication error detected, attempting to refresh token for mailbox ${mailboxId}`);
                    // Try to refresh the token
                    try {
                        if (mailbox.provider === 'gmail') {
                            await Promise.resolve().then(() => __importStar(require('../services/gmail-token-refresh'))).then(module => module.refreshGmailToken(mailbox.id));
                        }
                        else if (mailbox.provider === 'outlook') {
                            await Promise.resolve().then(() => __importStar(require('../services/outlook-token-refresh'))).then(module => module.refreshOutlookToken(mailbox.id));
                        }
                        logger_1.logger.debug(`[Scanner] Token refreshed, retrying fetch...`);
                        // Retry fetching after token refresh
                        if (mailbox.provider === 'gmail') {
                            const gmailMessages = await (0, gmail_service_1.fetchSpamMessages)(mailboxId, userId, {
                                ...options,
                                monitoredFolders,
                            });
                            messages = gmailMessages;
                            logger_1.logger.debug(`[Scanner] ✅ Fetched ${messages.length} messages from Gmail after token refresh`);
                            parsedEmails = gmailMessages.map(msg => ({ raw: msg, parsed: (0, gmail_service_1.parseGmailMessage)(msg) }));
                        }
                        else if (mailbox.provider === 'outlook') {
                            const outlookMessages = await (0, outlook_service_1.fetchSpamMessages)(mailboxId, userId, {
                                ...options,
                                monitoredFolders,
                            });
                            messages = outlookMessages;
                            logger_1.logger.debug(`[Scanner] ✅ Fetched ${messages.length} messages from Outlook after token refresh`);
                            parsedEmails = outlookMessages.map(msg => ({ raw: msg, parsed: (0, outlook_service_1.parseOutlookMessage)(msg) }));
                        }
                    }
                    catch (refreshError) {
                        logger_1.logger.error(`[Scanner] Failed to fetch messages after token refresh:`, refreshError.message);
                        throw new Error(`Authentication token expired. Please re-authenticate your mailbox. ${refreshError.message}`);
                    }
                }
                else {
                    // Not an auth error, just rethrow
                    throw error;
                }
            }
        };
        await fetchMessagesWithRetry();
        scannedCount = messages.length;
        logger_1.logger.debug(`[Scanner] 📊 Scan summary: ${scannedCount} total messages to process`);
        if (messages.length === 0) {
            await (0, mailbox_service_1.updateLastSync)(mailboxId);
            return {
                mailboxId,
                scannedCount: 0,
                newMessages: 0,
                legitFound: 0,
                spamFiltered: 0,
                promotions: 0,
                errors: [],
            };
        }
        // BATCH OPTIMIZATION: Check all existing messages in ONE query
        const providerMessageIds = parsedEmails.map(({ raw }) => raw.id);
        const existingMessages = await prisma_1.prisma.message.findMany({
            where: {
                mailbox_id: mailboxId,
                provider_message_id: { in: providerMessageIds },
            },
            select: { provider_message_id: true },
        });
        const existingMessageIds = new Set(existingMessages.map(m => m.provider_message_id));
        logger_1.logger.debug(`[Scanner] 🔍 Batch checked ${providerMessageIds.length} messages, found ${existingMessageIds.size} existing`);
        // BATCH OPTIMIZATION: Fetch all sender reputations in ONE batch query
        const uniqueSenders = [...new Set(parsedEmails.map(({ parsed }) => parsed.fromEmail))];
        const reputations = await Promise.all(uniqueSenders.map(email => (0, reputation_service_1.getSenderReputation)(userId, email)));
        const reputationMap = new Map(uniqueSenders.map((email, idx) => [email, reputations[idx]]));
        logger_1.logger.debug(`[Scanner] 📊 Batch fetched ${uniqueSenders.length} sender reputations`);
        // Process each message
        let skippedCount = 0;
        let createdCount = 0;
        let totalMessagesScanned = 0;
        let totalAiClassifications = 0;
        for (const { raw, parsed: parsedEmail } of parsedEmails) {
            try {
                // Skip already scanned messages to avoid duplicate processing
                if (existingMessageIds.has(raw.id)) {
                    skippedCount++;
                    logger_1.logger.debug(`[Scanner] ⏭️  Skipping existing message [${skippedCount}]: "${parsedEmail.subject.substring(0, 50)}..."`);
                    continue;
                }
                // Get sender reputation from pre-fetched map (no additional query!)
                const reputation = reputationMap.get(parsedEmail.fromEmail);
                // Classify email using hybrid AI+Rules approach with user preferences and learning
                logger_1.logger.debug(`[Scanner] USE_AI_CLASSIFICATION: ${classifier_service_1.USE_AI_CLASSIFICATION} - calling ${classifier_service_1.USE_AI_CLASSIFICATION ? 'classifyEmailWithUserPreferences (AI path)' : 'classifyEmail (rules only)'}`);
                const classification = classifier_service_1.USE_AI_CLASSIFICATION
                    ? await (0, classifier_service_1.classifyEmailWithUserPreferences)(parsedEmail, userId, {
                        userId,
                        senderEmail: parsedEmail.fromEmail,
                        senderReputation: reputation?.reputation_score,
                    })
                    : (0, classifier_service_1.classifyEmail)(parsedEmail);
                logger_1.logger.debug(`[Scanner] Classification result: ${classification.verdict} @ ${(classification.confidence * 100).toFixed(0)}%`);
                // Declare newMessage outside try block so it's accessible in notification code
                let newMessage = null;
                // Store new message in database
                try {
                    // Extract unsubscribe URL from email content (especially for promotional emails)
                    const unsubscribeUrl = (0, extract_unsubscribe_url_1.extractUnsubscribeUrl)(parsedEmail.bodyHtml || null, parsedEmail.bodyText);
                    // Create new message (existing messages were already skipped above)
                    // Validate critical fields before storing - log warnings if empty
                    if (!parsedEmail.bodyText || parsedEmail.bodyText.trim().length === 0) {
                        logger_1.logger.warn(`[Scanner] ⚠️ WARNING: Empty body_text for message "${parsedEmail.subject.substring(0, 50)}" from ${parsedEmail.fromEmail}. HasHtml: ${!!parsedEmail.bodyHtml}, HtmlLength: ${(parsedEmail.bodyHtml || '').length}`);
                    }
                    if (!parsedEmail.to || parsedEmail.to.trim().length === 0) {
                        logger_1.logger.warn(`[Scanner] ⚠️ WARNING: Empty recipient_email for message "${parsedEmail.subject.substring(0, 50)}" from ${parsedEmail.fromEmail}`);
                    }
                    // Check for duplicate before creating (avoids noisy prisma:error logs from P2002)
                    const existingMessage = await prisma_1.prisma.message.findFirst({
                        where: { mailbox_id: mailboxId, provider_message_id: raw.id },
                        select: { id: true },
                    });
                    if (existingMessage) {
                        logger_1.logger.debug(`[Scanner] Duplicate message, skipping: ${raw.id}`);
                        continue;
                    }
                    // Encrypt sensitive fields before storing
                    const encryptedSubject = (0, encryption_1.encryptEmail)(parsedEmail.subject);
                    const encryptedBodyText = (0, encryption_1.encryptEmail)(parsedEmail.bodyText);
                    const encryptedBodyHtml = parsedEmail.bodyHtml ? (0, encryption_1.encryptEmail)(parsedEmail.bodyHtml) : null;
                    newMessage = await prisma_1.prisma.message.create({
                        data: {
                            mailbox_id: mailboxId,
                            provider_message_id: raw.id,
                            subject: encryptedSubject,
                            sender_email: parsedEmail.fromEmail,
                            sender_name: parsedEmail.from,
                            recipient_email: parsedEmail.to,
                            body_text: encryptedBodyText,
                            body_html: encryptedBodyHtml,
                            unsubscribe_url: unsubscribeUrl,
                            verdict: classification.verdict,
                            priority: classification.priority,
                            confidence_score: classification.confidence || 0.0,
                            classification_reason: classification.reason,
                            received_at: parsedEmail.date,
                        },
                    });
                    newMessages++;
                    createdCount++;
                    logger_1.logger.debug(`[Scanner] ✅ Created message [${createdCount}]: "${parsedEmail.subject.substring(0, 50)}..." → ${classification.verdict}`);
                    // BATCH OPTIMIZATION: Track totals for batch update after loop
                    totalMessagesScanned++;
                    if (classifier_service_1.USE_AI_CLASSIFICATION) {
                        totalAiClassifications++;
                    }
                }
                catch (dbError) {
                    // Handle unique constraint violations gracefully (race condition fallback)
                    if (dbError.code === 'P2002') {
                        continue;
                    }
                    throw dbError; // Re-throw other errors
                }
                // Update sender reputation based on AI classification
                (0, reputation_service_1.updateReputation)({
                    userId,
                    senderEmail: parsedEmail.fromEmail,
                    verdict: classification.verdict,
                }).catch(err => logger_1.logger.error('[Scanner] Failed to update reputation:', err));
                // Track stats and send notifications for legit
                switch (classification.verdict) {
                    case 'legit':
                        legitFound++; // Increment count of legit emails found
                        logger_1.logger.debug(`[Scanner] 🎯 LEGIT detected: "${parsedEmail.subject}" from ${parsedEmail.fromEmail} (confidence: ${(classification.confidence * 100).toFixed(0)}%)`);
                        // ALWAYS send notifications for legit emails (core functionality)
                        // Log all the conditions for debugging
                        logger_1.logger.debug(`[Scanner] 📬 LEGIT NOTIFICATION CHECK:`);
                        logger_1.logger.debug(`  - notification_enabled: ${mailbox.notification_enabled}`);
                        logger_1.logger.debug(`  - notification_channels: ${JSON.stringify(mailbox.notification_channels)}`);
                        logger_1.logger.debug(`  - newMessage exists: ${!!newMessage}`);
                        logger_1.logger.debug(`  - newMessage.id: ${newMessage?.id || 'N/A'}`);
                        // Send webhook regardless of mailbox settings (webhooks are separate)
                        if (newMessage) {
                            (0, webhook_service_1.sendWebhookEvent)(userId, 'legit.found', {
                                messageId: newMessage.id,
                                subject: newMessage.subject,
                                from: newMessage.sender_email,
                                priority: classification.priority,
                                confidence: classification.confidence,
                            }).catch(err => logger_1.logger.error('[Scanner] Failed to send legit.found webhook:', err));
                        }
                        // Check email notification eligibility
                        // Default to true if notification_channels is undefined or empty (backwards compatibility)
                        const emailNotificationEnabled = mailbox.notification_channels?.includes('email') ??
                            (mailbox.notification_channels === undefined || mailbox.notification_channels === null || mailbox.notification_channels.length === 0);
                        logger_1.logger.debug(`[Scanner] Email notification eligibility: ${emailNotificationEnabled}`);
                        // Send email notification if enabled (or if channels not configured = default to email)
                        if (mailbox.notification_enabled !== false && newMessage && emailNotificationEnabled) {
                            // Generate action URLs for quick actions from email
                            const actionUrls = (0, email_action_token_1.generateActionUrls)(newMessage.id, mailboxId, userId, config_1.config.apiUrl);
                            // Send notification to the mailbox email (not user.email) since each mailbox may be different
                            logger_1.logger.debug(`[Scanner] 📧 Sending LEGIT notification email to ${mailbox.email_address} for message "${parsedEmail.subject.substring(0, 50)}..."`);
                            (0, email_service_1.sendNotSpamNotification)({
                                recipientEmail: mailbox.email_address,
                                recipientName: user?.name || undefined,
                                notSpamSubject: parsedEmail.subject,
                                notSpamFrom: parsedEmail.from || 'Unknown',
                                notSpamSenderEmail: parsedEmail.fromEmail,
                                notSpamPriority: classification.priority,
                                notSpamConfidence: classification.confidence,
                                notSpamSnippet: parsedEmail.bodyText.substring(0, 200) + (parsedEmail.bodyText.length > 200 ? '...' : ''),
                                messageUrl: `${config_1.config.appUrl || config_1.config.frontendUrl}/messages/${newMessage.id}`,
                                actionUrls,
                            }).then(() => {
                                logger_1.logger.debug(`[Scanner] ✅ LEGIT notification email sent successfully`);
                            }).catch(err => {
                                logger_1.logger.error('[Scanner] ❌ Failed to send LEGIT notification email:', err);
                            });
                        }
                        else {
                            logger_1.logger.debug(`[Scanner] ⏭️ LEGIT notification skipped:`);
                            logger_1.logger.debug(`  - notification_enabled: ${mailbox.notification_enabled}`);
                            logger_1.logger.debug(`  - newMessage: ${!!newMessage}`);
                            logger_1.logger.debug(`  - emailNotificationEnabled: ${emailNotificationEnabled}`);
                        }
                        // Additional notifications (SMS, Slack, Telegram) - only if newMessage exists
                        if (newMessage) {
                            // Send SMS notification for high-confidence not_spam
                            const smsNotificationEnabled = mailbox.notification_channels?.includes('sms');
                            if (user?.phone && user?.phone_verified && smsNotificationEnabled && classification.confidence >= 0.8) {
                                (0, sms_service_1.sendSMSNotSpamAlert)({
                                    recipientPhone: user.phone,
                                    notSpamSubject: parsedEmail.subject,
                                    notSpamFrom: parsedEmail.from || 'Unknown',
                                    notSpamSenderEmail: parsedEmail.fromEmail,
                                    notSpamConfidence: classification.confidence,
                                    messageId: newMessage.id,
                                    userId,
                                }).catch(err => logger_1.logger.error('[Scanner] Failed to send SMS alert:', err));
                            }
                            // Send Slack notification if webhook configured
                            const slackNotificationEnabled = mailbox.notification_channels?.includes('slack');
                            if (user?.slack_webhook_url && slackNotificationEnabled) {
                                (0, slack_service_1.sendSlackNotSpamAlert)({
                                    slackWebhookUrl: user.slack_webhook_url,
                                    notSpamSubject: parsedEmail.subject,
                                    notSpamFrom: parsedEmail.from || 'Unknown',
                                    notSpamSenderEmail: parsedEmail.fromEmail,
                                    notSpamConfidence: classification.confidence,
                                    notSpamPriority: classification.priority,
                                    notSpamSnippet: parsedEmail.bodyText.substring(0, 200) + (parsedEmail.bodyText.length > 200 ? '...' : ''),
                                    messageId: newMessage.id,
                                    userId,
                                }).catch(err => logger_1.logger.error('[Scanner] Failed to send Slack alert:', err));
                            }
                            // Send Telegram notification if chat ID configured
                            const telegramNotificationEnabled = mailbox.notification_channels?.includes('telegram');
                            if (user?.telegram_chat_id && telegramNotificationEnabled) {
                                (0, telegram_service_1.sendTelegramLeadAlert)({
                                    telegramChatId: user.telegram_chat_id,
                                    legitSubject: parsedEmail.subject,
                                    legitFrom: parsedEmail.from || 'Unknown',
                                    legitSenderEmail: parsedEmail.fromEmail,
                                    legitConfidence: classification.confidence,
                                    legitPriority: classification.priority,
                                    legitSnippet: parsedEmail.bodyText.substring(0, 200) + (parsedEmail.bodyText.length > 200 ? '...' : ''),
                                    messageId: newMessage.id,
                                    userId,
                                }).catch(err => logger_1.logger.error('[Scanner] Failed to send Telegram alert:', err));
                            }
                            // PLATFORM WHITELIST AUTO-RESCUE: MyInboxer emails should ALWAYS go to inbox
                            const { isPlatformWhitelisted } = await Promise.resolve().then(() => __importStar(require('../lib/trusted-domains')));
                            if (isPlatformWhitelisted(parsedEmail.fromEmail)) {
                                logger_1.logger.debug(`[Scanner] 🚀 AUTO-RESCUE: ${parsedEmail.fromEmail} is platform whitelisted - moving to inbox automatically`);
                                try {
                                    // Auto-rescue based on provider
                                    if (mailbox.provider === 'gmail') {
                                        await (0, gmail_service_1.rescueMessage)(mailboxId, userId, raw.id);
                                        logger_1.logger.debug(`[Scanner] ✅ Successfully auto-rescued Gmail message ${raw.id} to inbox`);
                                    }
                                    else if (mailbox.provider === 'outlook') {
                                        await (0, outlook_service_1.rescueMessage)(mailboxId, userId, raw.id);
                                        logger_1.logger.debug(`[Scanner] ✅ Successfully auto-rescued Outlook message ${raw.id} to inbox`);
                                    }
                                    // Delete from database since it's been moved to inbox
                                    if (newMessage?.id) {
                                        await prisma_1.prisma.message.delete({ where: { id: newMessage.id } });
                                        logger_1.logger.debug(`[Scanner] ✅ Removed auto-rescued message from spam database`);
                                    }
                                }
                                catch (rescueError) {
                                    logger_1.logger.error(`[Scanner] ⚠️ Failed to auto-rescue platform whitelisted email:`, rescueError.message);
                                    // Don't fail the whole scan - just log the error
                                }
                            }
                        }
                        break;
                    case 'spam':
                        spamFiltered++;
                        break;
                    case 'promotion':
                        promotions++;
                        break;
                }
            }
            catch (error) {
                logger_1.logger.error(`[Scanner] ❌ Error processing message ${raw.id}:`, error);
                errors.push(`Message ${raw.id}: ${error.message}`);
            }
        }
        // BATCH OPTIMIZATION: Update usage tracking ONCE after processing all messages
        if (totalMessagesScanned > 0) {
            await usage_service_1.usageService.incrementUsage(userId, 'messagesScanned', totalMessagesScanned);
            logger_1.logger.debug(`[Scanner] 📊 Batch updated usage: ${totalMessagesScanned} messages scanned`);
        }
        if (totalAiClassifications > 0) {
            await usage_service_1.usageService.incrementUsage(userId, 'aiClassifications', totalAiClassifications);
            logger_1.logger.debug(`[Scanner] 🤖 Batch updated usage: ${totalAiClassifications} AI classifications`);
        }
        // Check and send usage warnings once after all processing
        if (totalMessagesScanned > 0 || totalAiClassifications > 0) {
            await usage_service_1.usageService.checkAndSendUsageWarnings(userId).catch(err => logger_1.logger.warn('[Scanner] Failed to check usage warnings:', err));
        }
        logger_1.logger.debug(`\n[Scanner] 📊 Processing Summary:`);
        logger_1.logger.debug(`  - Fetched from provider: ${messages.length}`);
        logger_1.logger.debug(`  - Skipped (already in DB): ${skippedCount}`);
        logger_1.logger.debug(`  - Created (new): ${createdCount}`);
        logger_1.logger.debug(`  - Errors: ${errors.length}`);
        logger_1.logger.debug(`  - Expected DB total: ${26 + createdCount} (was 26)\n`);
        // SYNC: Mark messages removed from the server so the UI mirrors the user's folder exactly
        await reconcileRemovedMessages(mailboxId, userId, mailbox.provider, mailbox.monitored_folders || ['spam']);
        // Get total count for logging
        const totalDbMessages = await prisma_1.prisma.message.count({
            where: { mailbox_id: mailboxId, removed_from_server_at: null }
        });
        // Simply update the last scan timestamp
        await (0, mailbox_service_1.updateLastSync)(mailboxId);
        logger_1.logger.debug(`[Scanner] 💾 All ${totalDbMessages} historical messages preserved in database (no auto-deletion)`);
        logger_1.logger.debug(`[Scanner] Scan complete: ${newMessages} new messages, ${legitFound} legit found`);
        // Send scan complete notifications if enabled and legit emails were found
        if (mailbox.notification_enabled && legitFound > 0) {
            // Send scan.complete webhook
            (0, webhook_service_1.sendWebhookEvent)(userId, 'scan.complete', {
                mailboxId,
                messagesProcessed: scannedCount,
                legitFound,
                scanTimestamp: new Date().toISOString(),
            }).catch(err => logger_1.logger.error('[Scanner] Failed to send scan.complete webhook:', err));
            // Send scan complete email notification to the mailbox that was scanned (not user.email)
            const emailNotificationEnabled = mailbox.notification_channels?.includes('email');
            if (emailNotificationEnabled) {
                (0, email_service_1.sendScanCompleteNotification)({
                    recipientEmail: mailbox.email_address,
                    recipientName: user?.name || undefined,
                    mailboxEmail: mailbox.email_address,
                    messagesProcessed: scannedCount,
                    notSpamFound: legitFound,
                    dashboardUrl: `${config_1.config.appUrl || config_1.config.frontendUrl}/dashboard`,
                }).catch(err => logger_1.logger.error('[Scanner] Failed to send scan complete email:', err));
            }
        }
        return {
            mailboxId,
            scannedCount,
            newMessages,
            legitFound,
            spamFiltered,
            promotions,
            errors,
        };
    }
    catch (error) {
        logger_1.logger.error(`[Scanner] Fatal error scanning mailbox ${mailboxId}:`, error);
        errors.push(`Fatal error: ${error.message}`);
        return {
            mailboxId,
            scannedCount,
            newMessages,
            legitFound,
            spamFiltered,
            promotions,
            errors,
        };
    }
}
/**
 * Scan all active mailboxes for a user
 */
async function scanAllUserMailboxes(userId, options = {}) {
    const mailboxes = await prisma_1.prisma.mailbox.findMany({
        where: {
            user_id: userId,
            status: 'active',
        },
    });
    logger_1.logger.debug(`[Scanner] Scanning ${mailboxes.length} mailboxes for user ${userId}`);
    const results = await Promise.all(mailboxes.map((mailbox) => scanMailbox(mailbox.id, userId, {
        maxResults: options.maxResults || 100,
        // Only scan messages from last 7 days on first scan
        afterDate: mailbox.last_scan_at || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
    })));
    return results;
}
/**
 * Get messages for a mailbox
 */
async function getMailboxMessages(mailboxId, userId, filters = {}) {
    // SECURITY: Guard against undefined userId (Prisma silently ignores undefined filters)
    if (!userId || typeof userId !== 'string') {
        throw new Error('UNAUTHORIZED: userId is required');
    }
    const { verdict, reviewed, limit = 50, offset = 0, senderFilter, subjectFilter, search, dateFrom, dateTo } = filters;
    // Verify mailbox belongs to user (optimized: only select id for verification)
    const mailbox = await prisma_1.prisma.mailbox.findFirst({
        where: {
            id: mailboxId,
            user_id: userId,
        },
        select: { id: true },
    });
    if (!mailbox) {
        throw new Error('MAILBOX_NOT_FOUND');
    }
    // Build filter conditions — exclude messages no longer on server or with wiped content
    const andConditions = [
        { mailbox_id: mailboxId },
        { removed_from_server_at: null },
        { NOT: { subject: '[DELETED]' } },
    ];
    // Add verdict filter if specified - prioritize user_verdict over AI verdict
    // Show messages where:
    // 1. User has overridden the verdict AND it matches the filter, OR
    // 2. User hasn't overridden AND AI verdict matches the filter
    if (verdict) {
        andConditions.push({
            OR: [
                // User has explicitly set this verdict
                { user_verdict: verdict },
                // User hasn't overridden, and AI verdict matches
                {
                    AND: [
                        { user_verdict: null },
                        { verdict: verdict }
                    ]
                }
            ]
        });
    }
    // Add reviewed filter
    if (reviewed !== undefined) {
        if (reviewed) {
            andConditions.push({ reviewed_at: { not: null } });
        }
        else {
            andConditions.push({ reviewed_at: null });
        }
    }
    // Add sender filter
    if (senderFilter) {
        andConditions.push({
            OR: [
                {
                    sender_email: {
                        contains: senderFilter,
                        mode: 'insensitive', // Case-insensitive search
                    },
                },
                {
                    sender_name: {
                        contains: senderFilter,
                        mode: 'insensitive', // Case-insensitive search
                    },
                }
            ]
        });
    }
    // Add subject filter
    if (subjectFilter) {
        andConditions.push({
            subject: {
                contains: subjectFilter,
                mode: 'insensitive', // Case-insensitive search
            }
        });
    }
    // Add unified search filter (OR across sender_email, sender_name, subject)
    if (search) {
        andConditions.push({
            OR: [
                { sender_email: { contains: search, mode: 'insensitive' } },
                { sender_name: { contains: search, mode: 'insensitive' } },
                { subject: { contains: search, mode: 'insensitive' } },
            ]
        });
    }
    // Add date range filter
    if (dateFrom || dateTo) {
        const dateCondition = {};
        if (dateFrom) {
            dateCondition.gte = dateFrom;
        }
        if (dateTo) {
            dateCondition.lte = dateTo;
        }
        andConditions.push({
            received_at: dateCondition
        });
    }
    // Build final where clause
    const where = andConditions.length > 1
        ? { AND: andConditions }
        : andConditions[0];
    // OPTIMIZATION: Only select fields needed for list view (exclude large body_text/body_html)
    // This dramatically reduces database egress - body content is fetched only when viewing single message
    const [messages, total] = await Promise.all([
        prisma_1.prisma.message.findMany({
            where,
            orderBy: [{ priority: 'asc' }, { received_at: 'desc' }],
            take: limit,
            skip: offset,
            select: {
                id: true,
                mailbox_id: true,
                subject: true,
                sender_email: true,
                sender_name: true,
                recipient_email: true,
                verdict: true,
                user_verdict: true,
                priority: true,
                confidence_score: true,
                classification_reason: true,
                received_at: true,
                reviewed_at: true,
                created_at: true,
                unsubscribe_url: true,
                // EXCLUDED: body_text, body_html - fetched only when viewing single message
            },
        }),
        prisma_1.prisma.message.count({ where }),
    ]);
    // Decrypt messages before returning (only subject needs decryption now since body is excluded)
    const decryptedMessages = messages.map(msg => decryptMessage(msg));
    return {
        messages: decryptedMessages,
        total,
        limit,
        offset,
    };
}
/**
 * Get message by ID
 */
async function getMessage(messageId, userId) {
    // SECURITY: Guard against undefined userId (Prisma silently ignores undefined filters)
    if (!userId || typeof userId !== 'string') {
        throw new Error('UNAUTHORIZED: userId is required');
    }
    const message = await prisma_1.prisma.message.findUnique({
        where: { id: messageId },
        include: {
            mailbox: {
                select: {
                    user_id: true,
                    email_address: true,
                    provider: true,
                },
            },
        },
    });
    if (!message || message.mailbox.user_id !== userId) {
        throw new Error('MESSAGE_NOT_FOUND');
    }
    // Decrypt message before returning
    return decryptMessage(message);
}
/**
 * Update user verdict for a message (manual classification)
 */
async function updateMessageVerdict(messageId, userId, rawVerdict) {
    // Normalize verdict: 'lead' and 'clean' map to 'legit' for move-to-inbox behavior
    const userVerdict = (rawVerdict === 'lead' || rawVerdict === 'clean') ? 'legit' : rawVerdict;
    const message = await getMessage(messageId, userId);
    // Get mailbox to check autoMoveOnClassify setting
    const mailbox = await prisma_1.prisma.mailbox.findUnique({
        where: { id: message.mailbox_id },
        select: {
            id: true,
            provider: true,
            auto_move_on_classify: true,
        },
    });
    if (!mailbox) {
        throw new Error('MAILBOX_NOT_FOUND');
    }
    // Update message with user verdict
    const updatedMessage = await prisma_1.prisma.message.update({
        where: { id: messageId },
        data: {
            user_verdict: userVerdict,
            reviewed_at: new Date(),
        },
    });
    // Track feedback for analytics
    const originalVerdict = message.verdict;
    const wasCorrect = originalVerdict === userVerdict;
    (0, metrics_service_1.trackFeedback)({
        userId,
        messageId: message.id,
        originalVerdict,
        userVerdict,
        wasCorrect,
        timestamp: new Date(),
    }).catch(err => logger_1.logger.warn('[Scanner] Failed to track feedback metric:', err));
    // Update reputation with user feedback
    const feedbackType = userVerdict === 'legit' ? 'confirm_legit' :
        userVerdict === 'spam' ? 'mark_spam' : undefined;
    (0, reputation_service_1.updateReputation)({
        userId,
        senderEmail: message.sender_email,
        verdict: userVerdict,
        userFeedback: feedbackType,
    }).catch(err => logger_1.logger.error('[Scanner] Failed to update reputation with user feedback:', err));
    // Auto-move message if setting is enabled
    if (mailbox.auto_move_on_classify) {
        const providerMessageId = message.provider_message_id;
        // Helper function to attempt move with token refresh retry
        const attemptMoveWithRetry = async (moveAction, actionName) => {
            try {
                await moveAction();
                logger_1.logger.debug(`[Auto-Move] ${actionName} for message ${messageId} (verdict: ${userVerdict})`);
            }
            catch (error) {
                // If authentication failed, try to refresh token and retry once
                const isAuthError = error.message?.includes('access') ||
                    error.message?.includes('Invalid Credentials') ||
                    error.message?.includes('InvalidAuthenticationToken') ||
                    error.message?.includes('Authentication failed') ||
                    error.message?.includes('401') ||
                    error.message?.includes('JWT');
                if (isAuthError) {
                    logger_1.logger.debug(`[Auto-Move] Authentication failed, attempting to refresh token for mailbox ${mailbox.id}`);
                    try {
                        // Dynamically import the appropriate token refresh module
                        if (mailbox.provider === 'gmail') {
                            await Promise.resolve().then(() => __importStar(require('../services/gmail-token-refresh'))).then(module => module.refreshGmailToken(mailbox.id));
                        }
                        else if (mailbox.provider === 'outlook') {
                            await Promise.resolve().then(() => __importStar(require('../services/outlook-token-refresh'))).then(module => module.refreshOutlookToken(mailbox.id));
                        }
                        // Retry the operation after token refresh
                        await moveAction();
                        logger_1.logger.debug(`[Auto-Move] ${actionName} for message ${messageId} after token refresh (verdict: ${userVerdict})`);
                    }
                    catch (refreshError) {
                        logger_1.logger.error(`[Auto-Move] Failed to ${actionName.toLowerCase()} after token refresh attempt:`, refreshError.message);
                        throw refreshError;
                    }
                }
                else {
                    throw error;
                }
            }
        };
        try {
            if (userVerdict === 'legit') {
                // Move to inbox - treat 'legit' as something to rescue
                if (mailbox.provider === 'gmail') {
                    await attemptMoveWithRetry(() => (0, gmail_service_1.rescueMessage)(mailbox.id, userId, providerMessageId), 'Moved to inbox');
                }
                else if (mailbox.provider === 'outlook') {
                    await attemptMoveWithRetry(() => (0, outlook_service_1.rescueMessage)(mailbox.id, userId, providerMessageId), 'Moved to inbox');
                }
            }
            else if (userVerdict === 'spam') {
                // Move to spam/trash
                if (mailbox.provider === 'gmail') {
                    await attemptMoveWithRetry(() => (0, gmail_service_1.markAsSpam)(mailbox.id, userId, providerMessageId), 'Moved to spam');
                }
                else if (mailbox.provider === 'outlook') {
                    await attemptMoveWithRetry(() => (0, outlook_service_1.markAsSpam)(mailbox.id, userId, providerMessageId), 'Moved to spam');
                }
            }
        }
        catch (moveError) {
            // Log error but don't fail the verdict update
            logger_1.logger.error(`[Auto-Move] Failed to move message ${messageId}:`, moveError.message);
        }
    }
    return updatedMessage;
}
/**
 * Get scan statistics for a mailbox
 */
async function getMailboxStats(mailboxId, userId) {
    // Verify mailbox belongs to user (optimized: only select needed fields)
    const mailbox = await prisma_1.prisma.mailbox.findFirst({
        where: {
            id: mailboxId,
            user_id: userId,
        },
        select: {
            id: true,
            last_scan_at: true,
        },
    });
    if (!mailbox) {
        throw new Error('MAILBOX_NOT_FOUND');
    }
    // Count by effective verdict (user_verdict takes precedence over AI verdict)
    // Base filter: present on server + content not wiped
    const activeBase = { mailbox_id: mailboxId, removed_from_server_at: null, NOT: { subject: '[DELETED]' } };
    const [total, legit, spam, promotions, unreviewed] = await Promise.all([
        prisma_1.prisma.message.count({ where: activeBase }),
        // Count legit: user_verdict = 'legit' OR (user_verdict is null AND verdict = 'legit')
        prisma_1.prisma.message.count({
            where: {
                ...activeBase,
                OR: [
                    { user_verdict: 'legit' },
                    { AND: [{ user_verdict: null }, { verdict: 'legit' }] }
                ]
            }
        }),
        // Count spam: user_verdict = 'spam' OR (user_verdict is null AND verdict = 'spam')
        prisma_1.prisma.message.count({
            where: {
                ...activeBase,
                OR: [
                    { user_verdict: 'spam' },
                    { AND: [{ user_verdict: null }, { verdict: 'spam' }] }
                ]
            }
        }),
        // Count promotions: user_verdict = 'promotion' OR (user_verdict is null AND verdict = 'promotion')
        prisma_1.prisma.message.count({
            where: {
                ...activeBase,
                OR: [
                    { user_verdict: 'promotion' },
                    { AND: [{ user_verdict: null }, { verdict: 'promotion' }] }
                ]
            }
        }),
        prisma_1.prisma.message.count({ where: { ...activeBase, reviewed_at: null } }),
    ]);
    return {
        total,
        totalLegit: legit, // Renamed for frontend consistency
        legit, // Keep for backwards compatibility
        spam,
        promotions,
        unreviewed,
        lastScanAt: mailbox.last_scan_at,
    };
}
/**
 * Delete old messages (data retention)
 */
async function cleanupOldMessages(daysToKeep = 30) {
    const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
    const deleted = await prisma_1.prisma.message.deleteMany({
        where: {
            created_at: {
                lt: cutoffDate,
            },
        },
    });
    logger_1.logger.debug(`[Scanner] Deleted ${deleted.count} messages older than ${daysToKeep} days`);
    return deleted.count;
}
