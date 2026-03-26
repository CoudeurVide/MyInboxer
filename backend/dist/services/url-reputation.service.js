"use strict";
/**
 * URL Reputation Service
 * Analyzes links in emails to detect phishing, malware, and suspicious URLs
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeURLs = analyzeURLs;
/**
 * Analyze URLs in email body
 */
function analyzeURLs(bodyHtml, bodyText, senderDomain) {
    const links = extractLinks(bodyHtml, bodyText);
    if (links.length === 0) {
        // No links = slightly more trustworthy (legitimate inquiries often have no links)
        return {
            totalLinks: 0,
            suspiciousLinks: 0,
            phishingLikelihood: 'none',
            score: 2,
            trustAdjustment: 0.05,
            details: {
                hasLinks: false,
                redirectChains: 0,
                domainMismatch: false,
                shortenerDetected: false,
                suspiciousTLDs: [],
                issues: [],
            },
        };
    }
    const issues = [];
    let suspiciousCount = 0;
    let score = 0;
    // Extract domains from links
    const linkDomains = links.map(extractDomain).filter(Boolean);
    const uniqueDomains = Array.from(new Set(linkDomains));
    // Check 1: URL shorteners (often used in phishing)
    const shorteners = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly'];
    const shortenerDetected = linkDomains.some(domain => shorteners.includes(domain));
    if (shortenerDetected) {
        issues.push('URL shortener detected (often used in phishing)');
        suspiciousCount++;
        score -= 3;
    }
    // Check 2: Domain mismatch (link domain != sender domain)
    const domainMismatch = !linkDomains.some(domain => domain === senderDomain);
    if (domainMismatch && links.length >= 3) {
        // Multiple links to external domains = likely spam
        issues.push(`All ${links.length} links point to external domains`);
        suspiciousCount++;
        score -= 2;
    }
    // Check 3: Suspicious TLDs
    const suspiciousTLDs = [
        '.tk', '.ml', '.ga', '.cf', '.gq', // Free TLDs (often spam)
        '.xyz', '.top', '.work', '.click', // Often used in spam
        '.zip', '.mov', // New gTLDs that mimic file extensions
    ];
    const foundSuspiciousTLDs = linkDomains
        .filter(domain => suspiciousTLDs.some(tld => domain?.endsWith(tld)))
        .filter((v, i, a) => a.indexOf(v) === i); // Unique
    if (foundSuspiciousTLDs.length > 0) {
        issues.push(`Suspicious TLDs: ${foundSuspiciousTLDs.join(', ')}`);
        suspiciousCount += foundSuspiciousTLDs.length;
        score -= foundSuspiciousTLDs.length * 2;
    }
    // Check 4: Excessive links (spam often has many links)
    if (links.length > 10) {
        issues.push(`Excessive links (${links.length}) - typical of spam`);
        suspiciousCount++;
        score -= 3;
    }
    // Check 5: IP addresses in URLs (rare in legitimate emails)
    const ipRegex = /https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/;
    const hasIPLinks = links.some(link => ipRegex.test(link));
    if (hasIPLinks) {
        issues.push('Link uses IP address instead of domain (highly suspicious)');
        suspiciousCount++;
        score -= 5;
    }
    // Check 6: Suspicious keywords in URLs
    const suspiciousKeywords = [
        'verify', 'account', 'suspended', 'urgent', 'login',
        'secure', 'update', 'confirm', 'billing', 'payment',
    ];
    const hasSuspiciousKeywords = links.some(link => suspiciousKeywords.some(kw => link.toLowerCase().includes(kw)));
    if (hasSuspiciousKeywords) {
        issues.push('URLs contain phishing-related keywords');
        suspiciousCount++;
        score -= 4;
    }
    // Determine phishing likelihood
    let phishingLikelihood;
    if (suspiciousCount >= 3) {
        phishingLikelihood = 'high';
    }
    else if (suspiciousCount >= 2) {
        phishingLikelihood = 'medium';
    }
    else if (suspiciousCount >= 1) {
        phishingLikelihood = 'low';
    }
    else {
        phishingLikelihood = 'none';
        // Clean links with matching domain = slight trust boost
        if (!domainMismatch) {
            score += 1;
        }
    }
    // Calculate trust adjustment
    const trustAdjustment = Math.min(0.1, Math.max(-0.3, score / 40));
    return {
        totalLinks: links.length,
        suspiciousLinks: suspiciousCount,
        phishingLikelihood,
        score,
        trustAdjustment,
        details: {
            hasLinks: true,
            redirectChains: 0, // Would require HTTP requests to detect
            domainMismatch,
            shortenerDetected,
            suspiciousTLDs: foundSuspiciousTLDs,
            issues,
        },
    };
}
/**
 * Extract links from HTML and text
 */
function extractLinks(bodyHtml, bodyText) {
    const links = [];
    // Extract from HTML <a> tags
    const hrefRegex = /href=["']([^"']+)["']/gi;
    let match;
    while ((match = hrefRegex.exec(bodyHtml)) !== null) {
        const url = match[1];
        if (url.startsWith('http')) {
            links.push(url);
        }
    }
    // Extract plain text URLs
    const urlRegex = /https?:\/\/[^\s<>"']+/gi;
    const textMatches = bodyText.match(urlRegex) || [];
    links.push(...textMatches);
    // Remove duplicates
    return Array.from(new Set(links));
}
/**
 * Extract domain from URL
 */
function extractDomain(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname.toLowerCase();
    }
    catch {
        return null;
    }
}
