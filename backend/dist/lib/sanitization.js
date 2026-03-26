"use strict";
/**
 * Data Sanitization Utilities
 * Handles sanitization of user-provided content to prevent XSS and other injection attacks
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeHtml = sanitizeHtml;
exports.sanitizeText = sanitizeText;
exports.sanitizeSubject = sanitizeSubject;
exports.sanitizeSender = sanitizeSender;
exports.sanitizeUrl = sanitizeUrl;
exports.sanitizeEmailBody = sanitizeEmailBody;
/**
 * Sanitize HTML content to prevent XSS attacks.
 * Uses a layered defence: strip dangerous elements, strip event handlers,
 * block javascript:/vbscript:/data: protocols, and strip style attributes.
 * Note: for rich display of email bodies the frontend uses DOMPurify with
 * a strict allowlist — this server-side pass is an additional defence-in-depth layer.
 * @param html - HTML content to sanitize
 * @returns Sanitized HTML
 */
function sanitizeHtml(html) {
    if (!html)
        return html;
    return html
        // 1. Remove <script> blocks (including multi-line)
        .replace(/<script\b[\s\S]*?<\/script>/gi, '')
        // 2. Remove dangerous block elements (svg can contain script nodes)
        .replace(/<(iframe|frame|object|embed|applet|form|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
        // 3. Strip self-closing dangerous tags
        .replace(/<(iframe|frame|object|embed|applet|form|svg)\b[^>]*\/?>/gi, '')
        // 4. Strip all event handler attributes (on*)
        .replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '')
        // 5. Block javascript: and vbscript: in href/src/action/formaction
        .replace(/(\s(?:href|src|action|formaction)\s*=\s*)(?:"[^"]*(?:javascript|vbscript):[^"]*"|'[^']*(?:javascript|vbscript):[^']*')/gi, '')
        // 6. Block data: URIs in href/src (can carry HTML/JS payloads)
        .replace(/(\s(?:href|src)\s*=\s*)(?:"data:[^"]*"|'data:[^']*')/gi, '')
        // 7. Strip style attributes (CSS expressions / -moz-binding attacks)
        .replace(/\s+style\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
        // 8. Neutralise any remaining bare protocol references
        .replace(/javascript\s*:/gi, 'blocked:')
        .replace(/vbscript\s*:/gi, 'blocked:')
        .trim();
}
/**
 * Sanitize text content by removing potentially dangerous characters
 * @param text - Text content to sanitize
 * @returns Sanitized text
 */
function sanitizeText(text) {
    if (!text)
        return text;
    // Remove null bytes and other dangerous characters
    return text
        .replace(/\0/g, '') // Remove null bytes
        .replace(/<[^>]*>/g, '') // Remove HTML tags
        .trim();
}
/**
 * Sanitize email subject to prevent injection
 * @param subject - Email subject to sanitize
 * @returns Sanitized subject
 */
function sanitizeSubject(subject) {
    if (!subject)
        return subject;
    // Remove control characters and normalize whitespace
    return subject
        .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
}
/**
 * Sanitize email sender information
 * @param sender - Sender name or email to sanitize
 * @returns Sanitized sender info
 */
function sanitizeSender(sender) {
    if (!sender)
        return sender;
    // Remove control characters and normalize
    return sender
        .replace(/[\x00-\x1F\x7F]/g, '') // Remove control characters
        .replace(/\s+/g, ' ') // Normalize whitespace
        .trim();
}
/**
 * Sanitize URLs to prevent open redirect and other attacks
 * @param url - URL to sanitize
 * @returns Sanitized URL or null if invalid
 */
function sanitizeUrl(url) {
    if (!url)
        return url;
    try {
        const parsedUrl = new URL(url);
        // Only allow http and https protocols
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            return null;
        }
        return parsedUrl.toString();
    }
    catch (error) {
        return null; // Invalid URL
    }
}
/**
 * Sanitize email body content (both HTML and text)
 * @param bodyHtml - HTML body content
 * @param bodyText - Text body content
 * @returns Object with sanitized HTML and text
 */
function sanitizeEmailBody(bodyHtml, bodyText) {
    return {
        sanitizedHtml: bodyHtml ? sanitizeHtml(bodyHtml) : null,
        sanitizedText: sanitizeText(bodyText)
    };
}
