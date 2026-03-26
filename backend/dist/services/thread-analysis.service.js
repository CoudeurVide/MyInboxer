"use strict";
/**
 * Email Threading & Conversation Analysis Service
 * Phase 1 Improvement: Analyze email conversation context for better classification
 *
 * This service analyzes email threads to:
 * - Detect if an email is a reply to a user-sent message
 * - Track conversation length and engagement
 * - Identify conversation patterns (cold outreach vs ongoing business)
 * - Prevent marking replies from engaged senders as spam
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeEmailThread = analyzeEmailThread;
exports.applyThreadAnalysis = applyThreadAnalysis;
exports.getSenderThreadStats = getSenderThreadStats;
const prisma_1 = require("../lib/prisma");
const crypto_1 = __importDefault(require("crypto"));
const redis_1 = require("../lib/redis");
/**
 * Extract threading identifiers from email headers
 */
function extractThreadIdentifiers(email) {
    const headers = email.headers || {};
    return {
        messageId: headers['message-id'] || email.provider_message_id,
        inReplyTo: headers['in-reply-to'],
        references: headers['references']?.split(/\s+/).filter(Boolean) || [],
        subject: email.subject,
        senderEmail: email.fromEmail || email.sender_email,
        recipientEmail: email.to || email.recipient_email
    };
}
/**
 * Normalize subject line for thread matching
 * Removes Re:, Fwd:, etc. prefixes
 */
function normalizeSubject(subject) {
    return subject
        .replace(/^(re|fwd|fw|aw):\s*/gi, '')
        .trim()
        .toLowerCase();
}
/**
 * Find messages in the same thread
 */
async function findThreadMessages(identifiers, mailboxId, maxMessages = 20) {
    const conditions = [];
    // Match by message ID references
    if (identifiers.inReplyTo) {
        conditions.push({
            provider_message_id: identifiers.inReplyTo
        });
    }
    if (identifiers.references && identifiers.references.length > 0) {
        conditions.push({
            provider_message_id: { in: identifiers.references }
        });
    }
    // Match by subject and sender/recipient combination
    const normalizedSubject = normalizeSubject(identifiers.subject);
    if (normalizedSubject.length > 5) {
        conditions.push({
            AND: [
                // Subject matches (with fuzzy Re:/Fwd: handling)
                {
                    OR: [
                        { subject: { contains: normalizedSubject, mode: 'insensitive' } },
                        { subject: { startsWith: `Re: ${normalizedSubject}`, mode: 'insensitive' } },
                        { subject: { startsWith: `Fwd: ${normalizedSubject}`, mode: 'insensitive' } }
                    ]
                },
                // Same sender-recipient pair (bidirectional)
                {
                    OR: [
                        {
                            sender_email: identifiers.senderEmail,
                            recipient_email: identifiers.recipientEmail
                        },
                        {
                            sender_email: identifiers.recipientEmail,
                            recipient_email: identifiers.senderEmail
                        }
                    ]
                }
            ]
        });
    }
    // If no conditions, return empty (can't find thread)
    if (conditions.length === 0) {
        return [];
    }
    // Query database for thread messages
    const messages = await prisma_1.prisma.message.findMany({
        where: {
            mailbox_id: mailboxId,
            OR: conditions
        },
        orderBy: {
            received_at: 'asc'
        },
        take: maxMessages
    });
    return messages;
}
/**
 * Determine if user has engaged with this sender before
 * (Looks for messages FROM user TO this sender)
 */
async function checkUserEngagement(senderEmail, recipientEmail, // User's email
mailboxId) {
    // Count messages FROM user (recipient_email) TO sender (sender_email)
    // This indicates user replied to this sender
    const userReplies = await prisma_1.prisma.message.findMany({
        where: {
            mailbox_id: mailboxId,
            sender_email: recipientEmail, // User is sender
            recipient_email: senderEmail // External sender is recipient
        },
        orderBy: {
            received_at: 'desc'
        },
        take: 10
    });
    return {
        hasReplied: userReplies.length > 0,
        replyCount: userReplies.length,
        lastReplyAt: userReplies[0]?.received_at || null
    };
}
/**
 * Analyze email thread and conversation context (with Redis cache)
 */
async function analyzeEmailThread(email, // ParsedEmail or Message
mailboxId) {
    const identifiers = extractThreadIdentifiers(email);
    // Generate cache key based on message identifiers and mailbox
    // Using messageId or combination of subject + sender + recipient
    const cacheKeyData = identifiers.messageId ||
        `${identifiers.subject}:${identifiers.senderEmail}:${identifiers.recipientEmail}`;
    const threadId = crypto_1.default
        .createHash('sha256')
        .update(cacheKeyData)
        .digest('hex')
        .substring(0, 16); // First 16 chars for shorter key
    // Try cache first (30 minute TTL - thread context changes infrequently)
    const cached = await (0, redis_1.getFromCache)(redis_1.CacheKeys.thread(mailboxId, threadId));
    if (cached) {
        return cached;
    }
    // Find related messages in the same thread
    const threadMessages = await findThreadMessages(identifiers, mailboxId);
    const isReply = !!identifiers.inReplyTo ||
        identifiers.subject.toLowerCase().startsWith('re:') ||
        identifiers.subject.toLowerCase().startsWith('fwd:');
    // Check if this is a reply to something the user sent
    const userEngagement = await checkUserEngagement(identifiers.senderEmail, identifiers.recipientEmail, mailboxId);
    const isReplyToUser = isReply && userEngagement.hasReplied;
    const threadLength = threadMessages.length + 1; // Include current email
    // Get previous verdict (most recent message in thread)
    const previousVerdict = threadMessages.length > 0
        ? threadMessages[threadMessages.length - 1].verdict
        : null;
    // Determine who started the conversation
    let conversationStarter = 'unknown';
    if (threadMessages.length > 0) {
        const firstMessage = threadMessages[0];
        if (firstMessage.sender_email === identifiers.recipientEmail) {
            conversationStarter = 'user'; // User started conversation
        }
        else if (firstMessage.sender_email === identifiers.senderEmail) {
            conversationStarter = 'sender'; // External sender started
        }
    }
    // Calculate user engagement score (0-1)
    const engagementScore = userEngagement.hasReplied
        ? Math.min(1, 0.5 + (userEngagement.replyCount * 0.1))
        : 0;
    // Categorize thread type
    let threadCategory = 'unknown';
    let verdictAdjustment = 0;
    const reasons = [];
    // CRITICAL: If user replied to this sender, very high trust
    if (isReplyToUser && userEngagement.hasReplied) {
        threadCategory = 'ongoing_business';
        verdictAdjustment = +0.3; // Strong boost
        reasons.push(`User replied to this sender ${userEngagement.replyCount}x - ongoing conversation`);
    }
    // User started conversation with this sender
    else if (conversationStarter === 'user') {
        threadCategory = 'ongoing_business';
        verdictAdjustment = +0.25; // Strong boost
        reasons.push('User initiated conversation - trusted sender');
    }
    // Part of existing thread where user has engaged
    else if (threadLength > 2 && engagementScore > 0) {
        threadCategory = 'ongoing_business';
        verdictAdjustment = +0.2;
        reasons.push(`Part of ${threadLength}-message thread with user engagement`);
    }
    // Sender is following up but user hasn't replied (spam pattern if excessive)
    else if (isReply && threadLength > 3 && engagementScore === 0) {
        threadCategory = 'follow_up';
        verdictAdjustment = -0.15; // Penalty for aggressive follow-up
        reasons.push(`Aggressive follow-up (${threadLength} messages, no user reply) - likely spam`);
    }
    // Single follow-up without reply (moderate suspicion)
    else if (isReply && threadLength >= 2 && engagementScore === 0) {
        threadCategory = 'follow_up';
        verdictAdjustment = -0.05; // Small penalty
        reasons.push('Follow-up without user reply - monitor for spam');
    }
    // Cold outreach (first contact)
    else if (threadLength === 1 && !isReply) {
        threadCategory = 'cold_outreach';
        verdictAdjustment = 0; // Neutral (let other factors decide)
        reasons.push('First contact from sender - no thread history');
    }
    // Part of thread but inherit previous verdict
    else if (previousVerdict && threadLength > 1) {
        const inheritBonus = previousVerdict === 'legit' ? +0.1 : 0;
        verdictAdjustment = inheritBonus;
        reasons.push(`Part of thread (previous: ${previousVerdict})`);
    }
    const threadAnalysis = {
        isReply,
        isReplyToUser,
        threadLength,
        previousVerdict,
        conversationStarter,
        userEngagement: engagementScore,
        threadCategory,
        verdictAdjustment,
        reason: reasons.join('; ')
    };
    // Cache the thread analysis result (30 minutes TTL)
    await (0, redis_1.setInCache)(redis_1.CacheKeys.thread(mailboxId, threadId), threadAnalysis, 1800);
    return threadAnalysis;
}
/**
 * Adjust classification verdict based on thread analysis
 * This should be called AFTER base classification
 */
function applyThreadAnalysis(baseVerdict, baseConfidence, threadAnalysis) {
    let adjustedVerdict = baseVerdict;
    let adjustedConfidence = baseConfidence + threadAnalysis.verdictAdjustment;
    // CRITICAL OVERRIDE: If user replied to this sender, never mark as spam
    if (threadAnalysis.isReplyToUser && threadAnalysis.userEngagement > 0.5) {
        if (baseVerdict === 'spam' || baseVerdict === 'promotion') {
            adjustedVerdict = 'legit'; // Override to legit
            adjustedConfidence = Math.max(0.8, adjustedConfidence);
            console.log(`[Thread] Overriding ${baseVerdict} → legit (user engaged with sender)`);
        }
    }
    // CRITICAL OVERRIDE: If part of ongoing business conversation, trust it
    if (threadAnalysis.threadCategory === 'ongoing_business' &&
        threadAnalysis.conversationStarter === 'user') {
        if (baseVerdict === 'spam') {
            adjustedVerdict = 'legit'; // Override to legit
            adjustedConfidence = Math.max(0.75, adjustedConfidence);
            console.log(`[Thread] Overriding spam → legit (user-initiated conversation)`);
        }
    }
    // AGGRESSIVE FOLLOW-UP: If sender keeps following up with no reply, likely spam
    if (threadAnalysis.threadCategory === 'follow_up' &&
        threadAnalysis.threadLength > 3 &&
        threadAnalysis.userEngagement === 0) {
        if (baseVerdict === 'legit' || baseVerdict === 'clean') {
            adjustedVerdict = 'spam'; // Override to spam
            adjustedConfidence = Math.max(0.7, adjustedConfidence);
            console.log(`[Thread] Overriding ${baseVerdict} → spam (aggressive follow-up, no user reply)`);
        }
    }
    // Normalize confidence
    adjustedConfidence = Math.min(1, Math.max(0, adjustedConfidence));
    return {
        verdict: adjustedVerdict,
        confidence: adjustedConfidence,
        reason: threadAnalysis.reason
    };
}
/**
 * Get thread statistics for a sender
 * Useful for sender reputation and analytics
 */
async function getSenderThreadStats(senderEmail, mailboxId) {
    const messages = await prisma_1.prisma.message.findMany({
        where: {
            mailbox_id: mailboxId,
            sender_email: senderEmail
        },
        orderBy: {
            received_at: 'desc'
        },
        take: 100
    });
    // Group by normalized subject to identify threads
    const threadMap = new Map();
    messages.forEach(msg => {
        const normalizedSubj = normalizeSubject(msg.subject);
        if (!threadMap.has(normalizedSubj)) {
            threadMap.set(normalizedSubj, []);
        }
        threadMap.get(normalizedSubj).push(msg);
    });
    const totalThreads = threadMap.size;
    const totalMessages = messages.length;
    // Count threads where user replied
    let userRepliedThreads = 0;
    for (const [, threadMsgs] of threadMap) {
        const hasUserReply = threadMsgs.some(msg => msg.sender_email !== senderEmail // User sent a reply
        );
        if (hasUserReply)
            userRepliedThreads++;
    }
    const avgThreadLength = totalThreads > 0
        ? totalMessages / totalThreads
        : 0;
    const lastInteractionAt = messages.length > 0
        ? messages[0].received_at
        : null;
    return {
        totalThreads,
        totalMessages,
        userRepliedThreads,
        avgThreadLength,
        lastInteractionAt
    };
}
