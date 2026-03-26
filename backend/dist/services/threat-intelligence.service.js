"use strict";
/**
 * Threat Intelligence Service
 * Phase 2 Enhancement: Real-time threat detection using external intelligence
 *
 * This service integrates with threat intelligence sources to:
 * - Check domain age via WHOIS (new domains are suspicious)
 * - Verify IP reputation (blacklist checking)
 * - Check against known phishing campaigns (PhishTank, OpenPhish)
 * - Analyze domain/IP blacklists (Spamhaus, SURBL)
 * - Calculate global threat score (0-100)
 * - Cache results for 15 minutes (reduce API calls)
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.threatIntelligenceService = void 0;
exports.analyzeThreatIntelligence = analyzeThreatIntelligence;
exports.applyThreatIntelligence = applyThreatIntelligence;
exports.batchCheckDomains = batchCheckDomains;
exports.getThreatSummary = getThreatSummary;
const dns_1 = __importDefault(require("dns"));
const util_1 = require("util");
const redis_1 = require("../lib/redis");
const trusted_domains_1 = require("../lib/trusted-domains");
const dnsResolve = (0, util_1.promisify)(dns_1.default.resolve);
const dnsReverse = (0, util_1.promisify)(dns_1.default.reverse);
/**
 * Threat Intelligence Service
 * Checks external threat databases and calculates threat scores
 */
class ThreatIntelligenceService {
    // Cache TTL: 15 minutes (900 seconds)
    CACHE_TTL = 900;
    // Domain age threshold: 30 days
    NEW_DOMAIN_THRESHOLD_DAYS = 30;
    // DNS-based blacklists (DNSBLs)
    // These are queried via DNS lookups (e.g., reverse IP + .zen.spamhaus.org)
    DNS_BLACKLISTS = [
        'zen.spamhaus.org', // Spamhaus composite
        'bl.spamcop.net', // SpamCop
        'b.barracudacentral.org', // Barracuda
        'dnsbl.sorbs.net', // SORBS
        'spam.dnsbl.sorbs.net', // SORBS spam
        'bl.mailspike.net', // Mailspike
        'psbl.surriel.com', // Passive Spam Block List
        'ubl.unsubscore.com', // Unsubscribe Blacklist
    ];
    // Domain-based blacklists (for domain reputation)
    DOMAIN_BLACKLISTS = [
        'dbl.spamhaus.org', // Spamhaus Domain Block List
        'rhsbl.sorbs.net', // SORBS Right-Hand Side BL
        'dbl.surbl.org', // SURBL
        'multi.uribl.com', // URIBL
    ];
    /**
     * Extract domain from email address
     */
    extractDomain(email) {
        const match = email.match(/@([a-zA-Z0-9.-]+)$/);
        return match ? match[1].toLowerCase() : '';
    }
    /**
     * Extract IP address from email headers (Received headers)
     */
    extractSenderIP(headers) {
        const received = headers['received'] || headers['Received'] || '';
        // Parse Received header for IP address
        // Format: "from mail.example.com (mail.example.com [192.0.2.1])"
        const ipMatch = received.match(/\[(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\]/);
        if (ipMatch) {
            return ipMatch[1];
        }
        // Alternative format: "from 192.0.2.1"
        const altMatch = received.match(/from\s+(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
        if (altMatch) {
            return altMatch[1];
        }
        return null;
    }
    /**
     * Check domain age via DNS TXT record or external API
     * Note: Actual WHOIS API integration would require external service
     * For now, we use DNS-based heuristics
     */
    async checkDomainAge(domain) {
        try {
            // Try to resolve domain (basic check)
            await dnsResolve(domain, 'A');
            // In production, you would call a WHOIS API here:
            // const response = await fetch(`https://api.whoisxml.com/v1?apiKey=${API_KEY}&domainName=${domain}`);
            // const data = await response.json();
            // const createdDate = new Date(data.createdDate);
            // const ageInDays = (Date.now() - createdDate.getTime()) / (1000 * 60 * 60 * 24);
            // For now, return null (no WHOIS data)
            // This is a placeholder for actual WHOIS integration
            return {
                age: null,
                isNew: false,
                reason: 'WHOIS integration not configured (placeholder)'
            };
        }
        catch (error) {
            // Domain doesn't resolve (very suspicious)
            return {
                age: null,
                isNew: true, // Treat as new/suspicious
                reason: `Domain ${domain} does not resolve (DNS failure)`
            };
        }
    }
    /**
     * Check if IP is on DNS blacklist
     */
    async checkIPBlacklist(ip) {
        const blacklistedOn = [];
        // Reverse IP for DNSBL query
        // Example: 192.0.2.1 -> 1.2.0.192
        const reversedIP = ip.split('.').reverse().join('.');
        // Check each DNSBL
        for (const dnsbl of this.DNS_BLACKLISTS) {
            try {
                const query = `${reversedIP}.${dnsbl}`;
                const addresses = await dnsResolve(query, 'A');
                // If resolution succeeds, check if it's a valid blacklist response
                // DNSBLs return 127.0.0.x for listed IPs
                if (addresses && addresses.length > 0) {
                    const address = addresses[0];
                    // Only count as blacklisted if it's a 127.0.0.x response (standard DNSBL format)
                    if (address.startsWith('127.0.0.')) {
                        console.log(`[ThreatIntel] IP ${ip} found on ${dnsbl}: ${address}`);
                        blacklistedOn.push(dnsbl);
                    }
                    else {
                        console.log(`[ThreatIntel] IP ${ip} got non-standard response from ${dnsbl}: ${address} (ignored)`);
                    }
                }
            }
            catch (error) {
                // Resolution failure = not blacklisted (expected)
                // NXDOMAIN, SERVFAIL, TIMEOUT all mean not listed
                // Continue to next DNSBL
            }
        }
        return {
            blacklisted: blacklistedOn.length > 0,
            lists: blacklistedOn
        };
    }
    /**
     * Check if domain is on domain blacklist
     */
    async checkDomainBlacklist(domain) {
        const blacklistedOn = [];
        // Check each domain blacklist
        for (const dbl of this.DOMAIN_BLACKLISTS) {
            try {
                const query = `${domain}.${dbl}`;
                const addresses = await dnsResolve(query, 'A');
                // If resolution succeeds, check if it's a valid blacklist response
                // Most blacklists return 127.0.0.x for listed domains
                // Some might return other IPs for false positives/errors
                if (addresses && addresses.length > 0) {
                    const address = addresses[0];
                    // Only count as blacklisted if it's a 127.0.0.x response (standard DNSBL format)
                    if (address.startsWith('127.0.0.')) {
                        console.log(`[ThreatIntel] Domain ${domain} found on ${dbl}: ${address}`);
                        blacklistedOn.push(dbl);
                    }
                    else {
                        console.log(`[ThreatIntel] Domain ${domain} got non-standard response from ${dbl}: ${address} (ignored)`);
                    }
                }
            }
            catch (error) {
                // Resolution failure = not blacklisted (expected)
                // NXDOMAIN, SERVFAIL, TIMEOUT all mean not listed
                // Continue to next DBL
            }
        }
        return {
            blacklisted: blacklistedOn.length > 0,
            lists: blacklistedOn
        };
    }
    /**
     * Check against known phishing campaigns
     * Note: Requires PhishTank API integration
     */
    async checkPhishingCampaigns(email) {
        const domain = this.extractDomain(email.fromEmail);
        // In production, integrate with PhishTank API:
        // const response = await fetch(`https://checkurl.phishtank.com/checkurl/`, {
        //   method: 'POST',
        //   body: `url=${encodeURIComponent(domain)}&format=json&app_key=${API_KEY}`
        // });
        // const data = await response.json();
        // if (data.results.in_database && data.results.verified) {
        //   return { isPhishing: true, reason: 'Found in PhishTank database' };
        // }
        // Placeholder: Check against local pattern database
        const knownPhishingPatterns = [
            /paypal-secure/i,
            /account-verify/i,
            /banking-alert/i,
            /update-required/i,
            /suspended-account/i,
            /verify-identity/i,
        ];
        const bodyLower = (email.body || email.bodyText || '').toLowerCase();
        const subjectLower = email.subject.toLowerCase();
        for (const pattern of knownPhishingPatterns) {
            if (pattern.test(bodyLower) || pattern.test(subjectLower)) {
                return {
                    isPhishing: true,
                    reason: `Matches known phishing pattern: ${pattern.source}`
                };
            }
        }
        return { isPhishing: false, reason: '' };
    }
    /**
     * Calculate IP reputation based on blacklist checks
     */
    calculateIPReputation(ipBlacklists) {
        if (ipBlacklists.length >= 3)
            return 'blacklisted';
        if (ipBlacklists.length >= 1)
            return 'suspicious';
        return 'good';
    }
    /**
     * Analyze threat intelligence for an email
     */
    async analyzeThreatIntelligence(email) {
        const domain = this.extractDomain(email.fromEmail);
        const reasons = [];
        let threatScore = 0;
        // Generate cache key
        const cacheKey = redis_1.CacheKeys.threatIntel(domain);
        // Try cache first (15 minute TTL)
        const cached = await (0, redis_1.getFromCache)(cacheKey);
        if (cached) {
            return cached;
        }
        // CRITICAL FIX: Check if domain is trusted (major companies, government, etc.)
        // Trusted domains should NEVER trigger threat intelligence overrides
        if ((0, trusted_domains_1.isTrustedDomain)(email.fromEmail)) {
            const trustedParent = (0, trusted_domains_1.getTrustedParentDomain)(email.fromEmail);
            console.log(`[ThreatIntel] ✅ Trusted domain detected: ${domain} (parent: ${trustedParent}) - skipping blacklist checks`);
            const trustResult = {
                domainAge: null,
                isNewDomain: false,
                ipReputation: 'good',
                isOnBlacklist: false,
                isKnownPhishing: false,
                domainBlacklists: [],
                ipBlacklists: [],
                threatScore: 0,
                threatLevel: 'none',
                reasons: [`Trusted corporate domain (${trustedParent || domain}) - bypassing threat intelligence`]
            };
            // Cache the result
            await (0, redis_1.setInCache)(cacheKey, trustResult, this.CACHE_TTL);
            return trustResult;
        }
        // Extract sender IP from headers
        const senderIP = email.headers ? this.extractSenderIP(email.headers) : null;
        // Check domain age
        const domainAgeCheck = await this.checkDomainAge(domain);
        const isNewDomain = domainAgeCheck.isNew;
        const domainAge = domainAgeCheck.age;
        if (isNewDomain) {
            threatScore += 25; // Reduced from 40 - new domains are suspicious but not definitive
            reasons.push(domainAgeCheck.reason || 'Domain registered recently (< 30 days)');
        }
        // Check IP blacklist (if we have IP)
        let ipBlacklists = [];
        if (senderIP) {
            const ipBlacklistCheck = await this.checkIPBlacklist(senderIP);
            ipBlacklists = ipBlacklistCheck.lists;
            if (ipBlacklistCheck.blacklisted) {
                // Reduced from 50 - IP blacklists can have false positives
                // Multiple blacklists = more credible
                const ipScore = Math.min(45, 15 * ipBlacklists.length);
                threatScore += ipScore;
                reasons.push(`IP ${senderIP} found on ${ipBlacklists.length} blacklist(s): ${ipBlacklists.join(', ')}`);
            }
        }
        // Check domain blacklist
        const domainBlacklistCheck = await this.checkDomainBlacklist(domain);
        const domainBlacklists = domainBlacklistCheck.lists;
        if (domainBlacklistCheck.blacklisted) {
            // CRITICAL FIX: Reduced from 60 - domain blacklists can have false positives
            // Multiple blacklists = more credible
            const domainScore = Math.min(50, 15 * domainBlacklists.length);
            threatScore += domainScore;
            reasons.push(`Domain ${domain} found on ${domainBlacklists.length} blacklist(s): ${domainBlacklists.join(', ')}`);
            console.log(`[ThreatIntel] ⚠️ Domain blacklist hit: ${domain} on ${domainBlacklists.join(', ')} (score: +${domainScore})`);
        }
        // Check known phishing campaigns
        const phishingCheck = await this.checkPhishingCampaigns(email);
        const isKnownPhishing = phishingCheck.isPhishing;
        if (isKnownPhishing) {
            threatScore += 70; // Increased from 55 - Known phishing is very high confidence
            reasons.push(phishingCheck.reason);
        }
        // Calculate IP reputation
        const ipReputation = senderIP
            ? this.calculateIPReputation(ipBlacklists)
            : 'unknown';
        // Is on any blacklist?
        const isOnBlacklist = domainBlacklists.length > 0 || ipBlacklists.length > 0;
        // Normalize threat score to 0-100
        threatScore = Math.min(100, threatScore);
        // Determine threat level (UPDATED THRESHOLDS to reduce false positives)
        let threatLevel;
        if (threatScore >= 85)
            threatLevel = 'critical'; // Very strong evidence (e.g., known phishing + multiple flags)
        else if (threatScore >= 65)
            threatLevel = 'high'; // Strong evidence (e.g., multiple blacklists)
        else if (threatScore >= 40)
            threatLevel = 'medium'; // Moderate concern (e.g., single blacklist or new domain)
        else if (threatScore >= 20)
            threatLevel = 'low'; // Minor concern
        else
            threatLevel = 'none';
        if (reasons.length === 0) {
            reasons.push('No threats detected in external intelligence sources');
        }
        const threatIntelligence = {
            domainAge,
            isNewDomain,
            ipReputation,
            isOnBlacklist,
            isKnownPhishing,
            domainBlacklists,
            ipBlacklists,
            threatScore,
            threatLevel,
            reasons
        };
        // Cache the result (15 minutes)
        await (0, redis_1.setInCache)(cacheKey, threatIntelligence, this.CACHE_TTL);
        return threatIntelligence;
    }
    /**
     * Apply threat intelligence to classification verdict
     * This should be called AFTER base classification
     */
    applyThreatIntelligence(baseVerdict, baseConfidence, threatIntel) {
        let adjustedVerdict = baseVerdict;
        let adjustedConfidence = baseConfidence;
        // CRITICAL OVERRIDE: Blacklisted domain/IP = always spam
        if (threatIntel.isOnBlacklist) {
            adjustedVerdict = 'spam';
            adjustedConfidence = Math.max(0.95, baseConfidence); // Very high confidence
            console.log(`[ThreatIntel] Overriding ${baseVerdict} → spam (blacklisted: ${[...threatIntel.domainBlacklists, ...threatIntel.ipBlacklists].join(', ')})`);
        }
        // CRITICAL OVERRIDE: Known phishing campaign = always spam
        else if (threatIntel.isKnownPhishing) {
            adjustedVerdict = 'spam';
            adjustedConfidence = Math.max(0.92, baseConfidence);
            console.log(`[ThreatIntel] Overriding ${baseVerdict} → spam (known phishing campaign)`);
        }
        // CRITICAL/HIGH THREAT: Override to spam
        else if (threatIntel.threatLevel === 'critical' || threatIntel.threatLevel === 'high') {
            adjustedVerdict = 'spam';
            adjustedConfidence = Math.max(0.85, baseConfidence);
            console.log(`[ThreatIntel] Overriding ${baseVerdict} → spam (${threatIntel.threatLevel} threat level)`);
        }
        // MEDIUM THREAT: Reduce legit confidence
        else if (threatIntel.threatLevel === 'medium' && baseVerdict === 'legit') {
            adjustedConfidence -= 0.20;
            console.log(`[ThreatIntel] Reducing legit confidence due to medium threat level`);
        }
        // LOW THREAT: Small adjustment
        else if (threatIntel.threatLevel === 'low') {
            adjustedConfidence -= 0.10;
        }
        // NEW DOMAIN: Additional penalty for legit
        if (threatIntel.isNewDomain && baseVerdict === 'legit') {
            adjustedConfidence -= 0.15;
            console.log(`[ThreatIntel] Reducing legit confidence due to new domain`);
        }
        // Normalize confidence
        adjustedConfidence = Math.min(1, Math.max(0, adjustedConfidence));
        return {
            verdict: adjustedVerdict,
            confidence: adjustedConfidence,
            reason: threatIntel.reasons.join('; ')
        };
    }
    /**
     * Batch check multiple domains/IPs (for efficiency)
     */
    async batchCheckDomains(domains) {
        const results = new Map();
        // Check cache first
        const uncachedDomains = [];
        for (const domain of domains) {
            const cached = await (0, redis_1.getFromCache)(redis_1.CacheKeys.threatIntel(domain));
            if (cached) {
                results.set(domain, cached);
            }
            else {
                uncachedDomains.push(domain);
            }
        }
        // Batch check uncached domains (parallel)
        const checks = uncachedDomains.map(async (domain) => {
            // Create minimal email object for analysis
            const email = {
                messageId: `test-${domain}`,
                subject: '',
                from: `test@${domain}`,
                fromEmail: `test@${domain}`,
                to: 'user@example.com',
                date: new Date(),
                bodyText: '',
                body: ''
            };
            const intel = await this.analyzeThreatIntelligence(email);
            results.set(domain, intel);
            return intel;
        });
        await Promise.all(checks);
        return results;
    }
    /**
     * Get threat intelligence summary for analytics
     */
    getThreatSummary(threatIntel) {
        const flags = [];
        if (threatIntel.isOnBlacklist)
            flags.push('blacklisted');
        if (threatIntel.isKnownPhishing)
            flags.push('known_phishing');
        if (threatIntel.isNewDomain)
            flags.push('new_domain');
        if (threatIntel.ipReputation === 'blacklisted')
            flags.push('bad_ip');
        return {
            level: threatIntel.threatLevel,
            score: threatIntel.threatScore,
            flags
        };
    }
}
// Export singleton instance
exports.threatIntelligenceService = new ThreatIntelligenceService();
/**
 * Main export: Analyze threat intelligence
 */
async function analyzeThreatIntelligence(email) {
    return exports.threatIntelligenceService.analyzeThreatIntelligence(email);
}
/**
 * Apply threat intelligence to classification verdict
 */
function applyThreatIntelligence(baseVerdict, baseConfidence, threatIntel) {
    return exports.threatIntelligenceService.applyThreatIntelligence(baseVerdict, baseConfidence, threatIntel);
}
/**
 * Batch check multiple domains
 */
async function batchCheckDomains(domains) {
    return exports.threatIntelligenceService.batchCheckDomains(domains);
}
/**
 * Get threat summary for analytics
 */
function getThreatSummary(threatIntel) {
    return exports.threatIntelligenceService.getThreatSummary(threatIntel);
}
