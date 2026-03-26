"use strict";
/**
 * Domain Reputation Service
 * Provides instant classification signals based on sender domain patterns
 * No training data needed - uses known patterns and heuristics
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDomainReputationSignal = getDomainReputationSignal;
exports.analyzeSenderDomain = analyzeSenderDomain;
exports.isLikelyCorporateSender = isLikelyCorporateSender;
exports.getDomainReputationExplanation = getDomainReputationExplanation;
const redis_1 = require("../lib/redis");
// Known free email providers (lower trust for B2B leads)
const FREE_EMAIL_PROVIDERS = [
    'gmail.com',
    'yahoo.com',
    'hotmail.com',
    'outlook.com',
    'live.com',
    'icloud.com',
    'mail.com',
    'protonmail.com',
    'aol.com',
    'zoho.com',
    'yandex.com',
];
// Known business/enterprise email patterns
const ENTERPRISE_TLD_PATTERNS = [
    /\.com$/,
    /\.co$/,
    /\.io$/,
    /\.ai$/,
    /\.tech$/,
    /\.app$/,
    /\.dev$/,
    /\.net$/,
    /\.org$/,
];
// Suspicious domain patterns (likely spam/marketing)
const SUSPICIOUS_PATTERNS = [
    /\d{4,}/, // 4+ consecutive digits (e.g., mail1234.com)
    /[.-](promo|marketing|deals|offer|sale|discount|newsletter)/i,
    /^(no-?reply|noreply|donotreply)/i,
    /[.-](automated|auto|robot|bot)/i,
    /-{2,}/, // Multiple consecutive hyphens
    /\.(xyz|top|work|click|link|loan|bid)$/, // Known spam TLDs
];
// Known legitimate business domains (partial matches)
const KNOWN_BUSINESS_INDICATORS = [
    /^[a-z][a-z0-9-]{2,30}\.(com|io|co|ai)$/, // Clean business domain pattern
    /\.(gov|edu|mil)$/, // Government, education, military
];
/**
 * Analyze sender email domain for trust signals (synchronous version without cache)
 * Returns immediate classification bonus (no ML training needed)
 */
function getDomainReputationSignalSync(domain) {
    if (!domain) {
        return {
            bonus: 0,
            reason: 'No domain found',
            trustLevel: 'low',
        };
    }
    // HIGH TRUST: Government, education, military
    if (/\.(gov|edu|mil)$/.test(domain)) {
        return {
            bonus: 3,
            reason: 'Government/Education/Military domain',
            trustLevel: 'high',
        };
    }
    // SUSPICIOUS: Known spam patterns
    for (const pattern of SUSPICIOUS_PATTERNS) {
        if (pattern.test(domain)) {
            return {
                bonus: -2,
                reason: `Suspicious pattern: ${pattern.source}`,
                trustLevel: 'suspicious',
            };
        }
    }
    // LOW TRUST: Free email providers (not typically B2B leads)
    if (FREE_EMAIL_PROVIDERS.includes(domain)) {
        return {
            bonus: -1,
            reason: 'Free email provider (low B2B trust)',
            trustLevel: 'low',
        };
    }
    // MEDIUM-HIGH TRUST: Corporate domain pattern
    const isCleanBusinessDomain = ENTERPRISE_TLD_PATTERNS.some(pattern => pattern.test(domain)) &&
        domain.split('.')[0].length >= 3 && // At least 3 chars before TLD
        !/\d{3,}/.test(domain) && // Not too many digits
        !domain.includes('--'); // No double hyphens
    if (isCleanBusinessDomain) {
        return {
            bonus: 2,
            reason: 'Corporate domain pattern',
            trustLevel: 'high',
        };
    }
    // MEDIUM TRUST: Business TLD but not perfectly clean
    if (ENTERPRISE_TLD_PATTERNS.some(pattern => pattern.test(domain))) {
        return {
            bonus: 1,
            reason: 'Business TLD',
            trustLevel: 'medium',
        };
    }
    // NEUTRAL: Unknown domain
    return {
        bonus: 0,
        reason: 'Neutral domain (unknown pattern)',
        trustLevel: 'medium',
    };
}
/**
 * Analyze sender email domain for trust signals (with Redis cache)
 * Returns immediate classification bonus (no ML training needed)
 * Cached for 24 hours to reduce repeated computations
 */
async function getDomainReputationSignal(email) {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) {
        return {
            bonus: 0,
            reason: 'No domain found',
            trustLevel: 'low',
        };
    }
    // Try cache first (24 hour TTL - domain reputation rarely changes)
    const cached = await (0, redis_1.getFromCache)(redis_1.CacheKeys.domainReputation(domain));
    if (cached) {
        return cached;
    }
    // Compute domain reputation
    const signal = getDomainReputationSignalSync(domain);
    // Cache for 24 hours
    await (0, redis_1.setInCache)(redis_1.CacheKeys.domainReputation(domain), signal, 86400);
    return signal;
}
/**
 * Enhanced domain analysis with additional context
 */
async function analyzeSenderDomain(email) {
    const signal = await getDomainReputationSignal(email);
    const domain = email.split('@')[1]?.toLowerCase() || '';
    return {
        signal,
        isCorporate: signal.trustLevel === 'high' && signal.bonus >= 2,
        isFreeEmail: FREE_EMAIL_PROVIDERS.includes(domain),
        isSuspicious: signal.trustLevel === 'suspicious',
    };
}
/**
 * Check if sender domain matches a known good pattern
 * Useful for whitelisting corporate senders
 */
function isLikelyCorporateSender(email) {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain)
        return false;
    // Not a free email provider
    if (FREE_EMAIL_PROVIDERS.includes(domain))
        return false;
    // Has clean business domain pattern
    const isClean = ENTERPRISE_TLD_PATTERNS.some(pattern => pattern.test(domain)) &&
        domain.split('.')[0].length >= 3 &&
        !/\d{3,}/.test(domain) &&
        !SUSPICIOUS_PATTERNS.some(pattern => pattern.test(domain));
    return isClean;
}
/**
 * Get explanation of domain reputation for user-facing display
 */
async function getDomainReputationExplanation(email) {
    const analysis = await analyzeSenderDomain(email);
    const domain = email.split('@')[1] || 'unknown';
    if (analysis.isCorporate) {
        return `Corporate domain (${domain}) - high trust signal`;
    }
    if (analysis.isFreeEmail) {
        return `Free email provider (${domain}) - lower B2B trust`;
    }
    if (analysis.isSuspicious) {
        return `Suspicious domain pattern (${domain}) - ${analysis.signal.reason}`;
    }
    return `Domain: ${domain} - ${analysis.signal.reason}`;
}
