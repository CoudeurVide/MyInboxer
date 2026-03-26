"use strict";
/**
 * Utility to extract unsubscribe URLs from email content
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractUnsubscribeUrl = extractUnsubscribeUrl;
// Keywords that indicate an unsubscribe link (case-insensitive matching via /gi flags)
const UNSUBSCRIBE_URL_KEYWORDS = [
    'unsubscribe',
    'opt-out',
    'optout',
    'opt_out',
    'email-preferences',
    'email_preferences',
    'subscription',
    'manage-preferences',
    'manage_preferences',
    'list-unsubscribe',
    'email-settings',
    'notification-settings',
    'communication-preferences',
    'mailing-list',
    'remove-me',
    'email_optout',
];
// Keywords for matching link text (broader than URL keywords)
const UNSUBSCRIBE_TEXT_KEYWORDS = [
    'unsubscribe',
    'opt out',
    'opt-out',
    'manage preferences',
    'manage subscriptions',
    'email preferences',
    'email settings',
    'notification settings',
    'stop receiving',
    'remove me',
    'update preferences',
    'subscription settings',
    'communication preferences',
    'mailing list',
    'no longer wish',
    'stop these emails',
    'manage your',
];
// Build regex pattern from keywords for URL matching
const urlKeywordsPattern = UNSUBSCRIBE_URL_KEYWORDS.join('|');
/**
 * Extract unsubscribe URL from email HTML or text
 * @param bodyHtml - HTML content of the email
 * @param bodyText - Plain text content of the email
 * @returns The first unsubscribe URL found, or null if none found
 */
function extractUnsubscribeUrl(bodyHtml, bodyText) {
    // Try HTML first (more reliable)
    if (bodyHtml) {
        const htmlUrl = extractFromHtml(bodyHtml);
        if (htmlUrl)
            return htmlUrl;
    }
    // Fallback to plain text
    if (bodyText) {
        const textUrl = extractFromText(bodyText);
        if (textUrl)
            return textUrl;
    }
    return null;
}
/**
 * Extract unsubscribe URL from HTML content
 */
function extractFromHtml(html) {
    // Pattern 1: <a href="...keyword..."> where the URL itself contains an unsubscribe keyword
    const linkPattern = new RegExp(`<a[^>]*href=["']([^"']*(?:${urlKeywordsPattern})[^"']*)["'][^>]*>`, 'gi');
    const linkMatches = html.matchAll(linkPattern);
    for (const match of linkMatches) {
        const url = match[1];
        if (isValidUrl(url)) {
            return url;
        }
    }
    // Pattern 2: <a href="...">...unsubscribe text...</a> where the link text contains keywords
    // Build text keywords pattern for matching anchor text
    const textKeywordsPattern = UNSUBSCRIBE_TEXT_KEYWORDS
        .map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) // escape regex chars
        .join('|');
    const textLinkPattern = new RegExp(`<a[^>]*href=["']([^"']+)["'][^>]*>[^<]*(?:${textKeywordsPattern})[^<]*<\\/a>`, 'gi');
    const textMatches = html.matchAll(textLinkPattern);
    for (const match of textMatches) {
        const url = match[1];
        if (isValidUrl(url)) {
            return url;
        }
    }
    // Pattern 3: Any URL in HTML containing unsubscribe keywords
    const urlPattern = new RegExp(`https?:\\/\\/[^\\s<>"]+(?:${urlKeywordsPattern})[^\\s<>"]*`, 'gi');
    const urlMatches = html.match(urlPattern);
    if (urlMatches && urlMatches.length > 0) {
        const url = urlMatches[0];
        if (isValidUrl(url)) {
            return url;
        }
    }
    return null;
}
/**
 * Extract unsubscribe URL from plain text
 */
function extractFromText(text) {
    // Look for URLs with unsubscribe-related keywords
    const urlPattern = new RegExp(`https?:\\/\\/[^\\s]+(?:${urlKeywordsPattern})[^\\s]*`, 'gi');
    const matches = text.match(urlPattern);
    if (matches && matches.length > 0) {
        const url = matches[0];
        if (isValidUrl(url)) {
            return url;
        }
    }
    return null;
}
/**
 * Validate if a string is a valid HTTP/HTTPS URL
 */
function isValidUrl(urlString) {
    try {
        const url = new URL(urlString);
        return url.protocol === 'http:' || url.protocol === 'https:';
    }
    catch {
        return false;
    }
}
