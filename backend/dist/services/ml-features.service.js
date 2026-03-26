"use strict";
/**
 * ML Feature Extraction Service
 * Extracts numerical features from email data for machine learning model
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractMLFeatures = extractMLFeatures;
/**
 * Extract features from email for ML model
 */
async function extractMLFeatures(email, userId, options) {
    const { includeThreatIntel = true, includeUserLists = true, includeHistorical = true, } = options || {};
    // Basic text features
    const subjectLength = email.subject.length;
    const bodyLength = email.bodyText.length;
    const wordCount = email.bodyText.split(/\s+/).filter(word => word.length > 0).length;
    const uniqueWords = new Set(email.bodyText.toLowerCase().match(/\b\w+\b/g) || []).size;
    const uniqueWordRatio = wordCount > 0 ? uniqueWords / wordCount : 0;
    const uppercaseRatio = email.bodyText.length > 0 ?
        (email.bodyText.match(/[A-Z]/g) || []).length / email.bodyText.length : 0;
    const linkCount = (email.bodyText.match(/https?:\/\//g) || []).length;
    const exclamationCount = (email.bodyText.match(/!/g) || []).length;
    const questionCount = (email.bodyText.match(/\?/g) || []).length;
    const dollarSignCount = (email.bodyText.match(/\$/g) || []).length;
    const capitalLetterDensity = (email.bodyText.match(/[A-Z]/g) || []).length;
    const punctuationDensity = (email.bodyText.match(/[!?.]/g) || []).length;
    // Sender features
    const senderDomain = email.fromEmail.split('@')[1]?.toLowerCase();
    const senderNameLength = email.from?.length || 0;
    const senderEmailLength = email.fromEmail.length;
    // Estimate domain age (in a real implementation, this would come from a domain age service)
    const domainAge = estimateDomainAge(senderDomain);
    // Get domain reputation from threat intelligence (OTX, etc.)
    let domainReputation = 0; // Default neutral
    if (includeThreatIntel && senderDomain) {
        try {
            const domainAnalysis = await analyzeDomainReputation(senderDomain);
            domainReputation = mapReputationToScore(domainAnalysis.reputation);
        }
        catch (error) {
            console.error(`[ML-Features] Error getting domain reputation for ${senderDomain}:`, error);
        }
    }
    // Behavioral features
    const timeOfDay = email.date ? new Date(email.date).getHours() : new Date().getHours();
    const dayOfWeek = email.date ? new Date(email.date).getDay() : new Date().getDay();
    // Placeholder for thread features (would need to analyze email threading)
    const threadLength = 1; // Default to 1 if no threading analysis available
    const previousInteraction = false; // Would require history lookup
    const replyToPrevious = false; // Would require threading analysis
    // Phase 2 features
    let phishingScore = 0;
    if (includeThreatIntel) {
        try {
            const phishingResult = await analyzePhishingReputation({
                senderEmail: email.fromEmail,
                subject: email.subject,
                body: email.bodyText,
                urls: extractUrls(email.bodyText),
            });
            phishingScore = phishingResult.confidence * 100; // Convert to 0-100 scale
        }
        catch (error) {
            console.error(`[ML-Features] Error getting phishing score:`, error);
        }
    }
    // Placeholder for attachment risk (would need implementation from Phase 2)
    const attachmentRisk = 0; // Would be 0-1 based on attachment analysis
    // Placeholder for threat intelligence score
    let threatIntelScore = 0;
    if (includeThreatIntel) {
        // Would aggregate scores from various threat intelligence sources
        threatIntelScore = phishingScore * 0.5; // Placeholder calculation
    }
    // Placeholder for URL reputation score
    let urlReputationScore = 50; // Neutral default
    if (includeThreatIntel) {
        const urls = extractUrls(email.bodyText);
        if (urls.length > 0) {
            // Would check each URL against threat intelligence
            urlReputationScore = 30; // Placeholder for suspicious score
        }
        else {
            urlReputationScore = 80; // Good score if no external links
        }
    }
    // Custom list features
    let onUserBlacklist = false;
    let onUserWhitelist = false;
    let onGlobalBlacklist = false;
    if (includeUserLists) {
        // Would implement user list checking
        // onUserBlacklist = await checkUserBlacklist(userId, email.fromEmail);
        // onUserWhitelist = await checkUserWhitelist(userId, email.fromEmail);
    }
    // Heuristic scores
    const spamKeywordsScore = calculateSpamKeywordsScore(email.subject, email.bodyText);
    const legitKeywordsScore = calculateLegitKeywordsScore(email.subject, email.bodyText);
    const urgencyIndicators = calculateUrgencyScore(email.subject, email.bodyText);
    return {
        // Text features
        subjectLength,
        bodyLength,
        wordCount,
        uniqueWordRatio,
        uppercaseRatio,
        linkCount,
        exclamationCount,
        questionCount,
        dollarSignCount,
        capitalLetterDensity,
        punctuationDensity,
        // Sender features
        domainAge,
        domainReputation,
        senderHasProfilePicture: false, // Would require avatar analysis
        senderNameLength,
        senderEmailLength,
        // Behavioral features
        timeOfDay,
        dayOfWeek,
        threadLength,
        previousInteraction,
        replyToPrevious,
        // Phase 2 features
        phishingScore,
        attachmentRisk,
        threatIntelScore,
        urlReputationScore,
        // Custom list features
        onUserBlacklist,
        onUserWhitelist,
        onGlobalBlacklist,
        // Heuristic scores
        spamKeywordsScore,
        legitKeywordsScore,
        urgencyIndicators,
    };
}
/**
 * Calculate estimated domain age (placeholder implementation)
 */
function estimateDomainAge(domain) {
    if (!domain)
        return -365; // Very new if no domain
    // In a real implementation, this would query a domain age service
    // For now, return a random value between -365 (very new) and 3650 (very old)
    return -Math.floor(Math.random() * 100) + 50; // Random value between -50 and 50
}
/**
 * Map reputation string to numerical score
 */
function mapReputationToScore(reputation) {
    switch (reputation) {
        case 'malicious': return -1.0;
        case 'suspicious': return -0.5;
        case 'clean': return 0.7; // Positive bias toward clean
        case 'unknown': return 0.1; // Slightly positive default
        default: return 0;
    }
}
/**
 * Extract URLs from text
 */
function extractUrls(text) {
    const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/g;
    return text.match(urlRegex) || [];
}
/**
 * Calculate spam keyword score
 */
function calculateSpamKeywordsScore(subject, body) {
    const spamKeywords = [
        'urgent', 'act now', 'limited time', 'buy now', 'click here', 'free money',
        'congratulations', 'winner', 'prize', 'guarantee', 'no obligation', 'risk-free',
        'special promotion', 'credit card', 'viagra', 'loan', 'debt', 'mortgage',
        'investment opportunity', 'work from home', 'earn money', 'cash bonus',
        'no credit check', 'extra income', 'lose weight', 'act immediately'
    ];
    const fullText = `${subject} ${body}`.toLowerCase();
    let count = 0;
    for (const keyword of spamKeywords) {
        if (fullText.includes(keyword.toLowerCase())) {
            count++;
        }
    }
    return Math.min(100, count * 10); // Scale: 0-100, 10 points per keyword
}
/**
 * Calculate legitimate email keyword score
 */
function calculateLegitKeywordsScore(subject, body) {
    const legitKeywords = [
        'demo', 'meeting', 'schedule', 'consultation', 'proposal', 'quote',
        'estimate', 'service', 'solution', 'business', 'company', 'corporation',
        'interested', 'need', 'looking for', 'require', 'requirement',
        'purchase', 'buy', 'pricing', 'budget', 'timeline', 'project',
        'opportunity', 'partnership', 'collaboration', 'introduction',
        'recommendation', 'referral', 'contact', 'reach out', 'call',
        'visit', 'present', 'offer', 'service', 'hire', 'work with'
    ];
    const fullText = `${subject} ${body}`.toLowerCase();
    let count = 0;
    for (const keyword of legitKeywords) {
        if (fullText.includes(keyword.toLowerCase())) {
            count++;
        }
    }
    return Math.min(100, count * 8); // Scale: 0-100, 8 points per keyword
}
/**
 * Calculate urgency score
 */
function calculateUrgencyScore(subject, body) {
    const urgencyPhrases = [
        'immediately', 'asap', 'right now', 'today', 'this week', 'urgent',
        'emergency', 'act now', 'before it expires', 'final notice', 'last chance',
        'limited time', 'deadline', 'expire', 'cannot be extended', 'time-sensitive',
        'response required', 'within 24 hours', 'reply by', 'respond urgently'
    ];
    const fullText = `${subject} ${body}`.toLowerCase();
    let count = 0;
    for (const phrase of urgencyPhrases) {
        if (fullText.includes(phrase.toLowerCase())) {
            count++;
        }
    }
    return Math.min(100, count * 12); // Scale: 0-100, 12 points per phrase
}
/**
 * Analyze phishing reputation for ML features
 */
async function analyzePhishingReputation(emailData) {
    // This would integrate with the phishing reports service
    // For now, return a placeholder implementation
    return {
        isPhishing: false,
        confidence: 0.1,
    };
}
/**
 * Analyze domain reputation for ML features
 */
async function analyzeDomainReputation(domain) {
    // This would integrate with OTX threat feeds
    // For now, return a placeholder implementation
    return {
        reputation: 'unknown',
    };
}
