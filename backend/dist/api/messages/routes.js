"use strict";
/**
 * Message Routes
 * Handles email message retrieval and management
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
exports.messageRoutes = void 0;
const zod_1 = require("zod");
const scanner_service_1 = require("../../services/scanner.service");
const gmail_service_1 = require("../../services/gmail.service");
const outlook_service_1 = require("../../services/outlook.service");
const prisma_1 = require("../../lib/prisma");
const email_action_token_1 = require("../../lib/email-action-token");
const config_1 = require("../../lib/config");
const ml_integration_service_1 = require("../../services/ml-integration.service");
const classifier_service_1 = require("../../services/classifier.service");
const scan_queue_service_1 = require("../../services/scan-queue.service");
const usage_service_1 = require("../../services/usage.service");
const subscription_service_1 = require("../../services/subscription.service");
const rate_limit_1 = require("../../middleware/rate-limit");
const subscription_guard_middleware_1 = require("../../middleware/subscription-guard.middleware");
const redis_1 = require("../../lib/redis");
const crypto_1 = __importDefault(require("crypto"));
// One-time auth code helper — prevents JWT from appearing in email-action redirect URLs
// Falls back to a short-lived JWT param if Redis is not configured
async function generateAuthCode(accessToken) {
    if (!redis_1.redis)
        return null;
    const code = crypto_1.default.randomBytes(32).toString('hex');
    await redis_1.redis.setex(`auth_code:${code}`, 60, accessToken);
    return code;
}
/**
 * Request validation schemas
 */
const scanMailboxSchema = zod_1.z.object({
    mailboxId: zod_1.z.string().uuid(),
});
const getMessagesSchema = zod_1.z.object({
    mailboxId: zod_1.z.string().uuid().optional(),
    verdict: zod_1.z.enum(['lead', 'spam', 'promotion', 'clean', 'legit']).optional(),
    reviewed: zod_1.z.enum(['true', 'false']).optional(),
    limit: zod_1.z.string().regex(/^\d+$/).optional(),
    offset: zod_1.z.string().regex(/^\d+$/).optional(),
    sender: zod_1.z.string().max(255).optional().transform(val => val ? val.trim() : val),
    subject: zod_1.z.string().max(500).optional().transform(val => val ? val.trim() : val),
    search: zod_1.z.string().max(500).optional().transform(val => val ? val.trim() : val),
    dateFrom: zod_1.z.string().datetime({ offset: true }).optional(),
    dateTo: zod_1.z.string().datetime({ offset: true }).optional(),
});
const updateVerdictSchema = zod_1.z.object({
    verdict: zod_1.z.enum(['lead', 'spam', 'promotion', 'clean', 'legit']),
});
const rescueMessageSchema = zod_1.z.object({
    action: zod_1.z.enum(['rescue', 'mark_spam']),
});
// Additional validation schemas
const messageIdSchema = zod_1.z.object({
    messageId: zod_1.z.string().uuid('Message ID must be a valid UUID'),
});
const mailboxIdSchema = zod_1.z.object({
    mailboxId: zod_1.z.string().uuid('Mailbox ID must be a valid UUID'),
});
const messageRoutes = async (app) => {
    /**
     * POST /api/messages/scan/:mailboxId - Trigger scan for specific mailbox (enqueued)
     */
    app.post('/scan/:mailboxId', {
        preHandler: [app.authenticate, (0, subscription_guard_middleware_1.requireActiveSubscription)(), rate_limit_1.expensiveRateLimiter],
    }, async (request, reply) => {
        try {
            const { mailboxId } = scanMailboxSchema.parse(request.params);
            const userId = request.user.userId;
            // Check subscription status before allowing scan
            const subStatus = await subscription_service_1.subscriptionService.checkSubscriptionStatus(userId);
            if (!subStatus.canUse) {
                return reply.status(403).send({
                    success: false,
                    error: subStatus.reason || 'Your subscription does not allow scanning',
                    code: subStatus.trialExpired ? 'TRIAL_EXPIRED' : 'SUBSCRIPTION_INACTIVE',
                });
            }
            console.log(`[API] Starting scan for mailbox ${mailboxId} (user ${userId})`);
            // Try to enqueue scan if queue is available, otherwise run synchronously
            try {
                const job = await (0, scan_queue_service_1.enqueueScan)(mailboxId, userId, {
                // No maxResults - fetch everything
                // No afterDate filter - get all emails from spam folder
                });
                console.log(`[API] Scan job ${job.id} enqueued for mailbox ${mailboxId}`);
                return reply.status(202).send({
                    success: true,
                    data: {
                        jobId: job.id,
                        message: 'Scan job enqueued successfully',
                        status: 'queued',
                    },
                });
            }
            catch (queueError) {
                // If queue is not available, run scan synchronously
                if (queueError.message.includes('Queue service is not available')) {
                    console.log(`[API] Queue not available, running scan synchronously for mailbox ${mailboxId}`);
                    const result = await (0, scanner_service_1.scanMailbox)(mailboxId, userId, {});
                    console.log(`[API] Synchronous scan completed for mailbox ${mailboxId}:`, result);
                    return reply.status(200).send({
                        success: true,
                        data: {
                            ...result,
                            message: 'Scan completed successfully',
                            status: 'completed',
                        },
                    });
                }
                // Re-throw if it's a different error
                throw queueError;
            }
        }
        catch (error) {
            console.error('[API] Error during scan:', error);
            if (error.message.includes('maximum')) {
                return reply.status(429).send({
                    success: false,
                    error: {
                        code: 'TOO_MANY_SCANS',
                        message: error.message,
                    },
                });
            }
            if (error.message === 'MAILBOX_NOT_FOUND') {
                return reply.status(404).send({
                    success: false,
                    error: 'Mailbox not found',
                });
            }
            // Return actionable error messages (e.g., scope/permission errors) directly
            const isActionableError = error.message?.includes('Insufficient Permission') ||
                error.message?.includes('re-authenticate') ||
                error.message?.includes('re-add');
            return reply.status(500).send({
                success: false,
                error: isActionableError ? error.message : 'Failed to scan mailbox',
                message: error.message,
            });
        }
    });
    /**
     * POST /api/messages/scan - Trigger scan for all user mailboxes
     */
    app.post('/scan', {
        preHandler: [app.authenticate, (0, subscription_guard_middleware_1.requireActiveSubscription)(), rate_limit_1.expensiveRateLimiter],
    }, async (request, reply) => {
        try {
            const userId = request.user.userId;
            // Check subscription status before allowing scan
            const subStatus = await subscription_service_1.subscriptionService.checkSubscriptionStatus(userId);
            if (!subStatus.canUse) {
                return reply.status(403).send({
                    success: false,
                    error: subStatus.reason || 'Your subscription does not allow scanning',
                    code: subStatus.trialExpired ? 'TRIAL_EXPIRED' : 'SUBSCRIPTION_INACTIVE',
                });
            }
            console.log(`[API] Scanning all mailboxes for user ${userId}`);
            // Manual user-initiated scans should fetch ALL emails to match Gmail/Outlook count exactly
            // No maxResults limit - we want to mirror the mailbox accurately
            console.log(`[API] Performing full scan (no limit) to match mailbox counts`);
            // Perform scan without limits
            const results = await (0, scanner_service_1.scanAllUserMailboxes)(userId, {
            // No maxResults - fetch everything from all mailboxes
            });
            const summary = {
                totalMailboxes: results.length,
                totalScanned: results.reduce((sum, r) => sum + r.scannedCount, 0),
                totalNewMessages: results.reduce((sum, r) => sum + r.newMessages, 0),
                totalNotSpam: results.reduce((sum, r) => sum + r.notSpamFound, 0),
                results,
            };
            // Increment usage counter
            if (summary.totalScanned > 0) {
                await usage_service_1.usageService.incrementUsage(userId, 'messagesScanned', summary.totalScanned);
            }
            // Get UPDATED usage percentage for warnings (after incrementing)
            const updatedUsage = await usage_service_1.usageService.getCurrentUsage(userId);
            const updatedPercentage = updatedUsage.limits.messagesScanned
                ? Math.round((updatedUsage.messagesScanned / updatedUsage.limits.messagesScanned) * 100)
                : 0;
            // Include usage warning in response
            const response = {
                success: true,
                data: summary,
            };
            // Add usage info
            response.usage = {
                messagesScanned: updatedUsage.messagesScanned,
                limit: updatedUsage.limits.messagesScanned,
                percentage: updatedPercentage,
            };
            // Add warning if approaching limit
            if (updatedPercentage >= 80 && updatedPercentage < 100) {
                response.warning = {
                    code: 'APPROACHING_LIMIT',
                    message: `You've used ${updatedPercentage}% of your monthly message scan limit`,
                    upgradeUrl: '/pricing',
                };
            }
            else if (updatedPercentage >= 100) {
                response.warning = {
                    code: 'LIMIT_REACHED',
                    message: `You've reached your monthly message scan limit`,
                    upgradeUrl: '/pricing',
                };
            }
            return reply.status(200).send(response);
        }
        catch (error) {
            console.error('[API] Error scanning mailboxes:', error);
            return reply.status(500).send({
                success: false,
                error: 'Failed to scan mailboxes',
                details: error.message,
            });
        }
    });
    /**
     * GET /api/messages/scan/status/:jobId - Get scan job status
     */
    app.get('/scan/status/:jobId', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const { jobId } = request.params;
            const userId = request.user.userId;
            const status = await (0, scan_queue_service_1.getScanJobStatus)(jobId);
            return reply.status(200).send({
                success: true,
                data: status,
            });
        }
        catch (error) {
            console.error('[API] Error getting scan status:', error);
            return reply.status(500).send({
                success: false,
                error: 'Failed to get scan status',
            });
        }
    });
    /**
     * GET /api/messages/scan/active - List active scan jobs for user
     */
    app.get('/scan/active', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user.userId;
            const activeScans = await (0, scan_queue_service_1.getUserActiveScans)(userId);
            return reply.status(200).send({
                success: true,
                data: {
                    scans: activeScans,
                    total: activeScans.length,
                },
            });
        }
        catch (error) {
            console.error('[API] Error getting active scans:', error);
            return reply.status(500).send({
                success: false,
                error: 'Failed to get active scans',
            });
        }
    });
    /**
     * DELETE /api/messages/scan/:jobId - Cancel a scan job
     */
    app.delete('/scan/:jobId', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const { jobId } = request.params;
            const userId = request.user.userId;
            const cancelled = await (0, scan_queue_service_1.cancelScan)(jobId, userId);
            if (!cancelled) {
                return reply.status(404).send({
                    success: false,
                    error: 'Scan job not found',
                });
            }
            return reply.status(200).send({
                success: true,
                data: {
                    message: 'Scan job cancelled successfully',
                },
            });
        }
        catch (error) {
            console.error('[API] Error cancelling scan:', error);
            if (error.message.includes('Unauthorized')) {
                return reply.status(403).send({
                    success: false,
                    error: error.message,
                });
            }
            return reply.status(500).send({
                success: false,
                error: 'Failed to cancel scan',
            });
        }
    });
    /**
     * POST /api/messages/reclassify - Re-run AI classification on existing messages
     */
    app.post('/reclassify', {
        preHandler: [app.authenticate, (0, subscription_guard_middleware_1.requireActiveSubscription)()],
        config: { rateLimit: { max: 5, timeWindow: '1 minute' } },
    }, async (request, reply) => {
        try {
            const userId = request.user.userId;
            if (!userId || typeof userId !== 'string') {
                return reply.status(401).send({ success: false, error: 'Invalid user identity' });
            }
            const { messageIds, mailboxId, all } = request.body || {};
            // Build query to fetch messages to reclassify
            const where = { mailbox: { user_id: userId } };
            if (messageIds && messageIds.length > 0) {
                // Reclassify specific messages (max 50 at a time)
                const validIds = messageIds.slice(0, 50).filter(id => typeof id === 'string' && id.length > 0);
                if (validIds.length === 0) {
                    return reply.status(400).send({ success: false, error: 'No valid message IDs provided' });
                }
                where.id = { in: validIds };
            }
            else if (mailboxId) {
                where.mailbox_id = mailboxId;
                // Only reclassify messages without user verdict (don't override manual reviews)
                where.user_verdict = null;
            }
            else if (all) {
                where.user_verdict = null;
            }
            else {
                return reply.status(400).send({ success: false, error: 'Provide messageIds, mailboxId, or all=true' });
            }
            // Fetch messages with body content for reclassification
            const messages = await prisma_1.prisma.message.findMany({
                where,
                select: {
                    id: true,
                    subject: true,
                    sender_email: true,
                    sender_name: true,
                    recipient_email: true,
                    body_text: true,
                    body_html: true,
                    verdict: true,
                    confidence_score: true,
                    received_at: true,
                    provider_message_id: true,
                    mailbox_id: true,
                },
                take: 50, // Process max 50 at a time
                orderBy: { received_at: 'desc' },
            });
            if (messages.length === 0) {
                return reply.status(200).send({ success: true, data: { reclassified: 0, message: 'No messages to reclassify' } });
            }
            let reclassified = 0;
            let changed = 0;
            for (const msg of messages) {
                try {
                    // Decrypt the message first
                    const decrypted = (0, scanner_service_1.decryptMessage)(msg);
                    // Reconstruct ParsedEmail from stored data
                    const parsedEmail = {
                        messageId: msg.provider_message_id,
                        subject: decrypted.subject || '',
                        from: decrypted.sender_name || decrypted.sender_email || '',
                        fromEmail: decrypted.sender_email || '',
                        to: decrypted.recipient_email || '',
                        date: new Date(msg.received_at),
                        bodyText: decrypted.body_text || '',
                        bodyHtml: decrypted.body_html || undefined,
                    };
                    // Re-run classification
                    const result = await (0, classifier_service_1.classifyEmailWithUserPreferences)(parsedEmail, userId, {
                        userSettings: { enable_ai_classification: true },
                    });
                    // Update message with new classification
                    const oldVerdict = msg.verdict;
                    await prisma_1.prisma.message.update({
                        where: { id: msg.id },
                        data: {
                            verdict: result.verdict,
                            confidence_score: result.confidence,
                            classification_reason: result.reason || `Reclassified: ${result.verdict}`,
                            priority: result.priority || 'medium',
                        },
                    });
                    reclassified++;
                    if (oldVerdict !== result.verdict)
                        changed++;
                }
                catch (err) {
                    console.error(`[Reclassify] Error reclassifying message ${msg.id}:`, err.message);
                }
            }
            return reply.status(200).send({
                success: true,
                data: {
                    reclassified,
                    changed,
                    total: messages.length,
                    message: `Reclassified ${reclassified} messages (${changed} changed verdict)`,
                },
            });
        }
        catch (error) {
            console.error('[API] Error reclassifying messages:', error);
            return reply.status(500).send({
                success: false,
                error: 'Failed to reclassify messages',
                details: error.message,
            });
        }
    });
    /**
     * GET /api/messages/email-action/:token - Handle email action from notification emails
     * IMPORTANT: This route MUST be registered BEFORE /:messageId to avoid route conflicts
     * No authentication required - uses secure token-based auth
     */
    app.get('/email-action/:token', async (request, reply) => {
        const frontendUrl = config_1.config.frontendUrl || 'http://localhost:53000';
        try {
            const { token } = request.params;
            // Validate and decode the action token
            const payload = (0, email_action_token_1.validateActionToken)(token);
            if (!payload) {
                // Token invalid or expired - redirect to error page
                return reply.redirect(`${frontendUrl}/email-action-result?status=error&message=Link+expired+or+invalid`);
            }
            const { messageId, mailboxId, userId, action } = payload;
            console.log(`[EmailAction] Processing action "${action}" for message ${messageId}`);
            // For "view" action, create a one-time auth code and redirect to magic-link exchange
            // CASA compliance: never put JWT tokens in redirect URLs (appear in logs/history)
            if (action === 'view') {
                const accessToken = app.jwt.sign({ userId, type: 'magic_link' }, { expiresIn: '5m' });
                const code = await generateAuthCode(accessToken);
                if (code) {
                    return reply.redirect(`${frontendUrl}/auth/magic-link?code=${encodeURIComponent(code)}&redirect=/messages/${messageId}`);
                }
                // Redis not available — fall back to short-lived token in URL
                return reply.redirect(`${frontendUrl}/auth/magic-link?token=${encodeURIComponent(accessToken)}&redirect=/messages/${messageId}`);
            }
            // Get message to verify it exists
            const message = await prisma_1.prisma.message.findFirst({
                where: {
                    id: messageId,
                    mailbox_id: mailboxId,
                    mailbox: { user_id: userId },
                },
                include: {
                    mailbox: { select: { provider: true } },
                },
            });
            if (!message) {
                return reply.redirect(`${frontendUrl}/email-action-result?status=error&message=Message+not+found`);
            }
            const provider = message.mailbox.provider;
            let resultMessage = '';
            // Handle the action
            switch (action) {
                case 'rescue':
                    // Move to inbox
                    try {
                        if (provider === 'gmail') {
                            await (0, gmail_service_1.rescueMessage)(mailboxId, userId, message.provider_message_id);
                        }
                        else if (provider === 'outlook') {
                            await (0, outlook_service_1.rescueMessage)(mailboxId, userId, message.provider_message_id);
                        }
                        // Delete from our database
                        await prisma_1.prisma.message.delete({ where: { id: messageId } }).catch(() => { });
                        resultMessage = 'Message+moved+to+inbox';
                    }
                    catch (err) {
                        if (err.message?.includes('not found') || err.message?.includes('404')) {
                            await prisma_1.prisma.message.delete({ where: { id: messageId } }).catch(() => { });
                            resultMessage = 'Message+already+moved+or+deleted';
                        }
                        else {
                            throw err;
                        }
                    }
                    break;
                case 'spam':
                case 'legit':
                case 'promotion':
                    // Update verdict
                    await (0, scanner_service_1.updateMessageVerdict)(messageId, userId, action === 'spam' ? 'spam' : action === 'legit' ? 'lead' : 'promotion');
                    resultMessage = `Message+marked+as+${action}`;
                    break;
                default:
                    return reply.redirect(`${frontendUrl}/email-action-result?status=error&message=Unknown+action`);
            }
            console.log(`[EmailAction] Successfully processed action "${action}" for message ${messageId}`);
            return reply.redirect(`${frontendUrl}/email-action-result?status=success&action=${action}&message=${resultMessage}`);
        }
        catch (error) {
            console.error('[EmailAction] Error processing email action:', error);
            return reply.redirect(`${frontendUrl}/email-action-result?status=error&message=Something+went+wrong`);
        }
    });
    /**
     * GET /api/messages - List messages with filters
     */
    app.get('/', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const query = getMessagesSchema.parse(request.query);
            const userId = request.user.userId;
            // SECURITY: Hard guard against undefined userId (Prisma skips undefined filters)
            if (!userId || typeof userId !== 'string') {
                return reply.status(401).send({ success: false, error: 'Invalid user identity' });
            }
            let result;
            // If mailboxId not provided, get all user's messages across all mailboxes in ONE query
            if (!query.mailboxId) {
                const limit = query.limit ? parseInt(query.limit) : 100;
                const offset = query.offset ? parseInt(query.offset) : 0;
                const verdict = query.verdict;
                const reviewed = query.reviewed === 'true' ? true : query.reviewed === 'false' ? false : undefined;
                // Build filter conditions for messages across all user mailboxes
                const andConditions = [
                    {
                        mailbox: {
                            user_id: userId, // Only messages from user's mailboxes
                        }
                    }
                ];
                // Add verdict filter if specified
                if (verdict) {
                    andConditions.push({
                        OR: [
                            { user_verdict: verdict },
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
                // Unified search filter (OR across sender_email, sender_name, subject)
                if (query.search) {
                    andConditions.push({
                        OR: [
                            { sender_email: { contains: query.search, mode: 'insensitive' } },
                            { sender_name: { contains: query.search, mode: 'insensitive' } },
                            { subject: { contains: query.search, mode: 'insensitive' } }
                        ]
                    });
                }
                // Add sender filter (legacy, still supported)
                if (query.sender) {
                    andConditions.push({
                        OR: [
                            { sender_email: { contains: query.sender, mode: 'insensitive' } },
                            { sender_name: { contains: query.sender, mode: 'insensitive' } }
                        ]
                    });
                }
                // Add subject filter (legacy, still supported)
                if (query.subject) {
                    andConditions.push({
                        subject: { contains: query.subject, mode: 'insensitive' }
                    });
                }
                // Add date range filter
                if (query.dateFrom || query.dateTo) {
                    const dateCondition = {};
                    if (query.dateFrom)
                        dateCondition.gte = new Date(query.dateFrom);
                    if (query.dateTo)
                        dateCondition.lte = new Date(query.dateTo);
                    andConditions.push({ received_at: dateCondition });
                }
                // Exclude records whose content was wiped by the retention job
                andConditions.push({ NOT: { subject: '[DELETED]' } });
                // Build final where clause
                const where = andConditions.length > 1 ? { AND: andConditions } : andConditions[0];
                // Fetch messages and total count in parallel with a SINGLE query
                // OPTIMIZATION: Only select fields needed for list view (exclude large body_text/body_html)
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
                // CRITICAL: Decrypt messages before returning to frontend
                const decryptedMessages = messages.map(msg => (0, scanner_service_1.decryptMessage)(msg));
                result = {
                    messages: decryptedMessages,
                    total,
                    limit,
                    offset,
                };
            }
            else {
                result = await (0, scanner_service_1.getMailboxMessages)(query.mailboxId, userId, {
                    verdict: query.verdict,
                    reviewed: query.reviewed === 'true' ? true : query.reviewed === 'false' ? false : undefined,
                    limit: query.limit ? parseInt(query.limit) : 100,
                    offset: query.offset ? parseInt(query.offset) : 0,
                    senderFilter: query.sender,
                    subjectFilter: query.subject,
                    search: query.search,
                    dateFrom: query.dateFrom ? new Date(query.dateFrom) : undefined,
                    dateTo: query.dateTo ? new Date(query.dateTo) : undefined,
                });
            }
            return reply.status(200).send({
                success: true,
                data: result,
            });
        }
        catch (error) {
            console.error('[API] Error fetching messages:', error);
            if (error.message === 'MAILBOX_NOT_FOUND') {
                return reply.status(404).send({
                    success: false,
                    error: 'Mailbox not found',
                });
            }
            return reply.status(500).send({
                success: false,
                error: 'Failed to fetch messages',
                details: error.message,
            });
        }
    });
    /**
     * GET /api/messages/:messageId - Get single message
     */
    app.get('/:messageId', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const { messageId } = messageIdSchema.parse(request.params);
            const userId = request.user.userId;
            const message = await (0, scanner_service_1.getMessage)(messageId, userId);
            return reply.status(200).send({
                success: true,
                data: { message },
            });
        }
        catch (error) {
            console.error('[API] Error fetching message:', error);
            if (error.message === 'MESSAGE_NOT_FOUND') {
                return reply.status(404).send({
                    success: false,
                    error: 'Message not found',
                });
            }
            // Check if it's a validation error
            if (error instanceof zod_1.z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid request parameters',
                    details: error.errors,
                });
            }
            return reply.status(500).send({
                success: false,
                error: 'Failed to fetch message',
                details: error.message,
            });
        }
    });
    /**
     * PATCH /api/messages/:messageId/verdict - Update user verdict
     */
    app.patch('/:messageId/verdict', {
        preHandler: [app.authenticate, (0, subscription_guard_middleware_1.requireActiveSubscription)()],
    }, async (request, reply) => {
        try {
            const { messageId } = messageIdSchema.parse(request.params);
            const { verdict } = updateVerdictSchema.parse(request.body);
            const userId = request.user.userId;
            // Get current message before update (for ML feedback)
            const currentMessage = await (0, scanner_service_1.getMessage)(messageId, userId);
            const originalVerdict = currentMessage.verdict;
            const originalConfidence = currentMessage.confidence_score || 0.5;
            // Update the verdict
            const message = await (0, scanner_service_1.updateMessageVerdict)(messageId, userId, verdict);
            // Record ML feedback for continuous learning
            // This runs in background and won't block the response
            (0, ml_integration_service_1.recordUserFeedback)(userId, messageId, verdict, originalVerdict, originalConfidence).catch(error => {
                app.log.error('[ML Feedback] Failed to record user feedback:', error);
            });
            return reply.status(200).send({
                success: true,
                data: { message },
            });
        }
        catch (error) {
            console.error('[API] Error updating verdict:', error);
            if (error.message === 'MESSAGE_NOT_FOUND') {
                return reply.status(404).send({
                    success: false,
                    error: 'Message not found',
                });
            }
            // Check if it's a validation error
            if (error instanceof zod_1.z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid request parameters',
                    details: error.errors,
                });
            }
            return reply.status(500).send({
                success: false,
                error: 'Failed to update verdict',
                details: error.message,
            });
        }
    });
    /**
     * PATCH /api/messages/:messageId/mark-read - Mark message as read
     */
    app.patch('/:messageId/mark-read', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const { messageId } = messageIdSchema.parse(request.params);
            const userId = request.user.userId;
            // Verify message belongs to user and mark as read
            const message = await prisma_1.prisma.message.findFirst({
                where: {
                    id: messageId,
                    mailbox: { user_id: userId },
                },
            });
            if (!message) {
                return reply.status(404).send({
                    success: false,
                    error: 'Message not found',
                });
            }
            // Update reviewed_at if not already set
            const updatedMessage = await prisma_1.prisma.message.update({
                where: { id: messageId },
                data: {
                    reviewed_at: message.reviewed_at || new Date(),
                },
            });
            return reply.status(200).send({
                success: true,
                data: { message: updatedMessage },
            });
        }
        catch (error) {
            console.error('[API] Error marking message as read:', error);
            if (error instanceof zod_1.z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid request parameters',
                    details: error.errors,
                });
            }
            return reply.status(500).send({
                success: false,
                error: 'Failed to mark message as read',
                details: error.message,
            });
        }
    });
    /**
     * POST /api/messages/:messageId/rescue - Rescue message from spam or mark as spam
     */
    app.post('/:messageId/rescue', {
        preHandler: [app.authenticate, (0, subscription_guard_middleware_1.requireActiveSubscription)()],
    }, async (request, reply) => {
        try {
            const { messageId } = messageIdSchema.parse(request.params);
            const { action } = rescueMessageSchema.parse(request.body);
            const userId = request.user.userId;
            console.log(`[API] Rescuing message ${messageId} for user ${userId}, action: ${action}`);
            // Get message to get mailbox ID and provider message ID
            const message = await (0, scanner_service_1.getMessage)(messageId, userId);
            console.log(`[API] Found message with mailbox_id: ${message.mailbox_id}, provider_message_id: ${message.provider_message_id}`);
            // Get mailbox to determine provider
            const mailbox = await prisma_1.prisma.mailbox.findUnique({
                where: { id: message.mailbox_id },
                select: { provider: true },
            });
            if (!mailbox) {
                return reply.status(404).send({
                    success: false,
                    error: 'Mailbox not found',
                });
            }
            console.log(`[API] Mailbox provider: ${mailbox.provider}`);
            // Call appropriate provider service
            if (mailbox.provider === 'gmail') {
                if (action === 'rescue') {
                    console.log(`[API] Calling rescueGmail for mailbox ${message.mailbox_id}, userId ${userId}, message ${message.provider_message_id}`);
                    try {
                        await (0, gmail_service_1.rescueMessage)(message.mailbox_id, userId, message.provider_message_id);
                    }
                    catch (error) {
                        // If message not found in provider, it's already deleted/moved - this is OK
                        if (error.message && (error.message.includes('not found') ||
                            error.message.includes('Requested entity') ||
                            error.message.includes('Not Found') ||
                            error.message.includes('404'))) {
                            console.log(`[API] Gmail message ${message.provider_message_id} not found in provider (already moved/deleted)`);
                            // Continue - will delete from database
                        }
                        // If the error is authentication-related, try to refresh the token and retry
                        else if (error.message.toLowerCase().includes('access') || error.message.includes('Invalid Credentials') || error.message.includes('401') || error.message.includes('403')) {
                            console.log(`[API] Gmail authentication failed, attempting to refresh token for mailbox ${message.mailbox_id}`);
                            try {
                                await Promise.resolve().then(() => __importStar(require('../../services/gmail-token-refresh'))).then(module => module.refreshGmailToken(message.mailbox_id));
                                // Retry the operation after token refresh
                                await (0, gmail_service_1.rescueMessage)(message.mailbox_id, userId, message.provider_message_id);
                            }
                            catch (refreshError) {
                                console.error(`[API] Failed to refresh Gmail token:`, refreshError);
                                throw new Error(`Failed to rescue message after token refresh attempt: ${refreshError.message}`);
                            }
                        }
                        else {
                            throw error;
                        }
                    }
                }
                else {
                    console.log(`[API] Calling deleteGmail for mailbox ${message.mailbox_id}, userId ${userId}, message ${message.provider_message_id}`);
                    try {
                        await (0, gmail_service_1.deleteMessage)(message.mailbox_id, userId, message.provider_message_id);
                    }
                    catch (error) {
                        // If message not found in provider, it's already deleted - this is OK
                        if (error.message && (error.message.includes('not found') ||
                            error.message.includes('Requested entity') ||
                            error.message.includes('Not Found') ||
                            error.message.includes('404'))) {
                            console.log(`[API] Gmail message ${message.provider_message_id} not found in provider (already deleted)`);
                            // Continue - will delete from database
                        }
                        // If the error is authentication-related, try to refresh the token and retry
                        else if (error.message.toLowerCase().includes('access') || error.message.includes('Invalid Credentials') || error.message.includes('401') || error.message.includes('403')) {
                            console.log(`[API] Gmail authentication failed, attempting to refresh token for mailbox ${message.mailbox_id}`);
                            try {
                                await Promise.resolve().then(() => __importStar(require('../../services/gmail-token-refresh'))).then(module => module.refreshGmailToken(message.mailbox_id));
                                // Retry the operation after token refresh
                                await (0, gmail_service_1.deleteMessage)(message.mailbox_id, userId, message.provider_message_id);
                            }
                            catch (refreshError) {
                                console.error(`[API] Failed to refresh Gmail token:`, refreshError);
                                throw new Error(`Failed to delete message after token refresh attempt: ${refreshError.message}`);
                            }
                        }
                        else {
                            throw error;
                        }
                    }
                    console.log(`[API] Gmail delete operation completed (with or without error handling)`);
                }
            }
            else if (mailbox.provider === 'outlook') {
                if (action === 'rescue') {
                    console.log(`[API] Calling rescueOutlook for mailbox ${message.mailbox_id}, userId ${userId}, message ${message.provider_message_id}`);
                    try {
                        await (0, outlook_service_1.rescueMessage)(message.mailbox_id, userId, message.provider_message_id);
                    }
                    catch (error) {
                        // If message not found in provider, it's already deleted/moved - this is OK
                        if (error.message && (error.message.includes('not found') ||
                            error.message.includes('Requested entity') ||
                            error.message.includes('Not Found') ||
                            error.message.includes('ErrorItemNotFound') ||
                            error.message.includes('404'))) {
                            console.log(`[API] Outlook message ${message.provider_message_id} not found in provider (already moved/deleted)`);
                            // Continue - will delete from database
                        }
                        // If the error is authentication-related, try to refresh the token and retry
                        else if (error.message && (error.message.includes('InvalidAuthenticationToken') ||
                            error.message.includes('Authentication failed') ||
                            error.message.toLowerCase().includes('access') ||
                            error.message.includes('401') ||
                            error.message.includes('403'))) {
                            console.log(`[API] Outlook authentication failed, attempting to refresh token for mailbox ${message.mailbox_id}`);
                            try {
                                await Promise.resolve().then(() => __importStar(require('../../services/outlook-token-refresh'))).then(module => module.refreshOutlookToken(message.mailbox_id));
                                // Retry the operation after token refresh
                                await (0, outlook_service_1.rescueMessage)(message.mailbox_id, userId, message.provider_message_id);
                            }
                            catch (refreshError) {
                                console.error(`[API] Failed to refresh Outlook token:`, refreshError);
                                throw new Error(`Failed to rescue message after token refresh attempt: ${refreshError.message}`);
                            }
                        }
                        else {
                            throw error;
                        }
                    }
                }
                else {
                    console.log(`[API] Calling deleteOutlook for mailbox ${message.mailbox_id}, userId ${userId}, message ${message.provider_message_id}`);
                    try {
                        await (0, outlook_service_1.deleteMessage)(message.mailbox_id, userId, message.provider_message_id);
                    }
                    catch (error) {
                        // If message not found in provider, it's already deleted - this is OK
                        if (error.message && (error.message.includes('not found') ||
                            error.message.includes('Requested entity') ||
                            error.message.includes('Not Found') ||
                            error.message.includes('ErrorItemNotFound') ||
                            error.message.includes('404'))) {
                            console.log(`[API] Outlook message ${message.provider_message_id} not found in provider (already deleted)`);
                            // Continue - will delete from database
                        }
                        // If the error is authentication-related, try to refresh the token and retry
                        else if (error.message && (error.message.includes('InvalidAuthenticationToken') ||
                            error.message.includes('Authentication failed') ||
                            error.message.toLowerCase().includes('access') ||
                            error.message.includes('401') ||
                            error.message.includes('403'))) {
                            console.log(`[API] Outlook authentication failed, attempting to refresh token for mailbox ${message.mailbox_id}`);
                            try {
                                await Promise.resolve().then(() => __importStar(require('../../services/outlook-token-refresh'))).then(module => module.refreshOutlookToken(message.mailbox_id));
                                // Retry the operation after token refresh
                                await (0, outlook_service_1.deleteMessage)(message.mailbox_id, userId, message.provider_message_id);
                            }
                            catch (refreshError) {
                                console.error(`[API] Failed to refresh Outlook token:`, refreshError);
                                throw new Error(`Failed to delete message after token refresh attempt: ${refreshError.message}`);
                            }
                        }
                        else {
                            throw error;
                        }
                    }
                }
            }
            else {
                return reply.status(400).send({
                    success: false,
                    error: `Unsupported provider: ${mailbox.provider}`,
                });
            }
            // After successful rescue/mark-as-spam, remove the message from the database
            // since it has been processed (moved to inbox or deleted in the email provider)
            console.log(`[API] About to delete message ${messageId} from database...`);
            try {
                await prisma_1.prisma.message.delete({
                    where: { id: message.id },
                });
                console.log(`[API] ✓ Successfully processed rescue action for message ${messageId} and removed from database`);
            }
            catch (deleteError) {
                // Message might already be deleted - this is OK
                if (deleteError.code === 'P2025') {
                    console.log(`[API] Message ${messageId} already deleted from database - skipping`);
                }
                else {
                    console.error(`[API] Error deleting message from database:`, deleteError);
                    throw deleteError;
                }
            }
            return reply.status(200).send({
                success: true,
                message: action === 'rescue' ? 'Message moved to inbox' : 'Message deleted',
            });
        }
        catch (error) {
            console.error('[API] Error rescuing message:', error);
            if (error.message === 'MESSAGE_NOT_FOUND') {
                return reply.status(404).send({
                    success: false,
                    error: 'Message not found',
                });
            }
            // Check if it's a validation error
            if (error instanceof zod_1.z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid request parameters',
                    details: error.errors,
                });
            }
            return reply.status(500).send({
                success: false,
                error: 'Failed to rescue message',
                details: error.message,
            });
        }
    });
    /**
     * GET /api/messages/stats/:mailboxId - Get mailbox statistics
     */
    app.get('/stats/:mailboxId', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const { mailboxId } = mailboxIdSchema.parse(request.params);
            const userId = request.user.userId;
            const stats = await (0, scanner_service_1.getMailboxStats)(mailboxId, userId);
            return reply.status(200).send({
                success: true,
                data: stats,
            });
        }
        catch (error) {
            console.error('[API] Error fetching stats:', error);
            if (error.message === 'MAILBOX_NOT_FOUND') {
                return reply.status(404).send({
                    success: false,
                    error: 'Mailbox not found',
                });
            }
            // Check if it's a validation error
            if (error instanceof zod_1.z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid request parameters',
                    details: error.errors,
                });
            }
            return reply.status(500).send({
                success: false,
                error: 'Failed to fetch statistics',
                details: error.message,
            });
        }
    });
};
exports.messageRoutes = messageRoutes;
