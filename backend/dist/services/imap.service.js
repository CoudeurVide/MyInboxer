"use strict";
/**
 * IMAP Service
 * Handles IMAP protocol for email providers other than Gmail/Outlook
 * (GMX, Yahoo, Zoho, Fastmail, custom domains, etc.)
 *
 * Credentials stored on the mailbox:
 *   accessToken  → IMAP username (decrypted)
 *   refreshToken → IMAP password / app-password (decrypted)
 *   imap_config  → { host, port, secure } JSON field
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchSpamMessages = fetchSpamMessages;
exports.parseImapMessage = parseImapMessage;
exports.listAllMessageIds = listAllMessageIds;

const { ImapFlow } = require('imapflow');
const mailbox_service_1 = require("./mailbox.service");

// Common spam/junk folder names used across providers
const SPAM_FOLDER_CANDIDATES = ['Junk', 'Spam', 'SPAM', 'Junk Email', 'Bulk Mail', 'Junk Mail'];
// IMAP special-use attributes that indicate a spam folder
const SPAM_ATTRIBUTES = ['\\Junk', '\\Spam'];

/**
 * Build an imapflow client from stored mailbox credentials.
 * Credentials: accessToken = username, refreshToken = password.
 */
async function createImapClient(mailboxId, userId) {
    const mailbox = await mailbox_service_1.getMailboxWithTokens(mailboxId, userId);
    const imapConfig = mailbox.imap_config || {};
    if (!imapConfig.host) {
        throw new Error('IMAP_CONFIG_MISSING: imap_config.host is required for IMAP mailboxes.');
    }
    return new ImapFlow({
        host: imapConfig.host,
        port: imapConfig.port || (imapConfig.secure !== false ? 993 : 143),
        secure: imapConfig.secure !== false, // default true (TLS)
        auth: {
            user: mailbox.accessToken,
            pass: mailbox.refreshToken,
        },
        logger: false, // suppress imapflow's own logging
        tls: { rejectUnauthorized: true },
        connectionTimeout: 15000,
        greetingTimeout: 10000,
        socketTimeout: 30000,
    });
}

/**
 * Detect the spam/junk folder by checking special-use attributes first,
 * then falling back to common folder name candidates.
 */
async function detectSpamFolder(client) {
    const folders = await client.list();
    // Prefer folders with a spam/junk special-use attribute
    for (const folder of folders) {
        if (folder.specialUse && SPAM_ATTRIBUTES.includes(folder.specialUse)) {
            return folder.path;
        }
        if (folder.flags && [...folder.flags].some(f => SPAM_ATTRIBUTES.includes(f))) {
            return folder.path;
        }
    }
    // Fall back to name matching (case-insensitive)
    for (const candidate of SPAM_FOLDER_CANDIDATES) {
        const match = folders.find(f => f.name.toLowerCase() === candidate.toLowerCase());
        if (match) return match.path;
    }
    // Last resort: return 'Junk' and let the caller handle errors
    return 'Junk';
}

/**
 * Map monitored folder names to IMAP folder paths.
 * For IMAP providers the only meaningful folder is spam/junk.
 * 'all' includes Trash as well.
 */
async function resolveFolderPaths(client, monitoredFolders) {
    const spamPath = await detectSpamFolder(client);
    if (monitoredFolders.includes('all')) {
        const folders = await client.list();
        const trashFolder = folders.find(f =>
            (f.specialUse && f.specialUse === '\\Trash') ||
            ['Trash', 'Deleted Items', 'Deleted Messages'].includes(f.name)
        );
        return [spamPath, ...(trashFolder ? [trashFolder.path] : [])];
    }
    return [spamPath];
}

/**
 * Fetch messages from monitored IMAP folders.
 * Returns an array of raw imapflow message objects with parsed fields.
 */
async function fetchSpamMessages(mailboxId, userId, options = {}) {
    const { maxResults, afterDate, monitoredFolders = ['spam'] } = options;
    const client = await createImapClient(mailboxId, userId);
    const messages = [];
    try {
        await client.connect();
        const folderPaths = await resolveFolderPaths(client, monitoredFolders);
        for (const folderPath of folderPaths) {
            try {
                const lock = await client.getMailboxLock(folderPath);
                try {
                    // Build search criteria
                    const searchQuery = { all: true };
                    if (afterDate) {
                        searchQuery.since = afterDate;
                    }
                    const uids = await client.search(searchQuery, { uid: true });
                    if (!uids || uids.length === 0) continue;

                    // Honour maxResults by taking the most recent UIDs
                    const targetUids = maxResults && uids.length > maxResults
                        ? uids.slice(-maxResults)
                        : uids;

                    for await (const msg of client.fetch(client.uidToRange(targetUids), {
                        uid: true,
                        envelope: true,
                        bodyStructure: true,
                        bodyParts: ['TEXT', '1', '2'],
                        source: false,
                    }, { uid: true })) {
                        messages.push({ ...msg, _folder: folderPath });
                    }
                } finally {
                    lock.release();
                }
            } catch (folderError) {
                console.warn(`[IMAP] fetchSpamMessages: error in folder ${folderPath}:`, folderError.message);
            }
        }
    } finally {
        await client.logout().catch(() => {});
    }
    return messages;
}

/**
 * Parse a raw imapflow message into the standard ParsedEmail shape
 * used by the scanner and classifier.
 */
function parseImapMessage(msg) {
    const env = msg.envelope || {};
    const from = env.from?.[0] || {};
    const to = env.to?.[0] || {};
    const fromEmail = from.address || '';
    const fromName = from.name ? `${from.name} <${fromEmail}>` : fromEmail;
    const toEmail = to.address || '';
    const toName = to.name ? `${to.name} <${toEmail}>` : toEmail;

    // imapflow delivers body parts as Buffers
    const textPart = msg.bodyParts?.get('TEXT') || msg.bodyParts?.get('1') || null;
    const htmlPart = msg.bodyParts?.get('2') || null;
    const bodyText = textPart ? textPart.toString('utf8') : '';
    const bodyHtml = htmlPart ? htmlPart.toString('utf8') : undefined;

    // Use UID as the stable provider_message_id for this provider
    const messageId = String(msg.uid);

    return {
        messageId,
        subject: env.subject || '(No Subject)',
        from: fromName,
        fromEmail,
        to: toName,
        date: env.date ? new Date(env.date) : new Date(),
        bodyText,
        bodyHtml,
    };
}

/**
 * List all message UIDs currently in monitored folders — no date filter.
 * Used by reconciliation to detect messages removed from the server.
 */
async function listAllMessageIds(mailboxId, userId, monitoredFolders) {
    const client = await createImapClient(mailboxId, userId);
    const allIds = new Set();
    try {
        await client.connect();
        const folderPaths = await resolveFolderPaths(client, monitoredFolders);
        for (const folderPath of folderPaths) {
            try {
                const lock = await client.getMailboxLock(folderPath);
                try {
                    const uids = await client.search({ all: true }, { uid: true });
                    for (const uid of (uids || [])) {
                        allIds.add(String(uid));
                    }
                } finally {
                    lock.release();
                }
            } catch (folderError) {
                console.warn(`[IMAP] listAllMessageIds: error in folder ${folderPath}:`, folderError.message);
            }
        }
    } finally {
        await client.logout().catch(() => {});
    }
    return allIds;
}
