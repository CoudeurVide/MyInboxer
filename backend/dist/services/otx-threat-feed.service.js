"use strict";
/**
 * AlienVault OTX Threat Feed Service
 * Real-time threat intelligence from community-driven threat feeds
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isOtxAvailable = isOtxAvailable;
exports.analyzeDomainThreat = analyzeDomainThreat;
exports.analyzeEmailThreat = analyzeEmailThreat;
exports.analyzeIPThreat = analyzeIPThreat;
exports.getThreatFeedStatistics = getThreatFeedStatistics;
exports.bulkCheckIndicators = bulkCheckIndicators;
const redis_1 = require("../lib/redis");
const API_BASE = 'https://otx.alienvault.com/api/v1';
const OTX_API_KEY = process.env.OTX_API_KEY;
/**
 * Check if OTX API is available
 */
function isOtxAvailable() {
    return !!OTX_API_KEY;
}
/**
 * Perform a GET request to OTX API
 */
async function otxApiCall(endpoint) {
    if (!OTX_API_KEY) {
        throw new Error('OTX_API_KEY not configured');
    }
    const response = await fetch(`${API_BASE}${endpoint}`, {
        headers: {
            'X-OTX-API-KEY': OTX_API_KEY,
            'Content-Type': 'application/json',
        },
    });
    if (!response.ok) {
        throw new Error(`OTX API error: ${response.status} ${response.statusText}`);
    }
    return response.json();
}
/**
 * Analyze domain reputation from OTX
 */
async function analyzeDomainThreat(domain) {
    if (!isOtxAvailable()) {
        return {
            indicator: domain,
            indicatorType: 'domain',
            reputation: 'unknown',
            threatScore: 0,
            pulseCount: 0,
            pulses: [],
            adversaries: [],
            categories: [],
            countries: [],
        };
    }
    // Try cache first (1 hour TTL)
    const cached = await (0, redis_1.getFromCache)(redis_1.CacheKeys.otxDomain(domain));
    if (cached) {
        return cached;
    }
    try {
        // Get general domain information
        const generalInfo = await otxApiCall(`/indicator/domain/${domain}/general`);
        // Get malware information
        const malwareInfo = await otxApiCall(`/indicator/domain/${domain}/malware`);
        // Get URL list information
        const urlInfo = await otxApiCall(`/indicator/domain/${domain}/url_list`);
        // Get reputation information
        const passiveDns = await otxApiCall(`/indicator/domain/${domain}/passive_dns`);
        // Calculate threat score based on various factors
        let threatScore = 0;
        const pulses = [];
        const adversaries = [];
        const categories = [];
        const countries = [];
        // Add to threat score based on pulse count
        if (generalInfo?.pulse_info?.pulses) {
            threatScore += generalInfo.pulse_info.pulses.length * 20;
            // Process pulses
            generalInfo.pulse_info.pulses.forEach((pulse) => {
                pulses.push({
                    name: pulse.name,
                    description: pulse.description,
                    tags: pulse.tags || [],
                    created: pulse.created,
                });
                // Extract categories and adversaries
                if (pulse.adversary) {
                    adversaries.push(pulse.adversary);
                }
                if (pulse.tags) {
                    categories.push(...pulse.tags);
                }
                if (pulse.indicator) {
                    countries.push(pulse.indicator.country);
                }
            });
        }
        // Add threat score based on malware sightings
        if (malwareInfo?.data && Array.isArray(malwareInfo.data)) {
            threatScore += malwareInfo.data.length * 15;
        }
        // Add threat score based on URL sightings
        if (urlInfo?.url_list && Array.isArray(urlInfo.url_list)) {
            threatScore += urlInfo.url_list.length * 10;
        }
        // Cap at 100
        threatScore = Math.min(100, threatScore);
        // Determine reputation based on threat score
        let reputation;
        if (threatScore >= 60) {
            reputation = 'malicious';
        }
        else if (threatScore >= 20) {
            reputation = 'suspicious';
        }
        else if (threatScore === 0) {
            reputation = 'unknown';
        }
        else {
            reputation = 'clean';
        }
        const result = {
            indicator: domain,
            indicatorType: 'domain',
            reputation,
            threatScore,
            pulseCount: pulses.length,
            pulses,
            adversaries: [...new Set(adversaries)], // Deduplicate
            categories: [...new Set(categories)], // Deduplicate
            countries: [...new Set(countries)].filter(Boolean), // Deduplicate and remove empty
        };
        // Cache for 1 hour
        await (0, redis_1.setInCache)(redis_1.CacheKeys.otxDomain(domain), result, 3600);
        return result;
    }
    catch (error) {
        console.error(`[OTX] Error analyzing domain ${domain}:`, error.message);
        // Return unknown reputation on error but still cache for shorter time
        const result = {
            indicator: domain,
            indicatorType: 'domain',
            reputation: 'unknown',
            threatScore: 0,
            pulseCount: 0,
            pulses: [],
            adversaries: [],
            categories: [],
            countries: [],
        };
        // Cache error result for 15 minutes to avoid repeated API calls
        await (0, redis_1.setInCache)(redis_1.CacheKeys.otxDomain(domain), result, 900);
        return result;
    }
}
/**
 * Analyze email reputation from OTX
 */
async function analyzeEmailThreat(email) {
    if (!isOtxAvailable()) {
        return {
            indicator: email,
            indicatorType: 'email',
            reputation: 'unknown',
            threatScore: 0,
            pulseCount: 0,
            pulses: [],
            adversaries: [],
            categories: [],
            countries: [],
        };
    }
    // Extract domain from email
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain) {
        return {
            indicator: email,
            indicatorType: 'email',
            reputation: 'unknown',
            threatScore: 0,
            pulseCount: 0,
            pulses: [],
            adversaries: [],
            categories: [],
            countries: [],
        };
    }
    // Try cache first (1 hour TTL)
    const cached = await (0, redis_1.getFromCache)(redis_1.CacheKeys.otxEmail(email));
    if (cached) {
        return cached;
    }
    try {
        // First check domain reputation (most common check)
        const domainResult = await analyzeDomainThreat(domain);
        // Then check the email specifically if needed
        const result = {
            indicator: email,
            indicatorType: 'email',
            reputation: domainResult.reputation,
            threatScore: domainResult.threatScore,
            pulseCount: domainResult.pulseCount,
            pulses: domainResult.pulses,
            adversaries: domainResult.adversaries,
            categories: domainResult.categories,
            countries: domainResult.countries,
        };
        // Cache for 1 hour
        await (0, redis_1.setInCache)(redis_1.CacheKeys.otxEmail(email), result, 3600);
        return result;
    }
    catch (error) {
        console.error(`[OTX] Error analyzing email ${email}:`, error.message);
        const result = {
            indicator: email,
            indicatorType: 'email',
            reputation: 'unknown',
            threatScore: 0,
            pulseCount: 0,
            pulses: [],
            adversaries: [],
            categories: [],
            countries: [],
        };
        // Cache error result for 15 minutes
        await (0, redis_1.setInCache)(redis_1.CacheKeys.otxEmail(email), result, 900);
        return result;
    }
}
/**
 * Analyze IP address reputation from OTX
 */
async function analyzeIPThreat(ip) {
    if (!isOtxAvailable()) {
        return {
            indicator: ip,
            indicatorType: 'ip',
            reputation: 'unknown',
            threatScore: 0,
            pulseCount: 0,
            pulses: [],
            adversaries: [],
            categories: [],
            countries: [],
        };
    }
    // Try cache first (1 hour TTL)
    const cached = await (0, redis_1.getFromCache)(redis_1.CacheKeys.otxIp(ip));
    if (cached) {
        return cached;
    }
    try {
        // Get general IP information
        const generalInfo = await otxApiCall(`/indicator/IPv4/${ip}/general`);
        // Get geolocation information
        const geoInfo = await otxApiCall(`/indicator/IPv4/${ip}/geo`);
        // Get reputation information
        const reputationInfo = await otxApiCall(`/indicator/IPv4/${ip}/reputation`);
        // Calculate threat score based on various factors
        let threatScore = 0;
        const pulses = [];
        const adversaries = [];
        const categories = [];
        const countries = [];
        // Add to threat score based on pulse count
        if (generalInfo?.pulse_info?.pulses) {
            threatScore += generalInfo.pulse_info.pulses.length * 25;
            // Process pulses
            generalInfo.pulse_info.pulses.forEach((pulse) => {
                pulses.push({
                    name: pulse.name,
                    description: pulse.description,
                    tags: pulse.tags || [],
                    created: pulse.created,
                });
                // Extract categories and adversaries
                if (pulse.adversary) {
                    adversaries.push(pulse.adversary);
                }
                if (pulse.tags) {
                    categories.push(...pulse.tags);
                }
                if (pulse.indicator) {
                    countries.push(pulse.indicator.country);
                }
            });
        }
        // Add threat score based on reputation
        if (reputationInfo?.reputation) {
            threatScore += reputationInfo.reputation * 2;
        }
        // Cap at 100
        threatScore = Math.min(100, threatScore);
        // Determine reputation based on threat score
        let reputation;
        if (threatScore >= 60) {
            reputation = 'malicious';
        }
        else if (threatScore >= 20) {
            reputation = 'suspicious';
        }
        else if (threatScore === 0) {
            reputation = 'unknown';
        }
        else {
            reputation = 'clean';
        }
        const result = {
            indicator: ip,
            indicatorType: 'ip',
            reputation,
            threatScore,
            pulseCount: pulses.length,
            pulses,
            adversaries: [...new Set(adversaries)], // Deduplicate
            categories: [...new Set(categories)], // Deduplicate
            countries: [...new Set(countries)].filter(Boolean), // Deduplicate and remove empty
        };
        // Cache for 1 hour
        await (0, redis_1.setInCache)(redis_1.CacheKeys.otxIp(ip), result, 3600);
        return result;
    }
    catch (error) {
        console.error(`[OTX] Error analyzing IP ${ip}:`, error.message);
        const result = {
            indicator: ip,
            indicatorType: 'ip',
            reputation: 'unknown',
            threatScore: 0,
            pulseCount: 0,
            pulses: [],
            adversaries: [],
            categories: [],
            countries: [],
        };
        // Cache error result for 15 minutes
        await (0, redis_1.setInCache)(redis_1.CacheKeys.otxIp(ip), result, 900);
        return result;
    }
}
/**
 * Get threat feed statistics
 */
async function getThreatFeedStatistics() {
    if (!isOtxAvailable()) {
        return {
            totalIndicators: 0,
            totalPulses: 0,
            lastUpdated: new Date(),
            trendingPulses: [],
        };
    }
    // Try cache first (15 minutes TTL)
    const cached = await (0, redis_1.getFromCache)(redis_1.CacheKeys.otxStats);
    if (cached) {
        return cached;
    }
    try {
        // Get recent pulses (this gives us trending information)
        const pulses = await otxApiCall('/pulses/subscribed?limit=10');
        const result = {
            totalIndicators: 0, // Placeholder - would require more complex API calls
            totalPulses: pulses?.count || 0,
            lastUpdated: new Date(),
            trendingPulses: (pulses?.results || []).slice(0, 5).map((pulse) => ({
                name: pulse.name,
                description: pulse.description,
                tags: pulse.tags || [],
                created: pulse.created,
            })),
        };
        // Cache for 15 minutes
        await (0, redis_1.setInCache)(redis_1.CacheKeys.otxStats(), result, 900);
        return result;
    }
    catch (error) {
        console.error('[OTX] Error getting threat feed stats:', error.message);
        const result = {
            totalIndicators: 0,
            totalPulses: 0,
            lastUpdated: new Date(),
            trendingPulses: [],
        };
        // Cache error result for 5 minutes
        await (0, redis_1.setInCache)(redis_1.CacheKeys.otxStats, result, 300);
        return result;
    }
}
/**
 * Bulk check multiple indicators
 */
async function bulkCheckIndicators(indicators) {
    const results = new Map();
    // Process sequentially to avoid rate limiting
    for (const indicator of indicators) {
        try {
            let result;
            switch (indicator.type) {
                case 'domain':
                    result = await analyzeDomainThreat(indicator.value);
                    break;
                case 'ip':
                    result = await analyzeIPThreat(indicator.value);
                    break;
                case 'email':
                    result = await analyzeEmailThreat(indicator.value);
                    break;
                default:
                    result = {
                        indicator: indicator.value,
                        indicatorType: indicator.type,
                        reputation: 'unknown',
                        threatScore: 0,
                        pulseCount: 0,
                        pulses: [],
                        adversaries: [],
                        categories: [],
                        countries: [],
                    };
            }
            results.set(indicator.value, result);
            // Brief pause to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 200));
        }
        catch (error) {
            console.error(`[OTX] Error checking indicator ${indicator.value}:`, error);
            results.set(indicator.value, {
                indicator: indicator.value,
                indicatorType: indicator.type,
                reputation: 'unknown',
                threatScore: 0,
                pulseCount: 0,
                pulses: [],
                adversaries: [],
                categories: [],
                countries: [],
            });
        }
    }
    return results;
}
