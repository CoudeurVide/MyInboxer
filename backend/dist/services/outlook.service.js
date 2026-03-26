"use strict";
/**
 * Outlook Service
 * Handles Microsoft Graph API operations for fetching and scanning junk email folder
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createOutlookClient = createOutlookClient;
exports.fetchSpamMessages = fetchSpamMessages;
exports.parseOutlookMessage = parseOutlookMessage;
exports.rescueMessage = rescueMessage;
exports.markAsSpam = markAsSpam;
exports.deleteMessage = deleteMessage;
exports.getSpamCount = getSpamCount;
const microsoft_graph_client_1 = require("@microsoft/microsoft-graph-client");
require("isomorphic-fetch");
const mailbox_service_1 = require("./mailbox.service");
const outlook_token_refresh_1 = require("./outlook-token-refresh");
const sanitization_1 = require("../lib/sanitization");
/**
 * Create Microsoft Graph API client with mailbox credentials
 */
async function createOutlookClient(mailboxId, userId) {
    const mailbox = await (0, mailbox_service_1.getMailboxWithTokens)(mailboxId, userId);
    // Validate access token before creating client
    if (!mailbox.accessToken) {
        throw new Error('OUTLOOK_NO_ACCESS_TOKEN: No access token available. Please reconnect your Outlook mailbox.');
    }
    // Check if the token has the expected format (at least 10 characters to be considered valid)
    if (typeof mailbox.accessToken !== 'string' || mailbox.accessToken.length < 10) {
        console.error(`Invalid access token format for mailbox ${mailboxId}`);
        throw new Error('OUTLOOK_INVALID_ACCESS_TOKEN: Access token is in an invalid format. Please reconnect your Outlook mailbox.');
    }
    const client = microsoft_graph_client_1.Client.init({
        authProvider: async (done) => {
            try {
                // Validate the token format before passing it to the client
                if (!mailbox.accessToken || typeof mailbox.accessToken !== 'string') {
                    done(new Error('Invalid access token'), null);
                    return;
                }
                // For now, we'll try using the token and refresh it if it fails
                // In a complete implementation, we would track token expiration,
                // but for now we just handle the failure case
                done(null, mailbox.accessToken);
            }
            catch (error) {
                console.error(`[Outlook] Error in authProvider for mailbox ${mailboxId}:`, error.message);
                done(error, null);
            }
        },
    });
    return client;
}
/**
 * Map folder names to Outlook folder IDs
 * Note: Outlook doesn't have Gmail's category system (Promotions, Updates, etc.)
 * We'll focus on scanning JunkEmail, and optionally other folders for "all"
 */
function getFolderIds(folders) {
    const folderMap = {
        spam: 'JunkEmail',
        // Note: Outlook doesn't have direct equivalents for Gmail categories
        // These are mapped to JunkEmail for now
        promotions: 'JunkEmail',
        updates: 'JunkEmail',
        social: 'JunkEmail',
        forums: 'JunkEmail',
    };
    // If "all" is selected, scan multiple folders
    if (folders.includes('all')) {
        return ['JunkEmail', 'DeletedItems', 'Archive'];
    }
    // Map folders to Outlook folder IDs, removing duplicates
    const folderIds = folders
        .map(folder => folderMap[folder.toLowerCase()] || 'JunkEmail')
        .filter((value, index, self) => self.indexOf(value) === index); // Remove duplicates
    return folderIds;
}
/**
 * Fetch messages from monitored folders
 */
async function fetchSpamMessages(mailboxId, userId, options = {}) {
    // Don't set default maxResults - undefined means fetch ALL emails
    const { maxResults, afterDate, monitoredFolders = ['spam'] } = options;
    try {
        const client = await createOutlookClient(mailboxId, userId);
        console.log(`[Outlook] Fetching messages with ${maxResults ? `limit of ${maxResults}` : 'NO LIMIT (fetch all)'}`);
        // Build filter query
        let filter = '';
        if (afterDate) {
            const isoDate = afterDate.toISOString();
            filter = `receivedDateTime ge ${isoDate}`;
        }
        // Get folder IDs for monitored folders
        const folderIds = getFolderIds(monitoredFolders);
        // Fetch messages from each folder
        const allMessages = [];
        for (const folderId of folderIds) {
            try {
                // Fetch messages from this folder with pagination
                let nextLink = null;
                let folderMessages = [];
                do {
                    let query;
                    if (nextLink) {
                        // Use the next link for pagination
                        query = client.api(nextLink);
                    }
                    else {
                        // Initial request
                        query = client
                            .api(`/me/mailFolders/${folderId}/messages`)
                            .top(Math.min(maxResults ?? 999, 999)) // Use 999 per request (Outlook's max), or less if specified
                            .select([
                            'id',
                            'conversationId',
                            'subject',
                            'bodyPreview',
                            'body',
                            'from',
                            'toRecipients',
                            'receivedDateTime',
                            'internetMessageId',
                        ]);
                        // Only add filter if it's defined
                        if (filter) {
                            query = query.filter(filter);
                        }
                    }
                    const response = await query.get();
                    if (response.value && response.value.length > 0) {
                        folderMessages.push(...response.value);
                        // If we've reached the limit, stop fetching
                        if (maxResults && folderMessages.length >= maxResults) {
                            break;
                        }
                    }
                    // Check if there's a next page
                    nextLink = response['@odata.nextLink'] || null;
                } while (nextLink && (!maxResults || folderMessages.length < maxResults));
                // Add folder messages to total (respecting maxResults if specified)
                if (maxResults && folderMessages.length > maxResults) {
                    allMessages.push(...folderMessages.slice(0, maxResults));
                }
                else {
                    allMessages.push(...folderMessages);
                }
            }
            catch (folderError) {
                // Check if it's a token-related error
                const errMsg = folderError.message || '';
                if (errMsg.includes('IDX14100') || // JWT is not well formed
                    errMsg.includes('JWT is not well formed') ||
                    errMsg.includes('There are no dots') ||
                    errMsg.includes('JWS') || // JWT Serialization Format
                    errMsg.includes('JWE') || // JWT Serialization Format
                    errMsg.includes('MAILBOX_TOKENS') ||
                    errMsg.includes('Invalid access token') ||
                    errMsg.includes('Access token has expired') ||
                    errMsg.includes('Authentication failed') ||
                    errMsg.includes('InvalidAuthenticationToken') ||
                    errMsg.includes('Access is denied') ||
                    errMsg.includes('CompactToken') || // Microsoft compact token parsing error
                    errMsg.includes('AADSTS') || // Azure AD error codes (expired refresh token, revoked consent, etc.)
                    errMsg.includes('invalid_grant') || // OAuth refresh token expired
                    errMsg.includes('interaction_required') || // Needs user re-auth
                    folderError.statusCode === 401 || folderError.statusCode === 403 ||
                    folderError.code === 'InvalidAuthenticationToken') {
                    console.error(`❌ Outlook authentication failed for folder ${folderId}:`, folderError.message);
                    console.error(`   Attempting to refresh the access token...`);
                    try {
                        // Try to refresh the token and retry the request
                        await (0, outlook_token_refresh_1.refreshOutlookToken)(mailboxId);
                        console.log(`   Token refreshed successfully. Retrying request for folder ${folderId}...`);
                        // Create new client with refreshed token
                        const newClient = await createOutlookClient(mailboxId, userId);
                        // Retry the same request with the new client (with pagination)
                        let retryNextLink = null;
                        let retryFolderMessages = [];
                        do {
                            let retryQuery;
                            if (retryNextLink) {
                                retryQuery = newClient.api(retryNextLink);
                            }
                            else {
                                retryQuery = newClient
                                    .api(`/me/mailFolders/${folderId}/messages`)
                                    .top(Math.min(maxResults ?? 999, 999))
                                    .select([
                                    'id',
                                    'conversationId',
                                    'subject',
                                    'bodyPreview',
                                    'body',
                                    'from',
                                    'toRecipients',
                                    'receivedDateTime',
                                    'internetMessageId',
                                ]);
                                // Only add filter if it's defined
                                if (filter) {
                                    retryQuery = retryQuery.filter(filter);
                                }
                            }
                            const retryResponse = await retryQuery.get();
                            if (retryResponse.value && retryResponse.value.length > 0) {
                                retryFolderMessages.push(...retryResponse.value);
                                // If we've reached the limit, stop fetching
                                if (maxResults && retryFolderMessages.length >= maxResults) {
                                    break;
                                }
                            }
                            // Check if there's a next page
                            retryNextLink = retryResponse['@odata.nextLink'] || null;
                        } while (retryNextLink && (!maxResults || retryFolderMessages.length < maxResults));
                        // Add retry folder messages to total (respecting maxResults if specified)
                        if (maxResults && retryFolderMessages.length > maxResults) {
                            allMessages.push(...retryFolderMessages.slice(0, maxResults));
                        }
                        else {
                            allMessages.push(...retryFolderMessages);
                        }
                        console.log(`   Successfully fetched ${retryFolderMessages.length} messages from folder ${folderId} after token refresh.`);
                    }
                    catch (refreshError) {
                        console.error(`   Failed to refresh token for mailbox ${mailboxId}:`, refreshError.message);
                        console.error(`   Please reconnect your Outlook mailbox to refresh the access token.`);
                        throw new Error(`OUTLOOK_AUTH_FAILED: ${folderError.message}`);
                    }
                }
                else {
                    console.warn(`Error fetching from Outlook folder ${folderId}:`, folderError.message);
                    // Continue with other folders even if one fails (non-auth errors)
                }
            }
        }
        // Deduplicate messages by ID (emails can appear in multiple folders)
        const uniqueMessages = Array.from(new Map(allMessages.map(msg => [msg.id, msg])).values());
        console.log(`[Outlook] Fetched ${allMessages.length} messages, ${uniqueMessages.length} unique (${allMessages.length - uniqueMessages.length} duplicates removed)`);
        return uniqueMessages;
    }
    catch (error) {
        console.error('Error fetching messages from Outlook:', error);
        // If this is a token-related error, provide specific instructions
        const errMsg = error.message || '';
        if (errMsg.includes('IDX14100') ||
            errMsg.includes('JWT is not well formed') ||
            errMsg.includes('There are no dots') ||
            errMsg.includes('JWS') ||
            errMsg.includes('JWE') ||
            errMsg.includes('MAILBOX_TOKENS') ||
            errMsg.includes('Invalid access token') ||
            errMsg.includes('Access token has expired') ||
            errMsg.includes('Authentication failed') ||
            errMsg.includes('InvalidAuthenticationToken') ||
            errMsg.includes('Access is denied') ||
            errMsg.includes('CompactToken') ||
            errMsg.includes('AADSTS') ||
            errMsg.includes('invalid_grant') ||
            errMsg.includes('interaction_required') ||
            error.statusCode === 401 || error.statusCode === 403 ||
            error.code === 'InvalidAuthenticationToken') {
            console.error('   Please reconnect your Outlook mailbox to refresh the access token.');
            throw new Error(`OUTLOOK_AUTH_FAILED: ${errMsg}`);
        }
        throw new Error(`Failed to fetch messages: ${errMsg}`);
    }
}
/**
 * Parse Outlook message into structured format
 */
function parseOutlookMessage(message) {
    const subject = message.subject || '(No Subject)';
    const fromName = message.from?.emailAddress?.name || '';
    const fromEmail = message.from?.emailAddress?.address || '';
    const from = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
    const toRecipient = message.toRecipients?.[0];
    const to = toRecipient
        ? toRecipient.emailAddress.name
            ? `${toRecipient.emailAddress.name} <${toRecipient.emailAddress.address}>`
            : toRecipient.emailAddress.address
        : '';
    if (!to) {
        console.warn(`[Outlook] WARNING: Empty recipient for message "${subject.substring(0, 50)}" from ${fromEmail}`);
    }
    const date = new Date(message.receivedDateTime);
    // Extract body content
    let bodyText = '';
    let bodyHtml = '';
    if (message.body) {
        if (message.body.contentType === 'text') {
            bodyText = message.body.content;
        }
        else if (message.body.contentType === 'html') {
            bodyHtml = message.body.content;
            // Extract plain text from HTML for better classification (bodyPreview is often truncated)
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
            console.log(`[Outlook] Extracted text from HTML body (${bodyText.length} chars)`);
        }
    }
    // If no body content, use bodyPreview as last resort
    if (!bodyText && !bodyHtml) {
        bodyText = message.bodyPreview || '';
        if (!bodyText) {
            console.warn(`[Outlook] WARNING: Message ${message.id} has no body text, HTML, or preview`);
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
 * Move message from junk to inbox (rescue)
 */
async function rescueMessage(mailboxId, userId, messageId) {
    try {
        console.log(`[Outlook Service] Attempting to rescue message ${messageId} from mailbox ${mailboxId} for user ${userId}`);
        const client = await createOutlookClient(mailboxId, userId);
        // Move message to Inbox folder using PATCH instead of POST
        // Try updating parentFolderId directly as fallback
        try {
            const response = await client.api(`/me/messages/${messageId}/move`).post({
                destinationId: 'Inbox',
            });
            console.log(`[Outlook Service] Successfully rescued message ${messageId}:`, response);
            return;
        }
        catch (moveError) {
            console.log(`[Outlook Service] Move API failed, trying PATCH method...`);
            // Fallback: Try PATCH to update parentFolderId
            const patchResponse = await client.api(`/me/messages/${messageId}`).patch({
                parentFolderId: 'Inbox',
            });
            console.log(`[Outlook Service] Successfully rescued message ${messageId} via PATCH:`, patchResponse);
            return;
        }
    }
    catch (error) {
        console.error('[Outlook Service] Error rescuing message from Outlook:', error);
        // Don't expose internal error details to the user
        if (error.message && (error.message.includes('InvalidAuthenticationToken') ||
            error.message.includes('Authentication failed') ||
            error.message.includes('access'))) {
            throw new Error('Authentication failed. Please reconnect your Outlook account.');
        }
        throw new Error(`Failed to rescue message: ${error.message}`);
    }
}
/**
 * Mark message as spam (opposite of rescue)
 */
async function markAsSpam(mailboxId, userId, messageId) {
    try {
        console.log(`[Outlook Service] Attempting to mark message ${messageId} as spam in mailbox ${mailboxId} for user ${userId}`);
        const client = await createOutlookClient(mailboxId, userId);
        // Move message to JunkEmail folder
        const response = await client.api(`/me/messages/${messageId}/move`).post({
            destinationId: 'JunkEmail',
        });
        console.log(`[Outlook Service] Successfully marked message ${messageId} as spam:`, response);
    }
    catch (error) {
        console.error('[Outlook Service] Error marking as spam in Outlook:', error);
        // Don't expose internal error details to the user
        if (error.message && (error.message.includes('InvalidAuthenticationToken') ||
            error.message.includes('Authentication failed') ||
            error.message.includes('access'))) {
            throw new Error('Authentication failed. Please reconnect your Outlook account.');
        }
        throw new Error(`Failed to mark as spam: ${error.message}`);
    }
}
/**
 * Delete a message permanently
 */
async function deleteMessage(mailboxId, userId, messageId) {
    try {
        console.log(`[Outlook Service] Deleting message ${messageId} from mailbox ${mailboxId}`);
        const client = await createOutlookClient(mailboxId, userId);
        // Permanently delete the message
        await client.api(`/me/messages/${messageId}`).delete();
        console.log(`[Outlook Service] Successfully deleted message ${messageId}`);
    }
    catch (error) {
        console.error('[Outlook Service] Error deleting message:', error);
        // Don't expose internal error details to the user
        if (error.message && (error.message.includes('InvalidAuthenticationToken') ||
            error.message.includes('Authentication failed') ||
            error.message.includes('access'))) {
            throw new Error('Authentication failed. Please reconnect your Outlook account.');
        }
        throw new Error(`Failed to delete message: ${error.message}`);
    }
}
/**
 * Get unread count in junk folder
 */
async function getSpamCount(mailboxId, userId) {
    try {
        const client = await createOutlookClient(mailboxId, userId);
        const response = await client
            .api('/me/mailFolders/JunkEmail')
            .select(['unreadItemCount'])
            .get();
        return response.unreadItemCount || 0;
    }
    catch (error) {
        console.error('Error getting spam count from Outlook:', error);
        return 0;
    }
}
