"use strict";
/**
 * Email Classifier Service
 * Classifies emails as legit, spam, promotion, or clean using heuristics and AI
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.USE_AI_CLASSIFICATION = void 0;
exports.classifyEmail = classifyEmail;
exports.classifyEmails = classifyEmails;
exports.getClassificationStats = getClassificationStats;
exports.classifyEmailHybrid = classifyEmailHybrid;
exports.classifyEmailWithSettings = classifyEmailWithSettings;
exports.classifyEmailWithUserPreferences = classifyEmailWithUserPreferences;
const crypto_1 = __importDefault(require("crypto"));
const redis_1 = require("../lib/redis");
const metrics_service_1 = require("./metrics.service");
const prisma_1 = require("../lib/prisma");
/**
 * Not-spam indicators - phrases and patterns that suggest a legitimate business inquiry
 */
const LEAD_INDICATORS = {
    highValue: [
        // Inquiry keywords
        /\b(interested in|inquir(y|ing) about|looking for|need(ing)?|want(ing)?|require|quote|estimate|pricing|price|cost|purchase)\b/i,
        /\b(question about|asking about|wondering if|would like to|can (you|we))\b/i,
        /\b(consultation|appointment|meeting|call|discuss|speak with|talk to)\b/i,
        // Business context
        /\b(project|contract|proposal|engagement|partnership|collaboration)\b/i,
        /\b(budget|timeline|deadline|urgent|asap|immediately)\b/i,
        /\b(client|customer|business|company|organization)\b/i,
        // Service requests
        /\b(hire|retain|engage|work with|help (us|me) with)\b/i,
        /\b(service|solution|assistance|support|expert)\b/i,
    ],
    mediumValue: [
        /\b(information|details|more info|learn more|tell me)\b/i,
        /\b(available|availability|schedule|when can)\b/i,
        /\b(recommend|suggestion|advice|opinion)\b/i,
    ],
};
/**
 * Spam indicators - common spam patterns
 */
const SPAM_INDICATORS = {
    highSpam: [
        // Self-identification as advertisement
        /\b(this is an? (advertisement|promotional (email|message))|advertising disclosure)\b/i,
        // Marketing spam
        /\b(act now|limited time|hurry|don't miss|exclusive offer|special deal)\b/i,
        /\b(click here|visit now|buy now|order now|shop now)\b/i,
        /\b(free money|make money|earn \$|cash prize|winner|congratulations)\b/i,
        /\b(viagra|cialis|pharmacy|pills|prescription|weight loss)\b/i,
        /\b(take advantage|special offer|monthly (offer|deal)s?|service offer)\b/i,
        // Phishing
        /\b(verify (your )?account|suspended account|unusual activity|confirm (your )?identity)\b/i,
        /\b(urgent action required|immediate action|security alert)\b/i,
        /\b(reset (your )?password|update payment|billing problem)\b/i,
        // Mass marketing / Newsletter indicators (strengthened)
        /\b(unsubscribe|opt.?out|remove (me )?from|mailing list)\b/i,
        /\b(newsletter|bulk mail|mass email)\b/i,
        /\b(view (this )?(email )?in (your )?browser|view online|email preferences)\b/i,
        /\b(manage (your )?(email )?preferences|update (your )?(email )?preferences)\b/i,
        /\b(you('re| are) receiving this (email|message)|sent to you because)\b/i,
        /\b(add us to your address book|whitelist this email)\b/i,
    ],
    mediumSpam: [
        /\b(no.?reply|do not reply)@/i,
        /\b(automated|auto.?generated|system generated)\b/i,
        // Generic sender addresses (common in mass emails)
        /^info@/i,
        /^news(letter)?@/i,
        /^marketing@/i,
        /^updates?@/i,
        /^notifications?@/i,
        /^hello@/i,
        /^contact@/i,
        /^team@/i,
    ],
};
/**
 * Promotion indicators - legitimate marketing emails and newsletters
 */
const PROMOTION_INDICATORS = [
    /\b(sale|discount|coupon|promo|offer|deal)\b/i,
    /\b(\d+% off|save \$|free shipping)\b/i,
    /\b(new arrival|just in|back in stock)\b/i,
    /\b(subscribe|sign up|join (us|now)|follow us)\b/i,
    // Newsletter/charity/organization mass emails
    /\b(donate|donation|giving|support (our|the)|help (us|our|the))\b/i,
    /\b(monthly update|weekly update|latest news|recent (news|updates))\b/i,
    /\b(read more|learn more|find out more|discover more)\b/i,
    /\b(share (this|with)|forward (this|to)|tell (a )?friend)\b/i,
    /\b(connect with us|stay connected|keep in touch)\b/i,
    /\b(upcoming events?|this (month|week)|mark your calendar)\b/i,
    /\b(thank you for (your )?support|we appreciate)\b/i,
];
/**
 * Business email patterns - indicators of professional communication
 */
const BUSINESS_PATTERNS = {
    professionalGreetings: [
        /^(dear|hello|hi|good (morning|afternoon|evening)|greetings)/i,
    ],
    professionalSignatures: [
        /\b(best regards|kind regards|sincerely|thank you|thanks)\b/i,
        /\b(phone|mobile|office|tel|fax):\s*[\d\-\(\)\+\s]+/i,
    ],
    companyDomains: [
        // Common free email providers (less professional)
        /^[^@]+@(gmail|yahoo|hotmail|outlook|aol|icloud|proton(mail)?)\./i,
    ],
};
/**
 * Calculate text complexity score (0-1)
 */
function calculateComplexity(text) {
    const words = text.split(/\s+/);
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    if (words.length === 0 || sentences.length === 0)
        return 0;
    const avgWordLength = words.reduce((sum, w) => sum + w.length, 0) / words.length;
    const avgSentenceLength = words.length / sentences.length;
    // Higher complexity indicates more thoughtful, personalized content
    const complexityScore = Math.min(1, (avgWordLength / 10 + avgSentenceLength / 20) / 2);
    return complexityScore;
}
/**
 * Check if email appears personalized (Enhanced Version - Phase 1)
 * Now supports recipient profile matching for better detection
 */
function analyzePersonalization(email, recipientProfile) {
    const text = `${email.subject} ${email.bodyText}`.toLowerCase();
    const bodyText = email.bodyText;
    const subject = email.subject;
    let score = 0;
    const factors = {
        recipientNameInBody: false,
        recipientNameInGreeting: false,
        companyNameMentioned: false,
        specificProductServiceMentioned: false,
        recipientWorkMentioned: false,
        referencedPastInteraction: false,
        personalizedSignature: false,
        uniqueBusinessContext: false,
        evidenceOfResearch: false,
        directQuestions: 0,
        personalPronouns: false,
        templateLanguage: false
    };
    const reasons = [];
    // Check for recipient name in body (if profile provided)
    if (recipientProfile?.name && recipientProfile.name.length > 2) {
        const namePattern = new RegExp(`\\b${recipientProfile.name.toLowerCase()}\\b`, 'i');
        if (namePattern.test(text)) {
            factors.recipientNameInBody = true;
            score += 3;
            reasons.push('mentions recipient name');
        }
    }
    // Check for recipient name in greeting
    const greetingWithName = /^(hi|hello|dear|good\s+(morning|afternoon|evening))\s+([A-Z][a-z]+)/i;
    const greetingMatch = bodyText.match(greetingWithName);
    if (greetingMatch) {
        factors.recipientNameInGreeting = true;
        score += 4;
        reasons.push('personalized greeting');
    }
    // Check for company name mentioned (if profile provided)
    if (recipientProfile?.companyName && recipientProfile.companyName.length > 2) {
        const companyPattern = new RegExp(`\\b${recipientProfile.companyName.toLowerCase()}\\b`, 'i');
        if (companyPattern.test(text)) {
            factors.companyNameMentioned = true;
            score += 3;
            reasons.push('mentions company name');
        }
    }
    // Check for specific product/service mentioned (if profile provided)
    if (recipientProfile?.services && recipientProfile.services.length > 0) {
        const servicesMentioned = recipientProfile.services.some(service => text.includes(service.toLowerCase()));
        if (servicesMentioned) {
            factors.specificProductServiceMentioned = true;
            score += 4;
            reasons.push('references specific service');
        }
    }
    // Check if recipient's work is mentioned
    const workMentioned = /\b(saw your|noticed your|found your|came across your|read your|viewed your)\s+(work|portfolio|website|article|post|blog|project|case study|design)\b/i;
    if (workMentioned.test(text)) {
        factors.recipientWorkMentioned = true;
        score += 5;
        reasons.push('mentions recipient work/portfolio');
    }
    // Check for past interaction references
    const pastInteraction = /\b(as we discussed|following up|per our|when we (spoke|met|talked)|our (previous )?(conversation|meeting|call)|last (time|week|month))\b/i;
    if (pastInteraction.test(text)) {
        factors.referencedPastInteraction = true;
        score += 5;
        reasons.push('references past interaction');
    }
    // Check for personalized signature (real person contact info)
    const hasPhoneNumber = /\b(phone|mobile|cell|tel|office):\s*[\d\-\(\)\+\s]{7,}/i.test(bodyText);
    const hasRealSignature = /\b(best regards|kind regards|sincerely|thanks|thank you),?\s*\n\s*[A-Z][a-z]+/i.test(bodyText);
    if (hasPhoneNumber || hasRealSignature) {
        factors.personalizedSignature = true;
        score += 2;
        reasons.push('has personal signature');
    }
    // Check for unique business context (specific project details, budget, timeline)
    const businessContext = /\b(project|budget|timeline|deadline|starting|planned for|next (month|quarter|week)|looking to (start|begin|launch))\b/i;
    const hasSpecificDetails = businessContext.test(text) && bodyText.length > 100;
    if (hasSpecificDetails) {
        factors.uniqueBusinessContext = true;
        score += 4;
        reasons.push('contains specific business context');
    }
    // Check for evidence of research (LinkedIn, website mentions, specific knowledge)
    const researchEvidence = /\b(LinkedIn|your website|your company|your blog|read about you|learned about|researched|found you on|came across you)\b/i;
    if (researchEvidence.test(text)) {
        factors.evidenceOfResearch = true;
        score += 5;
        reasons.push('shows evidence of research');
    }
    // Count direct questions (indicates genuine inquiry)
    const questionCount = (bodyText.match(/\?/g) || []).length;
    factors.directQuestions = questionCount;
    if (questionCount >= 1) {
        score += 2;
        reasons.push(`${questionCount} question(s)`);
    }
    if (questionCount >= 3) {
        score += 1; // Bonus for multiple questions
    }
    // Check for personal pronouns in meaningful context
    const personalPronouns = /\b(your (company|business|website|service|product|team|work)|we are|i am|our (company|team|project))\b/i;
    if (personalPronouns.test(text)) {
        factors.personalPronouns = true;
        score += 2;
        reasons.push('uses personal context');
    }
    // Negative indicator: Template/mass mail language
    const templateIndicators = [
        /\b(dear (sir|madam|customer|valued (customer|friend)|friend))\b/i,
        /\b(to whom it may concern|hello there)\b/i,
        /\b(this (is|email) (a|an) (automated|automatic))\b/i,
        /\bunsubscribe\b/i // Mass email indicator
    ];
    const hasTemplateLanguage = templateIndicators.some(pattern => pattern.test(text));
    if (hasTemplateLanguage) {
        factors.templateLanguage = true;
        score -= 3;
        reasons.push('contains template language (penalty)');
    }
    // Short personalized emails with questions are valuable
    if (bodyText.length < 500 && questionCount >= 1 && score > 0) {
        score += 1;
        reasons.push('concise with questions');
    }
    // Determine if personalized (threshold: 5 points)
    const isPersonalized = score >= 5;
    return {
        score,
        factors,
        isPersonalized,
        reason: isPersonalized
            ? `Highly personalized (${score} points): ${reasons.join(', ')}`
            : `Low personalization (${score} points): ${reasons.join(', ') || 'generic content'}`
    };
}
/**
 * Backward-compatible wrapper for existing isPersonalized function
 */
function isPersonalized(email) {
    const analysis = analyzePersonalization(email);
    return analysis.isPersonalized;
}
/**
 * Calculate domain reputation score
 */
function getDomainScore(email) {
    const domain = email.split('@')[1]?.toLowerCase();
    if (!domain)
        return 0;
    let domainScore = 0;
    // Free email providers (lower trust for business leads)
    const freeProviders = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com', 'protonmail.com', 'mail.com'];
    if (freeProviders.includes(domain)) {
        domainScore -= 1; // Penalty for free email claiming to be a business
    }
    else {
        domainScore += 2; // Bonus for corporate domain
    }
    // Known professional domains
    const professionalTLDs = ['.com', '.io', '.co', '.net', '.org', '.ai', '.tech'];
    if (professionalTLDs.some(tld => domain.endsWith(tld))) {
        domainScore += 1;
    }
    // Suspicious patterns
    const suspiciousDomains = [
        /\d{5,}/, // Long number sequences
        /([a-z])\1{3,}/i, // Repeated characters (e.g., aaaa)
        /^temp/i,
        /^test/i,
        /fake/i,
    ];
    if (suspiciousDomains.some(pattern => pattern.test(domain))) {
        domainScore -= 3;
    }
    // Very short domains (often suspicious)
    const domainName = domain.split('.')[0];
    if (domainName.length <= 3) {
        domainScore -= 1;
    }
    return domainScore;
}
/**
 * Get reputation adjustment for confidence score
 */
function getReputationAdjustment(reputation) {
    if (!reputation)
        return 0;
    switch (reputation) {
        case 'trusted':
            return 0.2; // +20% confidence boost
        case 'good':
            return 0.1; // +10% confidence boost
        case 'neutral':
            return 0; // No adjustment
        case 'suspicious':
            return -0.1; // -10% confidence penalty
        case 'blocked':
            return -0.3; // -30% confidence penalty
        default:
            return 0;
    }
}
/**
 * Main classification function using heuristics
 */
function classifyEmail(email, options) {
    const fullText = `${email.subject} ${email.bodyText}`.toLowerCase();
    const subjectLower = email.subject.toLowerCase();
    let notSpamScore = 0;
    let spamScore = 0;
    let promoScore = 0;
    // === Check SPAM indicators ===
    SPAM_INDICATORS.highSpam.forEach((pattern) => {
        if (pattern.test(fullText)) {
            spamScore += 3;
        }
    });
    SPAM_INDICATORS.mediumSpam.forEach((pattern) => {
        if (pattern.test(fullText)) {
            spamScore += 1;
        }
    });
    // === Check LEAD indicators ===
    LEAD_INDICATORS.highValue.forEach((pattern) => {
        if (pattern.test(fullText)) {
            notSpamScore += 2;
        }
    });
    LEAD_INDICATORS.mediumValue.forEach((pattern) => {
        if (pattern.test(fullText)) {
            notSpamScore += 1;
        }
    });
    // === Check PROMOTION indicators ===
    PROMOTION_INDICATORS.forEach((pattern) => {
        if (pattern.test(fullText)) {
            promoScore += 2;
        }
    });
    // === Bonus points for business context ===
    // Professional greeting
    if (BUSINESS_PATTERNS.professionalGreetings.some((p) => p.test(email.bodyText))) {
        notSpamScore += 1;
    }
    // Professional signature
    if (BUSINESS_PATTERNS.professionalSignatures.some((p) => p.test(email.bodyText))) {
        notSpamScore += 1;
    }
    // Domain reputation scoring
    const domainScore = getDomainScore(email.fromEmail);
    if (domainScore > 0) {
        notSpamScore += domainScore; // Add positive domain reputation to lead score
    }
    else if (domainScore < -1) {
        spamScore += Math.abs(domainScore); // Add suspicious domain penalty to spam score
    }
    // Personalization bonus (enhanced detection)
    if (isPersonalized(email)) {
        notSpamScore += 2; // Increased weight for personalization
    }
    // Text complexity (thoughtful emails tend to be more complex)
    const complexity = calculateComplexity(email.bodyText);
    if (complexity > 0.5) {
        notSpamScore += 1;
    }
    // === Determine verdict ===
    let verdict;
    let priority;
    let confidence;
    let reason;
    const totalScore = notSpamScore + spamScore + promoScore;
    // Check for newsletter/mass email signatures (unsubscribe link is a strong indicator)
    const hasUnsubscribe = /\b(unsubscribe|opt.?out|email preferences)\b/i.test(fullText);
    const hasGenericSender = /^(info|news(letter)?|marketing|updates?|notifications?|hello|contact|team)@/i.test(email.fromEmail);
    const isLikelyNewsletter = hasUnsubscribe || hasGenericSender;
    // Improved logic: Consider score combinations, not just individual thresholds
    // Strong lead signals override spam indicators (but NOT if it looks like a newsletter)
    if (notSpamScore >= 5 && spamScore < 6 && !isLikelyNewsletter) {
        verdict = 'legit';
        priority = notSpamScore >= 7 ? 'high' : 'medium';
        confidence = Math.min(0.95, 0.55 + notSpamScore * 0.07);
        reason = 'Contains business inquiry keywords and professional tone';
    }
    // Newsletter/mass email with unsubscribe link - classify as PROMOTION with high confidence
    else if (isLikelyNewsletter && (spamScore >= 3 || promoScore >= 2)) {
        verdict = 'promotion';
        priority = 'low';
        confidence = Math.min(0.92, 0.75 + (spamScore + promoScore) * 0.03);
        reason = hasUnsubscribe
            ? 'Newsletter/mass email (contains unsubscribe link)'
            : 'Mass marketing email (generic sender address)';
    }
    // Clear spam with no legitimate business context
    else if (spamScore >= 5 && notSpamScore < 3) {
        verdict = 'spam';
        priority = 'low';
        confidence = Math.min(0.95, 0.6 + spamScore * 0.08);
        reason = 'Contains common spam patterns and marketing language';
    }
    // Promotional content (marketing but not malicious)
    else if (promoScore >= 4 || (promoScore >= 2 && spamScore >= 2)) {
        verdict = 'promotion';
        priority = 'low';
        confidence = Math.min(0.85, 0.55 + promoScore * 0.08);
        reason = 'Appears to be promotional or marketing content';
    }
    // Moderate lead signals (only if no newsletter indicators)
    else if (notSpamScore >= 3 && spamScore <= 2 && !isLikelyNewsletter) {
        verdict = 'legit';
        priority = 'medium';
        confidence = Math.min(0.75, 0.45 + notSpamScore * 0.08);
        reason = 'Shows potential business interest, review recommended';
    }
    // Has newsletter signals but low spam/promo scores - still classify as promotion
    else if (isLikelyNewsletter) {
        verdict = 'promotion';
        priority = 'low';
        confidence = 0.70;
        reason = 'Likely a newsletter or marketing email';
    }
    // Uncertain classification - needs manual review or AI
    else {
        verdict = 'legit';
        priority = 'medium';
        confidence = 0.4;
        reason = 'Mixed or weak indicators detected, manual review recommended';
    }
    // Apply reputation adjustment to confidence
    const reputationAdjustment = getReputationAdjustment(options?.senderReputation);
    const baseConfidence = confidence;
    confidence = confidence + reputationAdjustment;
    // Special case: Blocked senders should always be marked as spam
    if (options?.senderReputation === 'blocked') {
        verdict = 'spam';
        priority = 'low';
        reason = 'Sender is blocked by user';
    }
    // Special case: Trusted senders with lead indicators get priority boost
    if (options?.senderReputation === 'trusted' && verdict === 'legit') {
        priority = 'high';
        reason = reason + ' (from trusted sender)';
    }
    // Normalize confidence to 0-1 range
    confidence = Math.min(1, Math.max(0, confidence));
    return {
        verdict,
        priority,
        confidence,
        reason,
        reputationAdjustment: reputationAdjustment !== 0 ? reputationAdjustment : undefined,
    };
}
/**
 * Batch classify multiple emails
 */
function classifyEmails(emails) {
    return emails.map((email) => classifyEmail(email));
}
/**
 * Get classification statistics
 */
function getClassificationStats(results) {
    const stats = {
        total: results.length,
        leads: results.filter((r) => r.verdict === 'legit').length,
        spam: results.filter((r) => r.verdict === 'spam').length,
        promotions: results.filter((r) => r.verdict === 'promotion').length,
        highPriority: results.filter((r) => r.priority === 'high').length,
        avgConfidence: results.length > 0
            ? results.reduce((sum, r) => sum + r.confidence, 0) / results.length
            : 0,
    };
    return stats;
}
/**
 * Hybrid classification: Rules first, then AI for uncertain cases, with learning
 * This is the RECOMMENDED classification function for production use
 *
 * Enhanced with domain reputation for instant day-1 accuracy
 */
async function classifyEmailHybrid(email, userId, options) {
    console.log(`[Classifier] 🎯 classifyEmailHybrid called for "${email.subject}" - enable_ai: ${options?.userSettings?.enable_ai_classification ?? 'undefined'}`);
    // ============================================================================
    // STEP -3: DETECT MYINBOXER NOTIFICATION EMAILS (exclude from classification)
    // ============================================================================
    const myInboxerSubjectPatterns = [
        /^📊 Scan Complete:/i,
        /^🎯 Lead Found:/i,
        /^⚠️ Usage Warning:/i,
        /^Welcome to MyInboxer/i,
        /^MyInboxer:/i,
        /MyInboxer notification/i,
    ];
    const isMyInboxerNotification = myInboxerSubjectPatterns.some(pattern => pattern.test(email.subject));
    if (isMyInboxerNotification) {
        console.log(`[Classifier] 🔕 MYINBOXER NOTIFICATION DETECTED: "${email.subject}" - forcing SPAM to remove from inbox`);
        const notificationResult = {
            verdict: 'spam',
            confidence: 1.0,
            priority: 'low',
            reason: `MyInboxer system notification - should not appear in spam folder`,
            usedAI: false,
            processingTime: 0,
        };
        // Track this classification
        try {
            await (0, metrics_service_1.trackClassification)({
                userId,
                mailboxId: email.mailbox_id || userId,
                messageId: email.messageId || 'unknown',
                verdict: 'spam',
                confidence: 1.0,
                processingTime: 0,
                aiUsed: false,
                threatDetected: false,
                timestamp: new Date(),
            });
        }
        catch (error) {
            console.error('[Metrics] Failed to track notification classification:', error);
        }
        return notificationResult;
    }
    // ============================================================================
    // STEP -2: CHECK PLATFORM WHITELIST (MyInboxer emails ALWAYS leads)
    // ============================================================================
    const { isPlatformWhitelisted } = await Promise.resolve().then(() => __importStar(require('../lib/trusted-domains')));
    if (isPlatformWhitelisted(email.fromEmail)) {
        console.log(`[Classifier] ✅ PLATFORM WHITELIST: ${email.fromEmail} - forcing LEAD @ 100%`);
        const whitelistResult = {
            verdict: 'legit',
            confidence: 1.0,
            priority: 'high', // Highest priority
            reason: `Platform whitelist: ${email.fromEmail.split('@')[1]} is a trusted platform domain`,
            usedAI: false,
            processingTime: 0,
        };
        // Track this classification
        try {
            await (0, metrics_service_1.trackClassification)({
                userId,
                mailboxId: email.mailbox_id || userId,
                messageId: email.messageId || 'unknown',
                verdict: 'legit',
                confidence: 1.0,
                processingTime: 0,
                aiUsed: false,
                threatDetected: false,
                timestamp: new Date(),
            });
        }
        catch (error) {
            console.error('[Metrics] Failed to track platform whitelist classification:', error);
        }
        return whitelistResult;
    }
    // ============================================================================
    // STEP -1.5: CHECK USER CONTEXT WHITELIST DOMAINS (from onboarding)
    // ============================================================================
    const senderDomainForWhitelist = email.fromEmail.split('@')[1]?.toLowerCase();
    if (senderDomainForWhitelist) {
        try {
            const userContext = await prisma_1.prisma.userContext.findUnique({
                where: { user_id: userId },
                select: { whitelist_domains: true }
            });
            if (userContext?.whitelist_domains && userContext.whitelist_domains.length > 0) {
                // Check if sender's domain matches any whitelisted domain
                const isUserWhitelisted = userContext.whitelist_domains.some((domain) => {
                    const normalizedDomain = domain.toLowerCase().trim();
                    return senderDomainForWhitelist === normalizedDomain ||
                        senderDomainForWhitelist.endsWith('.' + normalizedDomain);
                });
                if (isUserWhitelisted) {
                    console.log(`[Classifier] ✅ USER CONTEXT WHITELIST: ${senderDomainForWhitelist} is in user's trusted domains - forcing LEAD @ 100%`);
                    const userWhitelistResult = {
                        verdict: 'legit',
                        confidence: 1.0,
                        priority: 'high',
                        reason: `User whitelist: ${senderDomainForWhitelist} is in your trusted domains (from onboarding)`,
                    };
                    // Track this classification
                    try {
                        await (0, metrics_service_1.trackClassification)({
                            userId,
                            mailboxId: email.mailbox_id || userId,
                            messageId: email.messageId || 'unknown',
                            verdict: 'legit',
                            confidence: 1.0,
                            processingTime: 0,
                            aiUsed: false,
                            threatDetected: false,
                            timestamp: new Date(),
                        });
                    }
                    catch (error) {
                        console.error('[Metrics] Failed to track user whitelist classification:', error);
                    }
                    return userWhitelistResult;
                }
            }
        }
        catch (error) {
            console.warn('[Classifier] Failed to check user context whitelist:', error);
        }
    }
    // ============================================================================
    // STEP -1: CHECK CACHE (10-40x faster on cache hits)
    // ============================================================================
    // Generate email hash for cache key (deterministic based on content)
    const emailContent = `${email.fromEmail}:${email.subject}:${email.bodyText.substring(0, 500)}`;
    const emailHash = crypto_1.default
        .createHash('sha256')
        .update(emailContent)
        .digest('hex');
    // Try to get cached classification result
    const cached = await (0, redis_1.getFromCache)(redis_1.CacheKeys.classification(emailHash));
    if (cached) {
        console.log(`[Classifier] 🚀 Cache hit for "${email.subject}" - returning cached result (${cached.verdict} @ ${(cached.confidence * 100).toFixed(0)}%) - SKIPPING AI`);
        // Track metrics for cached results too
        console.log('[Classifier] About to track cached classification...');
        try {
            const metricData = {
                userId,
                mailboxId: email.mailbox_id || userId,
                messageId: email.messageId || emailHash,
                verdict: cached.verdict,
                confidence: cached.confidence,
                processingTime: 0, // Instant from cache
                aiUsed: false, // Cached, no AI used
                threatDetected: cached.verdict === 'spam',
                timestamp: new Date(),
            };
            console.log('[Classifier] Metric data prepared:', JSON.stringify(metricData, null, 2));
            await (0, metrics_service_1.trackClassification)(metricData);
        }
        catch (error) {
            console.error('[Metrics] ❌ Failed to track cached classification:', error);
        }
        return cached;
    }
    console.log(`[Classifier] Cache miss for "${email.subject}" - performing full classification`);
    // Track processing time
    const classificationStartTime = Date.now();
    // Helper function to track classification metrics
    const trackAndReturn = async (result, aiUsed = false, mlScore, behavioralScore, threatDetected = false) => {
        const processingTime = Date.now() - classificationStartTime;
        console.log('[Classifier] trackAndReturn called for:', result.verdict);
        try {
            await (0, metrics_service_1.trackClassification)({
                userId,
                mailboxId: email.mailbox_id || userId, // Fallback to userId if mailboxId not available
                messageId: email.messageId || emailHash,
                verdict: result.verdict,
                confidence: result.confidence,
                processingTime,
                aiUsed,
                mlScore,
                behavioralScore,
                threatDetected,
                timestamp: new Date(),
            });
        }
        catch (error) {
            console.warn('[Classifier] Failed to track classification metric:', error);
            // Don't throw - metrics tracking shouldn't break classification
        }
        return result;
    };
    // ============================================================================
    // Step 0: Check sender learning (if userId provided)
    let senderLearning = null;
    let learningAdjustment = 0;
    let emailAuthResult = null; // Store email authentication result
    if (options?.userId && email.fromEmail) {
        try {
            const { getSenderLearning } = await Promise.resolve().then(() => __importStar(require('./feedback-learning.service')));
            senderLearning = await getSenderLearning(email.fromEmail, options.userId);
            if (senderLearning) {
                learningAdjustment = senderLearning.confidenceAdjustment;
                // If we have strong user preference for this sender, use it
                if (senderLearning.totalMessages >= 5 && senderLearning.userPreference) {
                    const accuracy = senderLearning.correctClassifications /
                        (senderLearning.correctClassifications + senderLearning.incorrectClassifications);
                    if (accuracy >= 0.8) {
                        console.log(`[Classifier] Using learned preference for ${email.fromEmail}: ${senderLearning.userPreference} (${senderLearning.totalMessages} messages, ${(accuracy * 100).toFixed(0)}% accuracy)`);
                        const learnedResult = {
                            verdict: senderLearning.userPreference,
                            priority: senderLearning.userPreference === 'legit' ? 'high' : 'low',
                            confidence: Math.min(0.95, 0.7 + accuracy * 0.2),
                            reason: `Learned from user feedback (${senderLearning.totalMessages} messages)`,
                        };
                        // Cache the learned result (1 hour TTL)
                        await (0, redis_1.setInCache)(redis_1.CacheKeys.classification(emailHash), learnedResult, 300); // 5 min cache
                        return trackAndReturn(learnedResult, false);
                    }
                }
            }
        }
        catch (error) {
            console.warn('[Classifier] Feedback learning failed:', error);
        }
    }
    // NEW: Step 0.5: Get domain reputation signal (instant, no training needed)
    const { getDomainReputationSignal, getDomainReputationExplanation } = await Promise.resolve().then(() => __importStar(require('./domain-reputation.service')));
    const domainSignal = await getDomainReputationSignal(email.fromEmail);
    console.log(`[Classifier] Domain signal for ${email.fromEmail}: ${domainSignal.reason} (${domainSignal.bonus > 0 ? '+' : ''}${domainSignal.bonus})`);
    // NEW: Step 0.6: Get threat intelligence signals
    const { analyzeDomainThreat } = await Promise.resolve().then(() => __importStar(require('./otx-threat-feed.service')));
    const { checkCustomLists } = await Promise.resolve().then(() => __importStar(require('./custom-lists.service')));
    const { checkEmailPhishing } = await Promise.resolve().then(() => __importStar(require('./phishing-reports.service')));
    // Extract domain from email
    const senderDomain = email.fromEmail.split('@')[1]?.toLowerCase();
    // Helper function to extract URLs
    const extractUrls = (text) => {
        const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/g;
        return text.match(urlRegex) || [];
    };
    // Check domain against threat intelligence feeds
    const threatAnalysis = await analyzeDomainThreat(senderDomain);
    console.log(`[Classifier] OTX threat analysis for ${senderDomain}: ${threatAnalysis.reputation} (score: ${threatAnalysis.threatScore})`);
    // Check sender against custom lists
    const customListCheck = await checkCustomLists(userId, email.fromEmail, 'email');
    console.log(`[Classifier] Custom list check for ${email.fromEmail}: ${customListCheck.matched ? (customListCheck.listType || 'unknown') : 'none'}`);
    // Check email against phishing reports
    const phishingCheck = await checkEmailPhishing({
        senderEmail: email.fromEmail,
        subject: email.subject,
        body: email.bodyText,
        urls: extractUrls(email.bodyText),
    });
    console.log(`[Classifier] Phishing check: ${phishingCheck.isPhishing ? 'YES' : 'NO'} (confidence: ${phishingCheck.confidence.toFixed(2)})`);
    // NEW: Step 0.7: ML Feature Extraction (for Phase 3D ML integration)
    const { extractMLFeatures } = await Promise.resolve().then(() => __importStar(require('./ml-features.service')));
    const mlFeatures = await extractMLFeatures(email, userId);
    console.log(`[Classifier] Extracted ${Object.keys(mlFeatures).length} ML features`);
    // NEW Phase 3D: Behavioral Pattern Analysis
    let behavioralAnomalyScore = null;
    let behavioralAdjustment = 0;
    try {
        const { detectEmailAnomalies, predictUserEngagement } = await Promise.resolve().then(() => __importStar(require('./behavioral-patterns.service')));
        // Detect anomalies based on user's historical patterns
        behavioralAnomalyScore = await detectEmailAnomalies(email, userId);
        if (behavioralAnomalyScore.isAnomalous) {
            behavioralAdjustment = -0.15; // Penalize anomalous emails
            console.log(`[Classifier] Behavioral anomaly detected (score: ${behavioralAnomalyScore.score.toFixed(2)}): ${behavioralAnomalyScore.factors.map((f) => f.factor).join(', ')}`);
        }
        else if (behavioralAnomalyScore.score < 0.3) {
            behavioralAdjustment = 0.1; // Boost confidence for normal patterns
            console.log(`[Classifier] Email matches user's behavioral patterns (score: ${behavioralAnomalyScore.score.toFixed(2)})`);
        }
        // Get engagement prediction
        const engagementPrediction = await predictUserEngagement(email, userId);
        console.log(`[Classifier] Engagement prediction - Read: ${(engagementPrediction.willRead * 100).toFixed(0)}%, Reply: ${(engagementPrediction.willReply * 100).toFixed(0)}%`);
        // If user is likely to engage, boost lead signals
        if (engagementPrediction.willReply > 0.5) {
            behavioralAdjustment += 0.05;
        }
    }
    catch (error) {
        console.warn('[Classifier] Behavioral pattern analysis failed:', error);
    }
    // NEW Phase 3D: ML Classification (Simple weighted model for now, TensorFlow.js ready)
    let mlClassificationResult = null;
    let mlAdjustment = 0;
    try {
        const { classifyWithML } = await Promise.resolve().then(() => __importStar(require('./ml-classifier.service')));
        mlClassificationResult = await classifyWithML(email, userId, { useCache: true });
        console.log(`[Classifier] ML classification: ${mlClassificationResult.verdict} @ ${(mlClassificationResult.confidence * 100).toFixed(0)}%`);
        // Use ML result to adjust confidence (weighted average approach)
        // ML gets 30% weight in final decision
        mlAdjustment = (mlClassificationResult.confidence - 0.5) * 0.3;
    }
    catch (error) {
        console.warn('[Classifier] ML classification failed:', error);
    }
    // NEW Phase 1: Advanced classification features
    let authAdjustment = 0;
    let urlAdjustment = 0;
    let contactAdjustment = 0;
    let threadAdjustment = 0;
    let threadAnalysisResult = null;
    let advancedReasons = [];
    // NEW Phase 2: Advanced Security & Intelligence
    let phishingAnalysisResult = null;
    let attachmentAnalysisResult = null;
    let threatIntelResult = null;
    let phishingOverride = false;
    let attachmentOverride = false;
    let threatIntelOverride = false;
    // Step 0.6: Email Authentication (SPF/DKIM/DMARC)
    if (options?.userSettings?.enable_email_authentication !== false) {
        try {
            const { checkEmailAuthentication } = await Promise.resolve().then(() => __importStar(require('./email-auth.service')));
            const senderDomain = email.fromEmail.split('@')[1];
            const authResult = await checkEmailAuthentication(senderDomain);
            // Store auth result in closure so it's available later
            emailAuthResult = authResult;
            const authWeight = options?.userSettings?.auth_trust_weight ?? 1.0;
            authAdjustment = authResult.overall.trustBoost * authWeight;
            advancedReasons.push(`Auth: ${authResult.overall.message}`);
            console.log(`[Classifier] Email auth for ${senderDomain}: ${authResult.overall.trustLevel} (${authAdjustment > 0 ? '+' : ''}${(authAdjustment * 100).toFixed(0)}%)`);
        }
        catch (error) {
            console.warn('[Classifier] Email auth check failed:', error);
        }
    }
    // Step 0.7: URL Reputation Analysis
    if (options?.userSettings?.enable_url_analysis !== false) {
        try {
            const { analyzeURLs } = await Promise.resolve().then(() => __importStar(require('./url-reputation.service')));
            const senderDomain = email.fromEmail.split('@')[1];
            const urlResult = analyzeURLs(email.bodyHtml || '', email.bodyText, senderDomain);
            const urlWeight = options?.userSettings?.url_trust_weight ?? 1.0;
            urlAdjustment = urlResult.trustAdjustment * urlWeight;
            if (urlResult.phishingLikelihood !== 'none') {
                advancedReasons.push(`URLs: ${urlResult.phishingLikelihood} phishing risk (${urlResult.suspiciousLinks}/${urlResult.totalLinks} suspicious)`);
            }
            console.log(`[Classifier] URL analysis: ${urlResult.phishingLikelihood} risk (${urlAdjustment > 0 ? '+' : ''}${(urlAdjustment * 100).toFixed(0)}%)`);
        }
        catch (error) {
            console.warn('[Classifier] URL analysis failed:', error);
        }
    }
    // Step 0.8: Contact History
    if (options?.userSettings?.enable_contact_history !== false && options?.userId) {
        try {
            const { checkContactHistory } = await Promise.resolve().then(() => __importStar(require('./contact-history.service')));
            const contactResult = await checkContactHistory(email.fromEmail, options.userId);
            const contactWeight = options?.userSettings?.contact_trust_weight ?? 1.0;
            contactAdjustment = contactResult.trustBoost * contactWeight;
            if (contactResult.isKnownContact || contactResult.previousThreads > 0) {
                advancedReasons.push(contactResult.message);
            }
            console.log(`[Classifier] Contact history: ${contactResult.message} (${contactAdjustment > 0 ? '+' : ''}${(contactAdjustment * 100).toFixed(0)}%)`);
        }
        catch (error) {
            console.warn('[Classifier] Contact history check failed:', error);
        }
    }
    // Step 0.9: Email Threading Analysis (Phase 1 Improvement)
    // Analyze conversation context to prevent marking replies as spam
    if (options?.userSettings?.enable_thread_analysis !== false) {
        try {
            const { analyzeEmailThread } = await Promise.resolve().then(() => __importStar(require('./thread-analysis.service')));
            const mailboxId = email.mailboxId || email.mailbox_id;
            if (mailboxId) {
                threadAnalysisResult = await analyzeEmailThread(email, mailboxId);
                threadAdjustment = threadAnalysisResult.verdictAdjustment;
                if (threadAnalysisResult.reason) {
                    advancedReasons.push(`Thread: ${threadAnalysisResult.reason}`);
                }
                console.log(`[Classifier] Thread analysis: ${threadAnalysisResult.threadCategory} ` +
                    `(${threadAnalysisResult.threadLength} msgs, engagement: ${(threadAnalysisResult.userEngagement * 100).toFixed(0)}%) ` +
                    `(${threadAdjustment > 0 ? '+' : ''}${(threadAdjustment * 100).toFixed(0)}%)`);
            }
        }
        catch (error) {
            console.warn('[Classifier] Thread analysis failed:', error);
        }
    }
    // NEW Phase 2, Step 1: Advanced Phishing Detection
    try {
        const { analyzePhishing } = await Promise.resolve().then(() => __importStar(require('./advanced-phishing.service')));
        phishingAnalysisResult = await analyzePhishing(email);
        if (phishingAnalysisResult.phishingLikelihood === 'critical' ||
            phishingAnalysisResult.phishingLikelihood === 'high') {
            phishingOverride = true;
            advancedReasons.push(`Phishing: ${phishingAnalysisResult.phishingLikelihood} risk (score: ${phishingAnalysisResult.riskScore})`);
            console.log(`[Classifier] Phishing detection: ${phishingAnalysisResult.phishingLikelihood} risk (${phishingAnalysisResult.riskScore}/100)`);
        }
        else if (phishingAnalysisResult.riskScore > 0) {
            advancedReasons.push(`Phishing check: ${phishingAnalysisResult.phishingLikelihood} (${phishingAnalysisResult.riskScore}/100)`);
            console.log(`[Classifier] Phishing detection: ${phishingAnalysisResult.phishingLikelihood} risk (${phishingAnalysisResult.riskScore}/100)`);
        }
    }
    catch (error) {
        console.warn('[Classifier] Phishing analysis failed:', error);
    }
    // NEW Phase 2, Step 2: Attachment Analysis
    if (email.attachments && email.attachments.length > 0) {
        try {
            const { analyzeAttachments } = await Promise.resolve().then(() => __importStar(require('./attachment-analysis.service')));
            attachmentAnalysisResult = await analyzeAttachments(email);
            if (attachmentAnalysisResult.shouldOverrideVerdict) {
                attachmentOverride = true;
                advancedReasons.push(`Attachments: ${attachmentAnalysisResult.riskLevel} risk (${attachmentAnalysisResult.riskScore}/100)`);
                console.log(`[Classifier] Attachment analysis: ${attachmentAnalysisResult.riskLevel} risk - forcing spam (${attachmentAnalysisResult.riskScore}/100)`);
            }
            else if (attachmentAnalysisResult.riskScore > 0) {
                advancedReasons.push(`Attachments: ${attachmentAnalysisResult.totalAttachments} file(s), ${attachmentAnalysisResult.riskLevel} risk`);
                console.log(`[Classifier] Attachment analysis: ${attachmentAnalysisResult.riskLevel} risk (${attachmentAnalysisResult.riskScore}/100)`);
            }
        }
        catch (error) {
            console.warn('[Classifier] Attachment analysis failed:', error);
        }
    }
    // NEW Phase 2, Step 3: Threat Intelligence
    try {
        const { analyzeThreatIntelligence } = await Promise.resolve().then(() => __importStar(require('./threat-intelligence.service')));
        threatIntelResult = await analyzeThreatIntelligence(email);
        // CRITICAL FIX: Only flag for override if threat is genuinely serious
        // Being on a single blacklist is not enough - need stronger evidence
        const multipleBlacklists = (threatIntelResult.domainBlacklists.length + threatIntelResult.ipBlacklists.length) >= 2;
        const criticalThreat = threatIntelResult.threatLevel === 'critical';
        const knownPhishing = threatIntelResult.isKnownPhishing;
        if (criticalThreat || knownPhishing || multipleBlacklists) {
            threatIntelOverride = true;
            advancedReasons.push(`Threat Intel: ${threatIntelResult.threatLevel} (${threatIntelResult.threatScore}/100, ${threatIntelResult.domainBlacklists.length + threatIntelResult.ipBlacklists.length} blacklist(s))`);
            console.log(`[Classifier] Threat intelligence: ${threatIntelResult.threatLevel} threat - may override (${threatIntelResult.threatScore}/100, blacklists: ${[...threatIntelResult.domainBlacklists, ...threatIntelResult.ipBlacklists].join(', ')})`);
        }
        else if (threatIntelResult.threatScore > 0) {
            advancedReasons.push(`Threat Intel: ${threatIntelResult.threatLevel} (${threatIntelResult.threatScore}/100)`);
            console.log(`[Classifier] Threat intelligence: ${threatIntelResult.threatLevel} threat - informational only (${threatIntelResult.threatScore}/100)`);
        }
    }
    catch (error) {
        console.warn('[Classifier] Threat intelligence failed:', error);
    }
    // Get pre-filter setting from database (controls whether to show rules in reasoning)
    const systemSettings = await prisma_1.prisma.systemSettings.findFirst();
    const showRulesInReasoning = systemSettings?.enable_pre_filter ?? true;
    // Step 1: Try rule-based classification first (fast and free)
    const ruleBasedResult = classifyEmail(email, options);
    // ============================================================================
    // TRANSACTIONAL EMAIL DETECTION: Protect legitimate service emails
    // Registration confirmations, order receipts, security alerts, etc.
    // These often contain unsubscribe links (legally required) but are NOT spam
    // ============================================================================
    const subjectForCheck = email.subject.toLowerCase();
    const senderDomainForCheck = email.fromEmail.split('@')[1]?.toLowerCase() || '';
    const transactionalPatterns = [
        /confirm(ation)?\s+(your|email|account|registration|address)/i,
        /welcome\s+to\s+/i,
        /verify\s+(your|email|account|identity)/i,
        /password\s+(reset|changed|updated)/i,
        /your\s+(order|receipt|invoice|booking|reservation|subscription|payment|shipment|delivery)/i,
        /account\s+(created|activated|verified|confirmed|setup)/i,
        /sign(ed)?\s*(up|in)\s+(confirm|success|complete)/i,
        /activate\s+your/i,
        /security\s+(alert|notice|update|notification)/i,
        /login\s+(from|attempt|notification|alert)/i,
        /two.?factor|2fa|verification\s+code|one.?time\s+(password|code)/i,
        /thank\s+you\s+for\s+(signing|registering|subscribing|joining|your\s+(order|purchase))/i,
        /getting\s+started\s+with/i,
    ];
    const isTransactionalSubject = transactionalPatterns.some(pattern => pattern.test(email.subject));
    if (isTransactionalSubject) {
        const { TRUSTED_DOMAINS } = await Promise.resolve().then(() => __importStar(require('../lib/trusted-domains')));
        const isTrustedDomain = TRUSTED_DOMAINS.has(senderDomainForCheck) ||
            [...TRUSTED_DOMAINS].some(td => senderDomainForCheck.endsWith(`.${td}`));
        const confidence = isTrustedDomain ? 0.92 : 0.78;
        const priority = isTrustedDomain ? 'medium' : 'low';
        console.log(`[Classifier] TRANSACTIONAL OVERRIDE: "${email.subject}" from ${email.fromEmail} (trusted: ${isTrustedDomain}) → legit @ ${confidence}`);
        const transactionalResult = {
            verdict: 'legit',
            priority: priority,
            confidence,
            reason: `Transactional email detected (${isTrustedDomain ? 'trusted domain' : 'review recommended'}): ${email.subject.substring(0, 60)}`,
        };
        await (0, redis_1.setInCache)(redis_1.CacheKeys.classification(emailHash), transactionalResult, 3600);
        try {
            await (0, metrics_service_1.trackClassification)({
                userId,
                mailboxId: email.mailbox_id || userId,
                messageId: email.messageId || emailHash,
                verdict: 'legit',
                confidence,
                processingTime: Date.now() - classificationStartTime,
                aiUsed: false,
                threatDetected: false,
                timestamp: new Date(),
            });
        }
        catch (error) {
            console.error('[Metrics] Failed to track transactional classification:', error);
        }
        return transactionalResult;
    }
    // ============================================================================
    // SUSPICIOUS SENDER DETECTION: Catch obvious spam/phishing by sender patterns
    // Gibberish domains, unicode obfuscation, random addresses
    // ============================================================================
    const senderLocal = email.fromEmail.split('@')[0] || '';
    const suspectDomain = senderDomain || '';
    const subjectRaw = email.subject;
    // Check for suspicious sender patterns
    const suspiciousSenderReasons = [];
    // 1. Gibberish domain: multiple random subdomains (e.g., sv28n6.51olw5.sp35c7.us)
    const domainParts = suspectDomain.split('.');
    const gibberishSubdomains = domainParts.filter(p => /^[a-z0-9]{2,8}$/.test(p) && /\d/.test(p) && /[a-z]/.test(p));
    if (gibberishSubdomains.length >= 2) {
        suspiciousSenderReasons.push(`gibberish domain (${suspectDomain})`);
    }
    // 2. Very long random local part (e.g., qdkmhnvzucgibz.59946555916890)
    if (senderLocal.length > 20 && /[a-z]{6,}/.test(senderLocal) && /\d{6,}/.test(senderLocal)) {
        suspiciousSenderReasons.push(`random sender address`);
    }
    // 3. Unicode obfuscation in subject (bold/italic unicode, mixed scripts)
    // Detects mathematical bold (𝗔-𝘇), mathematical italic, Cyrillic lookalikes, etc.
    const hasUnicodeObfuscation = /[\u{1D400}-\u{1D7FF}]|[\u0400-\u04FF].*[a-zA-Z]|[a-zA-Z].*[\u0400-\u04FF]/u.test(subjectRaw);
    if (hasUnicodeObfuscation) {
        suspiciousSenderReasons.push(`unicode obfuscation in subject`);
    }
    // 4. Domain with excessive length or too many parts
    if (domainParts.length >= 4 || suspectDomain.length > 40) {
        suspiciousSenderReasons.push(`suspicious domain structure`);
    }
    // If suspicious sender detected, immediately classify as spam
    if (suspiciousSenderReasons.length > 0) {
        console.log(`[Classifier] SUSPICIOUS SENDER: ${email.fromEmail} — ${suspiciousSenderReasons.join(', ')} → spam @ 0.95`);
        const suspiciousResult = {
            verdict: 'spam',
            priority: 'low',
            confidence: 0.95,
            reason: `Suspicious sender: ${suspiciousSenderReasons.join(', ')}`,
        };
        await (0, redis_1.setInCache)(redis_1.CacheKeys.classification(emailHash), suspiciousResult, 3600);
        try {
            await (0, metrics_service_1.trackClassification)({
                userId,
                mailboxId: email.mailbox_id || userId,
                messageId: email.messageId || emailHash,
                verdict: 'spam',
                confidence: 0.95,
                processingTime: Date.now() - classificationStartTime,
                aiUsed: false,
                threatDetected: true,
                timestamp: new Date(),
            });
        }
        catch (error) {
            console.error('[Metrics] Failed to track suspicious sender classification:', error);
        }
        return suspiciousResult;
    }
    // ============================================================================
    // NEWSLETTER OVERRIDE: Bypass AI for clear newsletters/mass emails
    // Now distinguishes legitimate newsletters (promotion) from spam with newsletter signals
    // ============================================================================
    const fullTextForNewsletterCheck = `${email.subject} ${email.bodyText}`.toLowerCase();
    const hasUnsubscribeLink = /\b(unsubscribe|opt.?out|email preferences|manage.*subscription|update.*preferences)\b/i.test(fullTextForNewsletterCheck);
    const hasGenericSenderAddress = /^(info|news(letter)?|marketing|updates?|notifications?|hello|contact|team|support|admin|no-?reply)@/i.test(email.fromEmail);
    const hasNewsletterFooter = /\b(view (this )?(email )?in (your )?browser|view online|sent to you because|you('re| are) receiving this)\b/i.test(fullTextForNewsletterCheck);
    const newsletterSignalCount = [hasUnsubscribeLink, hasGenericSenderAddress, hasNewsletterFooter].filter(Boolean).length;
    // Check for spam indicators within newsletter-like emails
    const spamPhrases = [
        'limited time', 'act now', 'exclusive offer', 'special deal', "don't miss",
        '% off', 'discount', 'coupon', 'promo code', 'free shipping', 'save $',
        'click here', 'buy now', 'order now', 'shop now', 'sign up now',
        'last chance', 'expires soon', 'hurry', 'free money', 'guarantee',
        'risk free', 'gift to you', 'you have been selected', "you've won",
        'congratulations', 'claim your', 'act immediately',
    ];
    const foundSpamPhrases = spamPhrases.filter(phrase => fullTextForNewsletterCheck.includes(phrase));
    const hasSpamContent = foundSpamPhrases.length >= 2;
    // If we have 2+ newsletter signals, decide: spam (with spam content) or promotion (clean newsletter)
    if (newsletterSignalCount >= 2 || (hasUnsubscribeLink && ruleBasedResult.verdict === 'promotion')) {
        const isSpamNewsletter = hasSpamContent;
        const verdict = isSpamNewsletter ? 'spam' : 'promotion';
        const confidence = isSpamNewsletter ? 0.92 : 0.88;
        console.log(`[Classifier] NEWSLETTER OVERRIDE: ${email.fromEmail} has ${newsletterSignalCount} newsletter signals, spam content: ${hasSpamContent} → ${verdict} @ ${confidence}`);
        const newsletterOverrideResult = {
            verdict,
            priority: 'low',
            confidence,
            reason: isSpamNewsletter
                ? `Spam with newsletter signals: ${foundSpamPhrases.slice(0, 3).join(', ')}`
                : `Newsletter/mass email detected: ${[
                    hasUnsubscribeLink ? 'unsubscribe link' : null,
                    hasGenericSenderAddress ? `generic sender` : null,
                    hasNewsletterFooter ? 'newsletter footer' : null,
                ].filter(Boolean).join(', ')}`,
        };
        // Cache the newsletter result
        await (0, redis_1.setInCache)(redis_1.CacheKeys.classification(emailHash), newsletterOverrideResult, 3600);
        // Track metrics
        try {
            await (0, metrics_service_1.trackClassification)({
                userId,
                mailboxId: email.mailbox_id || userId,
                messageId: email.messageId || emailHash,
                verdict,
                confidence,
                processingTime: Date.now() - classificationStartTime,
                aiUsed: false,
                threatDetected: false,
                timestamp: new Date(),
            });
        }
        catch (error) {
            console.error('[Metrics] Failed to track newsletter classification:', error);
        }
        return newsletterOverrideResult;
    }
    // Apply ALL adjustments to confidence (including Phase 3D ML and behavioral analysis)
    let adjustedConfidence = ruleBasedResult.confidence +
        learningAdjustment +
        (domainSignal.bonus * 0.05) +
        authAdjustment +
        urlAdjustment +
        contactAdjustment +
        threadAdjustment +
        behavioralAdjustment +
        mlAdjustment;
    adjustedConfidence = Math.min(1, Math.max(0, adjustedConfidence));
    // Phase 3D: Consider ML verdict override if ML is highly confident and disagrees with rules
    if (mlClassificationResult &&
        mlClassificationResult.confidence > 0.8 &&
        mlClassificationResult.verdict !== ruleBasedResult.verdict) {
        console.log(`[Classifier] ML override: ML says ${mlClassificationResult.verdict} @ ${(mlClassificationResult.confidence * 100).toFixed(0)}%, Rules say ${ruleBasedResult.verdict} @ ${(adjustedConfidence * 100).toFixed(0)}%`);
        // If ML is very confident, trust it more
        if (mlClassificationResult.confidence > 0.9) {
            advancedReasons.push(`ML override: High confidence ${mlClassificationResult.verdict} (${(mlClassificationResult.confidence * 100).toFixed(0)}%)`);
        }
    }
    // CRITICAL PHASE 2 OVERRIDES: Check if any Phase 2 component requires forcing spam verdict
    // UPDATED: More intelligent override logic that considers AI verdict confidence
    if (phishingOverride || attachmentOverride || threatIntelOverride) {
        const overrideReasons = [];
        let shouldOverride = false;
        let overrideConfidence = 0.90;
        // Phishing and attachment overrides are still absolute (clear security threats)
        if (phishingOverride && phishingAnalysisResult) {
            overrideReasons.push(`Critical phishing detection (${phishingAnalysisResult.reasons.join(', ')})`);
            shouldOverride = true;
        }
        if (attachmentOverride && attachmentAnalysisResult) {
            overrideReasons.push(`Dangerous attachments (${attachmentAnalysisResult.reasons.join(', ')})`);
            shouldOverride = true;
        }
        // CRITICAL FIX: Threat intelligence override is now more nuanced
        if (threatIntelOverride && threatIntelResult) {
            // Only override if threat is VERY strong OR AI verdict is weak
            const threatIsCritical = threatIntelResult.threatLevel === 'critical';
            const multipleBlacklists = (threatIntelResult.domainBlacklists.length + threatIntelResult.ipBlacklists.length) >= 2;
            const aiVerdictWeak = adjustedConfidence < 0.70;
            if (threatIsCritical || multipleBlacklists || aiVerdictWeak) {
                overrideReasons.push(`Threat intelligence: ${threatIntelResult.threatLevel} (${threatIntelResult.reasons.join(', ')})`);
                shouldOverride = true;
                // Adjust confidence based on AI verdict strength
                if (!aiVerdictWeak && ruleBasedResult.verdict === 'legit') {
                    overrideConfidence = 0.75; // Lower confidence when overriding a strong lead signal
                }
            }
            else {
                // Don't override - AI verdict is strong and threat evidence is weak
                console.log(`[Classifier] Threat intelligence detected but NOT overriding - AI verdict is strong (${ruleBasedResult.verdict} @ ${(adjustedConfidence * 100).toFixed(0)}%) and threat evidence is moderate`);
                threatIntelOverride = false; // Clear the override flag
            }
        }
        if (shouldOverride) {
            const allReasons = [
                overrideReasons.join(' | '),
                domainSignal.reason,
                ...advancedReasons,
                `[Original verdict: ${ruleBasedResult.verdict} @ ${(adjustedConfidence * 100).toFixed(0)}%]`
            ].filter(Boolean).join(' | ');
            console.log(`[Classifier] PHASE 2 OVERRIDE: Forcing spam due to security threats (confidence: ${(overrideConfidence * 100).toFixed(0)}%)`);
            const phase2OverrideResult = {
                verdict: 'spam',
                priority: 'high',
                confidence: overrideConfidence,
                reason: allReasons
            };
            // Cache the override result (1 hour TTL)
            await (0, redis_1.setInCache)(redis_1.CacheKeys.classification(emailHash), phase2OverrideResult, 300); // 5 min cache
            return phase2OverrideResult;
        }
    }
    // Step 2: Determine if we should use AI
    // Use user's custom threshold if available, otherwise use default (now 0.55)
    const CONFIDENCE_THRESHOLD = options?.userSettings?.ai_confidence_threshold ?? 0.55;
    const AI_ENABLED = options?.userSettings?.enable_ai_classification ?? true;
    console.log(`[Classifier] AI decision - enabled: ${AI_ENABLED}, rule confidence: ${(adjustedConfidence * 100).toFixed(0)}%, threshold: ${(CONFIDENCE_THRESHOLD * 100).toFixed(0)}%`);
    // CRITICAL: ALWAYS use AI when enabled - this is our core value proposition
    // Previously we only used AI for low-confidence results, but AI should classify ALL emails
    const isPotentialNotSpam = ruleBasedResult.verdict === 'legit' || domainSignal.trustLevel === 'high';
    const shouldUseAI = AI_ENABLED; // Always use AI when enabled, regardless of confidence
    console.log(`[Classifier] AI decision - potential lead: ${isPotentialNotSpam}, shouldUseAI: ${shouldUseAI}, verdict: ${ruleBasedResult.verdict}`);
    // Helper function to apply thread analysis override
    const applyThreadOverride = (result) => {
        if (!threadAnalysisResult)
            return result;
        const { applyThreadAnalysis } = require('./thread-analysis.service');
        const adjusted = applyThreadAnalysis(result.verdict, result.confidence, threadAnalysisResult);
        return {
            ...result,
            verdict: adjusted.verdict,
            confidence: adjusted.confidence,
            reason: result.reason + (adjusted.reason ? ` | ${adjusted.reason}` : '')
        };
    };
    // If AI is disabled, use rule-based only
    if (!shouldUseAI) {
        console.log(`[Classifier] ⚠️ AI DISABLED - Using rule-based only: ${ruleBasedResult.verdict} @ ${(adjustedConfidence * 100).toFixed(0)}% - "${email.subject}"${learningAdjustment !== 0 ? ` [Learning: ${learningAdjustment > 0 ? '+' : ''}${(learningAdjustment * 100).toFixed(0)}%]` : ''}`);
        const allReasons = [
            ruleBasedResult.reason,
            domainSignal.reason,
            ...advancedReasons,
            learningAdjustment !== 0 ? '(adjusted by learning)' : null
        ].filter(Boolean).join(' | ');
        const finalResult = {
            ...ruleBasedResult,
            confidence: adjustedConfidence,
            reason: allReasons,
        };
        // Apply thread analysis verdict override
        const resultWithThread = applyThreadOverride(finalResult);
        // Cache the result (1 hour TTL)
        await (0, redis_1.setInCache)(redis_1.CacheKeys.classification(emailHash), resultWithThread, 3600);
        // Track metrics (rule-based classification, AI not used)
        const threatDetected = phishingCheck.isPhishing || threatAnalysis.reputation === 'malicious';
        return trackAndReturn(resultWithThread, false, // aiUsed
        mlClassificationResult?.confidence, behavioralAnomalyScore?.score, threatDetected);
    }
    // Step 3: Use AI for better accuracy (low confidence OR potential lead)
    try {
        // Check AI classification limit before using AI
        const { usageService } = await Promise.resolve().then(() => __importStar(require('./usage.service')));
        const aiLimitCheck = await usageService.checkLimitExceeded(userId, 'aiClassifications');
        if (aiLimitCheck.exceeded) {
            console.log(`[Classifier] AI classification limit reached (${aiLimitCheck.currentUsage}/${aiLimitCheck.limit}) - falling back to rule-based classification for "${email.subject}"`);
            // Fall back to rule-based classification
            const allReasons = [
                ruleBasedResult.reason,
                domainSignal.reason,
                ...advancedReasons,
                `(AI limit reached - using rules only)`,
                learningAdjustment !== 0 ? '(adjusted by learning)' : null
            ].filter(Boolean).join(' | ');
            const fallbackResult = {
                ...ruleBasedResult,
                confidence: adjustedConfidence,
                reason: allReasons,
            };
            const resultWithThread = applyThreadOverride(fallbackResult);
            // Cache the fallback result (1 hour TTL)
            await (0, redis_1.setInCache)(redis_1.CacheKeys.classification(emailHash), resultWithThread, 3600);
            // Track metrics (fallback to rules due to limit)
            const threatDetected = phishingCheck.isPhishing || threatAnalysis.reputation === 'malicious';
            return trackAndReturn(resultWithThread, false, // aiUsed (limit reached)
            mlClassificationResult?.confidence, behavioralAnomalyScore?.score, threatDetected);
        }
        // AI limit OK - proceed with AI classification
        const { classifyEmailWithAI } = await Promise.resolve().then(() => __importStar(require('./ai-classifier.service')));
        const customPrompt = options?.userSettings?.classification_prompt;
        const aiResult = await classifyEmailWithAI(email, customPrompt, userId);
        // Increment AI usage counter (only if AI was actually used)
        await usageService.incrementUsage(userId, 'aiClassifications', 1);
        console.log(`[Classifier] AI classification: ${aiResult.verdict} @ ${(aiResult.confidence * 100).toFixed(0)}% - "${email.subject}" (AI count: ${aiLimitCheck.currentUsage + 1}/${aiLimitCheck.limit || 'unlimited'})`);
        // CRITICAL: If authentication critically failed, always force spam regardless of other factors
        if (emailAuthResult?.overall?.trustLevel === 'critical') {
            console.log(`[Classifier] Authentication critically failed - forcing verdict to 'spam' (ignoring AI verdict)`);
            const allReasons = [
                `CRITICAL: Authentication failed - likely spoofed/phishing`,
                aiResult.reason,
                domainSignal.reason,
                ...advancedReasons,
                `[AI: ${aiResult.verdict} @ ${(aiResult.confidence * 100).toFixed(0)}%]`,
                showRulesInReasoning ? `[Rules: ${ruleBasedResult.verdict} @ ${(adjustedConfidence * 100).toFixed(0)}%]` : null
            ].filter(Boolean).join(' | ');
            const criticalFailResult = {
                verdict: 'spam', // Override to spam due to authentication failure
                priority: 'high',
                confidence: 0.95, // Very high confidence due to authentication failure
                reason: allReasons,
            };
            const resultWithThread = applyThreadOverride(criticalFailResult);
            // Cache the critical failure result (1 hour TTL)
            await (0, redis_1.setInCache)(redis_1.CacheKeys.classification(emailHash), resultWithThread, 3600);
            // Track metrics (critical auth failure, AI was used)
            const threatDetected = phishingCheck.isPhishing || threatAnalysis.reputation === 'malicious';
            return trackAndReturn(resultWithThread, true, // aiUsed
            mlClassificationResult?.confidence, behavioralAnomalyScore?.score, threatDetected || true // authentication failure is also a threat
            );
        }
        // CRITICAL: AI verdict is the PRIMARY decision maker
        // Only whitelist/blacklist and critical security threats override AI
        // This ensures AI classification (with user context) is respected
        console.log(`[Classifier] AI verdict: ${aiResult.verdict} @ ${(aiResult.confidence * 100).toFixed(0)}%, Rules: ${ruleBasedResult.verdict} @ ${(adjustedConfidence * 100).toFixed(0)}%`);
        // Apply threat intelligence overrides before final decision
        let finalResult;
        let threatOverride = false;
        let threatReason = '';
        // Check for threat intelligence overrides (security threats override AI)
        if (phishingCheck.isPhishing && phishingCheck.confidence > 0.7) {
            threatReason = `Threat Intelligence: Phishing detected (confidence: ${(phishingCheck.confidence * 100).toFixed(0)}%)`;
            threatOverride = true;
            finalResult = {
                verdict: 'spam',
                priority: 'high',
                confidence: Math.min(0.95, phishingCheck.confidence),
                reason: [aiResult.reason, domainSignal.reason, ...advancedReasons, threatReason].join(' | ')
            };
        }
        else if (threatAnalysis.reputation === 'malicious' && threatAnalysis.threatScore > 70) {
            threatReason = `Threat Intelligence: Domain flagged as malicious (score: ${threatAnalysis.threatScore})`;
            threatOverride = true;
            finalResult = {
                verdict: 'spam',
                priority: 'high',
                confidence: Math.min(0.95, threatAnalysis.threatScore / 100),
                reason: [aiResult.reason, domainSignal.reason, ...advancedReasons, threatReason].join(' | ')
            };
        }
        else if (customListCheck.matched && customListCheck.listType === 'blacklist') {
            threatReason = `Custom Block: Added to user's ${customListCheck.reason || 'blacklist'}`;
            threatOverride = true;
            finalResult = {
                verdict: 'spam',
                priority: 'high',
                confidence: 0.9,
                reason: [aiResult.reason, domainSignal.reason, ...advancedReasons, threatReason].join(' | ')
            };
        }
        else if (customListCheck.matched && customListCheck.listType === 'whitelist') {
            // Whitelist overrides AI - force lead
            const allReasons = [
                `Whitelist: Sender is on your trusted list`,
                aiResult.reason,
                domainSignal.reason,
                ...advancedReasons,
            ].join(' | ');
            finalResult = {
                verdict: 'legit',
                priority: 'high',
                confidence: 0.95,
                reason: allReasons,
            };
        }
        else {
            // NO THREAT OVERRIDE: AI verdict is the PRIMARY decision
            // Trust AI classification over rule-based heuristics
            const allReasons = [
                aiResult.reason,
                domainSignal.reason,
                ...advancedReasons,
                showRulesInReasoning ? `[Rules: ${ruleBasedResult.verdict} @ ${(adjustedConfidence * 100).toFixed(0)}%]` : null
            ].filter(Boolean).join(' | ');
            finalResult = {
                ...aiResult,
                reason: allReasons,
            };
            console.log(`[Classifier] ✅ Using AI verdict: ${aiResult.verdict} (AI is primary decision maker, pre-filter/rules ${showRulesInReasoning ? 'shown' : 'hidden'})`);
        }
        // Apply thread analysis to final result
        const resultWithThread = applyThreadOverride(finalResult);
        // Cache the final result (1 hour TTL)
        await (0, redis_1.setInCache)(redis_1.CacheKeys.classification(emailHash), resultWithThread, 3600);
        // Track metrics (AI classification successful)
        const threatDetected = phishingCheck.isPhishing || threatAnalysis.reputation === 'malicious';
        return trackAndReturn(resultWithThread, true, // aiUsed
        mlClassificationResult?.confidence, behavioralAnomalyScore?.score, threatDetected);
    }
    catch (error) {
        console.error('[Classifier] AI classification failed, using rules:', error.message);
        // Apply threat intelligence overrides to fallback as well
        let fallbackResult;
        if (phishingCheck.isPhishing && phishingCheck.confidence > 0.7) {
            fallbackResult = {
                verdict: 'spam',
                priority: 'high',
                confidence: Math.min(0.95, phishingCheck.confidence),
                reason: [ruleBasedResult.reason, domainSignal.reason, ...advancedReasons, `Threat Intelligence: Phishing detected (confidence: ${(phishingCheck.confidence * 100).toFixed(0)}%)`].join(' | ')
            };
        }
        else if (threatAnalysis.reputation === 'malicious' && threatAnalysis.threatScore > 70) {
            fallbackResult = {
                verdict: 'spam',
                priority: 'high',
                confidence: Math.min(0.95, threatAnalysis.threatScore / 100),
                reason: [ruleBasedResult.reason, domainSignal.reason, ...advancedReasons, `Threat Intelligence: Domain flagged as malicious (score: ${threatAnalysis.threatScore})`].join(' | ')
            };
        }
        else if (customListCheck.matched && customListCheck.listType === 'blacklist') {
            fallbackResult = {
                verdict: 'spam',
                priority: 'high',
                confidence: 0.9,
                reason: [ruleBasedResult.reason, domainSignal.reason, ...advancedReasons, `Custom Block: Added to user's ${customListCheck.reason || 'blacklist'}`].join(' | ')
            };
        }
        else if (customListCheck.matched && customListCheck.listType === 'whitelist') {
            // For whitelist, boost confidence
            const boostedConfidence = Math.min(0.95, adjustedConfidence + 0.1);
            fallbackResult = {
                ...ruleBasedResult,
                confidence: boostedConfidence,
                reason: [`${ruleBasedResult.reason} (Whitelist boost)`, domainSignal.reason, ...advancedReasons, '(AI unavailable)'].join(' | ')
            };
        }
        else {
            const allReasons = [
                ruleBasedResult.reason,
                domainSignal.reason,
                ...advancedReasons,
                '(AI unavailable)'
            ].join(' | ');
            fallbackResult = {
                ...ruleBasedResult,
                confidence: adjustedConfidence,
                reason: allReasons,
            };
        }
        const resultWithThread = applyThreadOverride(fallbackResult);
        // Cache the fallback result (1 hour TTL)
        await (0, redis_1.setInCache)(redis_1.CacheKeys.classification(emailHash), resultWithThread, 3600);
        // Track metrics (fallback to rules, AI failed)
        const threatDetected = phishingCheck.isPhishing || threatAnalysis.reputation === 'malicious';
        return trackAndReturn(resultWithThread, false, // aiUsed (failed)
        mlClassificationResult?.confidence, behavioralAnomalyScore?.score, threatDetected);
    }
}
/**
 * Classify email using custom classification settings
 * This function allows testing and using different classification parameters
 */
async function classifyEmailWithSettings(email, settings, userId, options) {
    const fullText = `${email.subject} ${email.bodyText}`.toLowerCase();
    const subjectLower = email.subject.toLowerCase();
    let notSpamScore = 0;
    let spamScore = 0;
    let promoScore = 0;
    // === Check SPAM indicators ===
    SPAM_INDICATORS.highSpam.forEach((pattern) => {
        if (pattern.test(fullText)) {
            spamScore += settings.spam_high_value_weight;
        }
    });
    SPAM_INDICATORS.mediumSpam.forEach((pattern) => {
        if (pattern.test(fullText)) {
            spamScore += settings.spam_medium_value_weight;
        }
    });
    // === Check NOT_SPAM indicators ===
    LEAD_INDICATORS.highValue.forEach((pattern) => {
        if (pattern.test(fullText)) {
            notSpamScore += settings.not_spam_high_value_weight; // Using not_spam_ (legacy name for compatibility)
        }
    });
    LEAD_INDICATORS.mediumValue.forEach((pattern) => {
        if (pattern.test(fullText)) {
            notSpamScore += settings.not_spam_medium_value_weight; // Using not_spam_ (legacy name for compatibility)
        }
    });
    // === Check PROMOTION indicators ===
    PROMOTION_INDICATORS.forEach((pattern) => {
        if (pattern.test(fullText)) {
            promoScore += settings.promo_weight;
        }
    });
    // === Domain reputation scoring with custom values ===
    const fromDomain = email.fromEmail.split('@')[1]?.toLowerCase();
    if (fromDomain) {
        const freeProviders = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com'];
        if (freeProviders.includes(fromDomain)) {
            notSpamScore += settings.free_domain_penalty;
        }
        else {
            notSpamScore += settings.corporate_domain_bonus;
        }
        // Suspicious patterns
        const suspiciousDomains = [/\d{5,}/, /([a-z])\1{3,}/i];
        if (suspiciousDomains.some(pattern => pattern.test(fromDomain))) {
            notSpamScore += settings.suspicious_domain_penalty;
        }
        // Very short domains
        const domainName = fromDomain.split('.')[0];
        if (domainName.length <= 3) {
            notSpamScore += settings.short_domain_penalty;
        }
    }
    // === Personalization bonus ===
    if (isPersonalized(email)) {
        notSpamScore += settings.personalization_weight;
    }
    // === Determine verdict using custom thresholds ===
    let verdict;
    let priority;
    let confidence;
    let reason;
    // Strong lead signals override spam indicators
    if (notSpamScore >= settings.not_spam_min_score && spamScore < settings.not_spam_max_spam_score) {
        verdict = 'legit';
        priority = notSpamScore >= settings.not_spam_high_priority_score ? 'high' : 'medium';
        confidence = Math.min(0.95, settings.not_spam_base_confidence + notSpamScore * settings.not_spam_confidence_multiplier);
        reason = 'Contains business inquiry keywords and professional tone';
    }
    // Clear spam with no legitimate business context
    else if (spamScore >= settings.spam_min_score && notSpamScore < settings.spam_max_not_spam_score) {
        verdict = 'spam';
        priority = 'low';
        confidence = Math.min(0.95, settings.spam_base_confidence + spamScore * settings.spam_confidence_multiplier);
        reason = 'Contains common spam patterns and marketing language';
    }
    // Promotional content
    else if (promoScore >= settings.promo_min_score || (promoScore >= 2 && spamScore >= 2)) {
        verdict = 'promotion';
        priority = 'low';
        confidence = Math.min(0.85, settings.promo_base_confidence + promoScore * settings.promo_confidence_multiplier);
        reason = 'Appears to be promotional or marketing content';
    }
    // Moderate lead signals
    else if (notSpamScore >= settings.moderate_not_spam_min_score && spamScore <= settings.moderate_not_spam_max_spam) {
        verdict = 'legit';
        priority = 'medium';
        confidence = Math.min(0.75, 0.45 + notSpamScore * 0.08);
        reason = 'Shows potential business interest, review recommended';
    }
    // Uncertain classification
    else {
        verdict = 'legit';
        priority = 'medium';
        confidence = 0.4;
        reason = 'Mixed or weak indicators detected, manual review recommended';
    }
    // Apply reputation adjustment if provided
    const reputationAdjustment = getReputationAdjustment(options?.senderReputation);
    confidence = confidence + reputationAdjustment;
    // Special cases for reputation
    if (options?.senderReputation === 'blocked') {
        verdict = 'spam';
        priority = 'low';
        reason = 'Sender is blocked by user';
    }
    if (options?.senderReputation === 'trusted' && verdict === 'legit') {
        priority = 'high';
        reason = reason + ' (from trusted sender)';
    }
    // NEW: Threat Intelligence Integration for classifyEmailWithSettings
    // Check for threat intelligence overrides after rule-based classification
    try {
        const { analyzeDomainThreat } = await Promise.resolve().then(() => __importStar(require('./otx-threat-feed.service')));
        const { checkCustomLists } = await Promise.resolve().then(() => __importStar(require('./custom-lists.service')));
        const { checkEmailPhishing } = await Promise.resolve().then(() => __importStar(require('./phishing-reports.service')));
        // Extract sender domain
        const senderDomain = email.fromEmail.split('@')[1]?.toLowerCase();
        // Check domain against threat intelligence feeds
        const threatAnalysis = await analyzeDomainThreat(senderDomain);
        // Check sender against custom lists
        const customListCheck = await checkCustomLists(userId, email.fromEmail, 'email');
        // Check email against phishing reports
        const phishingCheck = await checkEmailPhishing({
            senderEmail: email.fromEmail,
            subject: email.subject,
            body: email.bodyText,
            urls: extractUrls(email.bodyText),
        });
        // Apply threat intelligence overrides
        if (phishingCheck.isPhishing && phishingCheck.confidence > 0.7) {
            verdict = 'spam';
            priority = 'high';
            confidence = Math.min(0.95, phishingCheck.confidence);
            reason = `${reason} | Threat Intelligence: Phishing detected (confidence: ${(phishingCheck.confidence * 100).toFixed(0)}%)`;
        }
        else if (threatAnalysis.reputation === 'malicious' && threatAnalysis.threatScore > 70) {
            verdict = 'spam';
            priority = 'high';
            confidence = Math.min(0.95, threatAnalysis.threatScore / 100);
            reason = `${reason} | Threat Intelligence: Domain flagged as malicious (score: ${threatAnalysis.threatScore})`;
        }
        else if (customListCheck.matched && customListCheck.listType === 'blacklist') {
            verdict = 'spam';
            priority = 'high';
            confidence = 0.9;
            reason = `${reason} | Custom Block: Added to user's ${customListCheck.reason || 'blacklist'}`;
        }
        else if (customListCheck.matched && customListCheck.listType === 'whitelist') {
            // For whitelist, boost confidence if it's for lead
            if (verdict === 'legit') {
                confidence = Math.min(0.95, confidence + 0.1);
                reason = `${reason} | Whitelist boost`;
            }
        }
    }
    catch (error) {
        console.warn('[ClassifierWithSettings] Threat intelligence check failed:', error);
        // Continue with original classification if threat intelligence fails
    }
    // Normalize confidence after threat intelligence adjustments
    confidence = Math.min(1, Math.max(0, confidence));
    return {
        verdict,
        priority,
        confidence,
        reason,
        reputationAdjustment: reputationAdjustment !== 0 ? reputationAdjustment : undefined,
    };
}
// Helper function to extract URLs
function extractUrls(text) {
    const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/g;
    return text.match(urlRegex) || [];
}
/**
 * Enable/disable AI classification globally
 */
exports.USE_AI_CLASSIFICATION = process.env.USE_AI_CLASSIFICATION !== 'false';
/**
 * Classify email with user preferences applied
 * This function integrates user-level overrides (strictness, AI power, domain rules)
 * with application-level classification settings
 */
async function classifyEmailWithUserPreferences(email, userId, options) {
    console.log(`[Classifier] 🔍 classifyEmailWithUserPreferences called for "${email.subject}"`);
    const { prisma } = await Promise.resolve().then(() => __importStar(require('../lib/prisma')));
    const { getUserPreferences, getStrictnessMultiplier, getAIThreshold, isWhitelisted, isBlacklisted, } = await Promise.resolve().then(() => __importStar(require('./user-classification-preferences.service')));
    // Load user preferences
    const preferences = await getUserPreferences(userId);
    console.log(`[Classifier] User preferences loaded - strictness: ${preferences.strictness_level}, AI aggressiveness: ${preferences.ai_aggressiveness}`);
    // Extract domain from email
    const domain = email.fromEmail.split('@')[1]?.toLowerCase();
    // Check whitelist - always classify as lead
    if (domain && isWhitelisted(domain, preferences)) {
        console.log(`[Classifier] ✅ Domain ${domain} is whitelisted for user ${userId} - forcing LEAD classification`);
        return {
            verdict: 'legit',
            priority: 'high',
            confidence: 1.0,
            reason: `Domain ${domain} is in your whitelist`,
        };
    }
    // Check blacklist - always classify as spam
    if (domain && isBlacklisted(domain, preferences)) {
        console.log(`[Classifier] ❌ Domain ${domain} is blacklisted for user ${userId} - forcing SPAM classification`);
        return {
            verdict: 'spam',
            priority: 'low',
            confidence: 1.0,
            reason: `Domain ${domain} is in your blacklist`,
        };
    }
    // CRITICAL: Trusted sender override - user has explicitly confirmed this sender as legit
    // reputation_score='trusted' means user_confirmed_not_spam >= 3 (strong signal)
    // This must override AI/rules to prevent misclassification of known-good senders
    if (options?.senderReputation === 'trusted') {
        console.log(`[Classifier] ✅ Sender ${email.fromEmail} is TRUSTED (user-confirmed) - forcing LEGIT classification`);
        return {
            verdict: 'legit',
            priority: 'high',
            confidence: 0.98,
            reason: 'Sender is trusted by user (previously confirmed as legitimate)',
        };
    }
    // Blocked sender override - user has explicitly marked this sender as spam
    if (options?.senderReputation === 'blocked') {
        console.log(`[Classifier] 🚫 Sender ${email.fromEmail} is BLOCKED (user-marked spam) - forcing SPAM classification`);
        return {
            verdict: 'spam',
            priority: 'low',
            confidence: 0.98,
            reason: 'Sender is blocked by user (previously marked as spam)',
        };
    }
    // Load system classification settings
    let settings = await prisma.classificationSettings.findFirst({
        orderBy: { created_at: 'desc' },
        take: 1,
    });
    console.log(`[Classifier] 📊 Database settings loaded - enable_ai_classification: ${settings?.enable_ai_classification ?? 'NULL (no settings found)'}`);
    if (!settings) {
        // Create default settings if none exist
        settings = await prisma.classificationSettings.create({
            data: {
                user_id: userId, // Legacy field, will be removed in future
                not_spam_high_value_weight: 2,
                not_spam_medium_value_weight: 1,
                spam_high_value_weight: 3,
                spam_medium_value_weight: 1,
                promo_weight: 2,
                personalization_weight: 2,
                free_domain_penalty: -1,
                corporate_domain_bonus: 2,
                suspicious_domain_penalty: -3,
                short_domain_penalty: -1,
                not_spam_min_score: 4,
                not_spam_max_spam_score: 6,
                not_spam_high_priority_score: 6,
                spam_min_score: 5,
                spam_max_not_spam_score: 3,
                promo_min_score: 4,
                moderate_not_spam_min_score: 3,
                moderate_not_spam_max_spam: 2,
                not_spam_base_confidence: 0.55,
                not_spam_confidence_multiplier: 0.07,
                spam_base_confidence: 0.60,
                spam_confidence_multiplier: 0.08,
                promo_base_confidence: 0.55,
                promo_confidence_multiplier: 0.08,
                ai_confidence_threshold: 0.65,
                enable_ai_classification: true,
                enable_email_authentication: true,
                enable_url_analysis: true,
                enable_contact_history: true,
                auth_trust_weight: 1.0,
                url_trust_weight: 1.0,
                contact_trust_weight: 1.0,
            },
        });
    }
    // Apply user's strictness level to thresholds
    const strictnessMultiplier = getStrictnessMultiplier(preferences.strictness_level);
    const adjustedSettings = {
        ...settings,
        // Apply strictness to all threshold values
        not_spam_min_score: Math.round(settings.not_spam_min_score * strictnessMultiplier),
        not_spam_max_spam_score: Math.round(settings.not_spam_max_spam_score * strictnessMultiplier),
        not_spam_high_priority_score: Math.round(settings.not_spam_high_priority_score * strictnessMultiplier),
        spam_min_score: Math.round(settings.spam_min_score * strictnessMultiplier),
        spam_max_not_spam_score: Math.round(settings.spam_max_not_spam_score * strictnessMultiplier),
        promo_min_score: Math.round(settings.promo_min_score * strictnessMultiplier),
        moderate_not_spam_min_score: Math.round(settings.moderate_not_spam_min_score * strictnessMultiplier),
        moderate_not_spam_max_spam: Math.round(settings.moderate_not_spam_max_spam * strictnessMultiplier),
        // Apply AI aggressiveness to AI threshold
        ai_confidence_threshold: getAIThreshold(preferences.ai_aggressiveness),
    };
    console.log(`[Classifier] User preferences applied - Strictness: ${preferences.strictness_level} (${strictnessMultiplier}x), AI: ${preferences.ai_aggressiveness} (${adjustedSettings.ai_confidence_threshold})`);
    // Use the hybrid classification with adjusted settings
    return await classifyEmailHybrid(email, userId, {
        ...options,
        userSettings: adjustedSettings,
    });
}
