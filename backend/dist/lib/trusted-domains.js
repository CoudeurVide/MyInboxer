"use strict";
/**
 * Trusted Domains List
 * Domains that should NEVER be blocked by threat intelligence
 * These are major corporations, government entities, and well-known services
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLATFORM_WHITELIST = exports.TRUSTED_DOMAINS = void 0;
exports.isPlatformWhitelisted = isPlatformWhitelisted;
exports.isTrustedDomain = isTrustedDomain;
exports.getTrustedParentDomain = getTrustedParentDomain;
exports.TRUSTED_DOMAINS = new Set([
    // MyInboxer (our own domain - ALWAYS trust)
    'myinboxer.com',
    // Major Tech Companies
    'microsoft.com',
    'google.com',
    'apple.com',
    'amazon.com',
    'facebook.com',
    'meta.com',
    'twitter.com',
    'x.com',
    'linkedin.com',
    'salesforce.com',
    'oracle.com',
    'ibm.com',
    'adobe.com',
    'intel.com',
    'cisco.com',
    'hp.com',
    'dell.com',
    'samsung.com',
    'sony.com',
    'netflix.com',
    'zoom.us',
    'slack.com',
    'dropbox.com',
    'atlassian.com',
    'github.com',
    'gitlab.com',
    // Major Email Providers
    'outlook.com',
    'hotmail.com',
    'live.com',
    'gmail.com',
    'yahoo.com',
    'aol.com',
    'icloud.com',
    'protonmail.com',
    'mail.com',
    // Major Banks & Financial Institutions
    'chase.com',
    'wellsfargo.com',
    'bankofamerica.com',
    'citibank.com',
    'capitalone.com',
    'usbank.com',
    'pnc.com',
    'tdbank.com',
    'americanexpress.com',
    'discover.com',
    'paypal.com',
    'stripe.com',
    'square.com',
    // Major eCommerce & Retailers
    'walmart.com',
    'target.com',
    'bestbuy.com',
    'homedepot.com',
    'lowes.com',
    'costco.com',
    'ebay.com',
    'etsy.com',
    'shopify.com',
    // Major Airlines
    'delta.com',
    'united.com',
    'aa.com',
    'southwest.com',
    'jetblue.com',
    // Government & Education
    'gov',
    'edu',
    'mil',
    'irs.gov',
    'usps.com',
    'usps.gov',
    // Major News/Media
    'nytimes.com',
    'wsj.com',
    'cnn.com',
    'bbc.com',
    'reuters.com',
    'bloomberg.com',
    // Major SaaS Platforms
    'hubspot.com',
    'zendesk.com',
    'mailchimp.com',
    'constantcontact.com',
    'sendgrid.com',
    'twilio.com',
    'docusign.com',
]);
/**
 * Platform Whitelist - Domains that should ALWAYS be classified as "lead"
 * These are MyInboxer's own domains and critical system emails
 */
exports.PLATFORM_WHITELIST = new Set([
    'myinboxer.com',
    // Add any other domains that should always be treated as leads
]);
/**
 * Check if email is from platform whitelist (ALWAYS treat as lead)
 */
function isPlatformWhitelisted(email) {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain)
        return false;
    // Check exact match
    if (exports.PLATFORM_WHITELIST.has(domain)) {
        return true;
    }
    // Check if it's a subdomain
    const parts = domain.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
        const parentDomain = parts.slice(i).join('.');
        if (exports.PLATFORM_WHITELIST.has(parentDomain)) {
            return true;
        }
    }
    return false;
}
/**
 * Check if a domain is trusted (should bypass threat intelligence)
 */
function isTrustedDomain(email) {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain)
        return false;
    // Check exact match
    if (exports.TRUSTED_DOMAINS.has(domain)) {
        return true;
    }
    // Check if it's a subdomain of a trusted domain
    // e.g., notifications.microsoft.com should be trusted if microsoft.com is trusted
    const parts = domain.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
        const parentDomain = parts.slice(i).join('.');
        if (exports.TRUSTED_DOMAINS.has(parentDomain)) {
            return true;
        }
    }
    // Check .gov and .edu TLDs
    if (domain.endsWith('.gov') || domain.endsWith('.edu') || domain.endsWith('.mil')) {
        return true;
    }
    return false;
}
/**
 * Get the trusted parent domain if this is a subdomain
 */
function getTrustedParentDomain(email) {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain)
        return null;
    if (exports.TRUSTED_DOMAINS.has(domain)) {
        return domain;
    }
    const parts = domain.split('.');
    for (let i = 0; i < parts.length - 1; i++) {
        const parentDomain = parts.slice(i).join('.');
        if (exports.TRUSTED_DOMAINS.has(parentDomain)) {
            return parentDomain;
        }
    }
    return null;
}
