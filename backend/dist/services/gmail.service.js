"use strict";
/**
 * Gmail Service
 * Handles Gmail API operations for fetching and scanning spam folder
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createGmailClient = createGmailClient;
exports.fetchSpamMessages = fetchSpamMessages;
exports.parseGmailMessage = parseGmailMessage;
exports.rescueMessage = rescueMessage;
exports.markAsSpam = markAsSpam;
exports.deleteMessage = deleteMessage;
exports.getSpamCount = getSpamCount;
exports.listAllMessageIds = listAllMessageIds;
const googleapis_1 = require("googleapis");
const config_1 = require("../lib/config");
const mailbox_service_1 = require("./mailbox.service");
const sanitization_1 = require("../lib/sanitization");
/**
 * Create Gmail API client with mailbox credentials
 */
async function createGmailClient(mailboxId, userId) {
    const mailbox = await (0, mailbox_service_1.getMailboxWithTokens)(mailboxId, userId);
    const oauth2Client = new googleapis_1.google.auth.OAuth2(config_1.config.oauth.google.clientId, config_1.config.oauth.google.clientSecret, config_1.config.oauth.google.redirectUri);
    oauth2Client.setCredentials({
        access_token: mailbox.accessToken,
        refresh_token: mailbox.refreshToken,
    });
    return googleapis_1.google.gmail({ version: 'v1', auth: oauth2Client });
}
/**
 * Map folder names to Gmail labels/categories
 */
function getFolderLabels(folders) {
    const labelMap = {
        spam: 'in:spam',
        promotions: 'category:promotions',
        updates: 'category:updates',
        social: 'category:social',
        forums: 'category:forums',
    };
    // If "all" is selected, scan all folders
    if (folders.includes('all')) {
        return ['in:spam', 'category:promotions', 'category:updates', 'category:social', 'category:forums'];
    }
    return folders.map(folder => labelMap[folder.toLowerCase()] || 'in:spam').filter(Boolean);
}
/**
 * Fetch messages from monitored folders
 */
async function fetchSpamMessages(mailboxId, userId, options = {}) {
    // Don't set default maxResults - undefined means fetch ALL emails
    const { maxResults, afterDate, monitoredFolders = ['spam'] } = options;
    try {
        const gmail = await createGmailClient(mailboxId, userId);
        console.log(`[Gmail] Fetching messages with ${maxResults ? `limit of ${maxResults}` : 'NO LIMIT (fetch all)'}`);
        // Get labels for monitored folders
        const folderLabels = getFolderLabels(monitoredFolders);
        // Fetch messages from each folder
        const allMessages = [];
        for (const folderQuery of folderLabels) {
            // Build query
            let query = folderQuery;
            if (afterDate) {
                const dateStr = Math.floor(afterDate.getTime() / 1000);
                query += ` after:${dateStr}`;
            }
            try {
                // Initialize page token as null to start from the first page
                let pageToken = null;
                // Loop through all pages of results
                do {
                    const response = await gmail.users.messages.list({
                        userId: 'me',
                        q: query,
                        maxResults: Math.min(maxResults ?? 500, 500), // Use 500 per request (Gmail's max), or less if specified
                        pageToken: pageToken || undefined,
                    });
                    if (response.data.messages && response.data.messages.length > 0) {
                        // Fetch full message details for each message
                        const messages = await Promise.all(response.data.messages.map(async (msg) => {
                            const fullMessage = await gmail.users.messages.get({
                                userId: 'me',
                                id: msg.id,
                                format: 'full',
                            });
                            return fullMessage.data;
                        }));
                        allMessages.push(...messages);
                        // If we've already collected enough messages, stop fetching
                        if (maxResults && allMessages.length >= maxResults) {
                            break;
                        }
                    }
                    // Set the page token for the next iteration
                    pageToken = response.data.nextPageToken || null;
                } while (pageToken && (!maxResults || allMessages.length < maxResults));
            }
            catch (folderError) {
                const errMsg = folderError.message || '';
                // Auth/scope errors are fatal — silently continuing would report 0 messages as "success".
                // Re-throw so the scanner can mark the mailbox for reconnection.
                const isFatalAuthError = errMsg.includes('Insufficient Permission') ||
                    errMsg.includes('invalid_grant') ||
                    errMsg.includes('Invalid Credentials') ||
                    errMsg.includes('Token has been expired or revoked') ||
                    errMsg.includes('unauthorized') ||
                    folderError.code === 401 || folderError.code === 403;
                if (isFatalAuthError) {
                    throw new Error(`Gmail auth error: ${errMsg}. Please disconnect and re-add your Gmail account.`);
                }
                console.warn(`Error fetching from ${folderQuery}:`, errMsg);
                // Continue with other folders only for non-auth errors (e.g. transient network issues)
            }
        }
        // Deduplicate messages by ID (emails can appear in multiple folders)
        const uniqueMessages = Array.from(new Map(allMessages.map(msg => [msg.id, msg])).values());
        console.log(`[Gmail] Fetched ${allMessages.length} messages, ${uniqueMessages.length} unique (${allMessages.length - uniqueMessages.length} duplicates removed)`);
        // If maxResults was specified and we have more messages than needed, trim the array
        if (maxResults && uniqueMessages.length > maxResults) {
            uniqueMessages.length = maxResults; // Truncate to maxResults
        }
        return uniqueMessages;
    }
    catch (error) {
        console.error('Error fetching messages:', error);
        throw new Error(`Failed to fetch messages: ${error.message}`);
    }
}
/**
 * Parse Gmail message into structured format
 */
function parseGmailMessage(message) {
    const headers = message.payload.headers;
    // Extract headers
    const getHeader = (name) => {
        const header = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
        return header?.value || '';
    };
    const subject = getHeader('Subject');
    const from = getHeader('From');
    // Try multiple headers for recipient - 'To' may be empty in some spam emails
    let to = getHeader('To');
    if (!to) {
        to = getHeader('Delivered-To') || getHeader('X-Original-To') || getHeader('Envelope-To') || '';
        if (to) {
            console.log(`[Gmail] Used fallback header for recipient: ${to.substring(0, 50)}`);
        }
    }
    const dateStr = getHeader('Date');
    // Extract email address from "Name <email@domain.com>" format
    const extractEmail = (header) => {
        const match = header.match(/<(.+?)>/);
        return match ? match[1] : header;
    };
    const fromEmail = extractEmail(from);
    // Parse date with fallback to internalDate (Unix timestamp in milliseconds)
    let date;
    if (dateStr) {
        const parsedDate = new Date(dateStr);
        // Validate parsed date
        if (!isNaN(parsedDate.getTime())) {
            date = parsedDate;
        }
        else if (message.internalDate) {
            // Fallback to internalDate if Date header is invalid
            const timestamp = parseInt(message.internalDate);
            date = !isNaN(timestamp) ? new Date(timestamp) : new Date();
        }
        else {
            // Ultimate fallback to current time
            date = new Date();
        }
    }
    else if (message.internalDate) {
        // internalDate is a Unix timestamp string in milliseconds
        const timestamp = parseInt(message.internalDate);
        date = !isNaN(timestamp) ? new Date(timestamp) : new Date();
    }
    else {
        // Ultimate fallback to current time
        date = new Date();
    }
    // Final validation to ensure date is valid
    if (isNaN(date.getTime())) {
        console.warn(`Invalid date for message ${message.id}, using current time`);
        date = new Date();
    }
    // Extract body content
    let bodyText = '';
    let bodyHtml = '';
    const extractBody = (payload) => {
        if (payload.body?.data) {
            const content = Buffer.from(payload.body.data, 'base64').toString('utf-8');
            if (payload.mimeType === 'text/plain') {
                bodyText = content;
            }
            else if (payload.mimeType === 'text/html') {
                bodyHtml = content;
            }
        }
        if (payload.parts) {
            payload.parts.forEach((part) => extractBody(part));
        }
    };
    extractBody(message.payload);
    // If no plain text but we have HTML, extract text from HTML for classification
    if (!bodyText && bodyHtml) {
        // Strip HTML tags to get plain text for classification
        bodyText = bodyHtml
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '') // Remove style blocks
            .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove script blocks
            .replace(/<[^>]+>/g, ' ') // Remove HTML tags
            .replace(/&nbsp;/gi, ' ') // Replace &nbsp; with space
            .replace(/&amp;/gi, '&') // Decode &amp;
            .replace(/&lt;/gi, '<') // Decode &lt;
            .replace(/&gt;/gi, '>') // Decode &gt;
            .replace(/&quot;/gi, '"') // Decode &quot;
            .replace(/&#39;/gi, "'") // Decode &#39;
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
        console.log(`[Gmail] Extracted text from HTML body (${bodyText.length} chars)`);
    }
    // If still no text, use snippet as fallback
    if (!bodyText && !bodyHtml) {
        bodyText = message.snippet || '';
        if (!bodyText) {
            console.warn(`[Gmail] WARNING: Message ${message.id} has no body text, HTML, or snippet`);
        }
    }
    // Sanitize the parsed email content
    const sanitizedSubject = (0, sanitization_1.sanitizeSubject)(subject);
    const sanitizedFrom = (0, sanitization_1.sanitizeSender)(from);
    const sanitizedTo = (0, sanitization_1.sanitizeSender)(to);
    const sanitizedBodies = (0, sanitization_1.sanitizeEmailBody)(bodyHtml || null, bodyText);
    return {
        messageId: message.id,
        subject: sanitizedSubject,
        from: sanitizedFrom,
        fromEmail,
        to: sanitizedTo,
        date,
        bodyText: sanitizedBodies.sanitizedText,
        bodyHtml: sanitizedBodies.sanitizedHtml || undefined,
    };
}
/**
 * Move message from spam to inbox (rescue)
 */
async function rescueMessage(mailboxId, userId, messageId) {
    try {
        console.log(`[Gmail Service] Attempting to rescue message ${messageId} from mailbox ${mailboxId} for user ${userId}`);
        const gmail = await createGmailClient(mailboxId, userId);
        const response = await gmail.users.messages.modify({
            userId: 'me',
            id: messageId,
            requestBody: {
                removeLabelIds: ['SPAM'],
                addLabelIds: ['INBOX'],
            },
        });
        console.log(`[Gmail Service] Successfully rescued message ${messageId}:`, response.status);
    }
    catch (error) {
        console.error('[Gmail Service] Error rescuing message:', error);
        // Don't expose internal error details to the user
        if (error.message.includes('Invalid Credentials') || error.message.includes('access')) {
            throw new Error('Authentication failed. Please reconnect your Gmail account.');
        }
        throw new Error(`Failed to rescue message: ${error.message}`);
    }
}
/**
 * Mark message as spam (opposite of rescue)
 */
async function markAsSpam(mailboxId, userId, messageId) {
    try {
        console.log(`[Gmail Service] Attempting to mark message ${messageId} as spam in mailbox ${mailboxId} for user ${userId}`);
        const gmail = await createGmailClient(mailboxId, userId);
        const response = await gmail.users.messages.modify({
            userId: 'me',
            id: messageId,
            requestBody: {
                removeLabelIds: ['INBOX'],
                addLabelIds: ['SPAM'],
            },
        });
        console.log(`[Gmail Service] Successfully marked message ${messageId} as spam:`, response.status);
    }
    catch (error) {
        console.error('[Gmail Service] Error marking as spam:', error);
        // Don't expose internal error details to the user
        if (error.message.includes('Invalid Credentials') || error.message.includes('access')) {
            throw new Error('Authentication failed. Please reconnect your Gmail account.');
        }
        throw new Error(`Failed to mark as spam: ${error.message}`);
    }
}
/**
 * Delete a message (moves to trash)
 * Uses messages.trash() instead of messages.delete() so the app only needs
 * the gmail.modify scope rather than the full mail.google.com scope.
 * Messages in trash are automatically purged by Gmail after 30 days.
 */
async function deleteMessage(mailboxId, userId, messageId) {
    try {
        const gmail = await createGmailClient(mailboxId, userId);
        console.log(`[Gmail Service] Trashing message ${messageId} from mailbox ${mailboxId}`);
        await gmail.users.messages.trash({
            userId: 'me',
            id: messageId,
        });
        console.log(`[Gmail Service] Successfully trashed message ${messageId}`);
    }
    catch (error) {
        console.error('[Gmail Service] Error trashing message:', error);
        // Don't expose internal error details to the user
        if (error.message.includes('Invalid Credentials') || error.message.includes('access')) {
            throw new Error('Authentication failed. Please reconnect your Gmail account.');
        }
        throw new Error(`Failed to delete message: ${error.message}`);
    }
}
/**
 * List all message IDs currently in monitored folders — no date filter, IDs only.
 * Used by reconciliation to detect messages moved/deleted by the user.
 */
async function listAllMessageIds(mailboxId, userId, monitoredFolders) {
    const gmail = await createGmailClient(mailboxId, userId);
    const folderLabels = getFolderLabels(monitoredFolders || ['spam']);
    const allIds = new Set();
    for (const folderQuery of folderLabels) {
        let pageToken = undefined;
        do {
            const response = await gmail.users.messages.list({
                userId: 'me',
                q: folderQuery,
                maxResults: 500,
                pageToken,
                fields: 'messages/id,nextPageToken',
            });
            for (const msg of (response.data.messages || [])) {
                if (msg.id) allIds.add(msg.id);
            }
            pageToken = response.data.nextPageToken || undefined;
        } while (pageToken);
    }
    return allIds;
}
/**
 * Get unread count in spam folder
 */
async function getSpamCount(mailboxId, userId) {
    try {
        const gmail = await createGmailClient(mailboxId, userId);
        const response = await gmail.users.messages.list({
            userId: 'me',
            q: 'in:spam is:unread',
            maxResults: 1,
        });
        return response.data.resultSizeEstimate || 0;
    }
    catch (error) {
        console.error('Error getting spam count:', error);
        return 0;
    }
}
