"use strict";
/**
 * Advanced Phishing Detection Service
 * Phase 2 Enhancement: Multi-layer phishing protection
 *
 * Detects:
 * - DKIM replay attacks
 * - Homograph attacks (Unicode lookalike domains)
 * - Brand impersonation
 * - Display name spoofing
 * - Credential harvesting
 * - Invoice fraud
 * - Enhanced urgency tactics
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.advancedPhishingDetector = exports.AdvancedPhishingDetector = void 0;
exports.analyzePhishing = analyzePhishing;
/**
 * Known legitimate brand domains for impersonation detection
 */
const KNOWN_BRANDS = {
    google: ['google.com', 'gmail.com', 'googlemail.com'],
    microsoft: ['microsoft.com', 'outlook.com', 'live.com', 'hotmail.com'],
    amazon: ['amazon.com', 'amazon.co.uk', 'amazonses.com'],
    paypal: ['paypal.com'],
    apple: ['apple.com', 'icloud.com'],
    facebook: ['facebook.com', 'fb.com'],
    linkedin: ['linkedin.com'],
    stripe: ['stripe.com'],
    dropbox: ['dropbox.com'],
    salesforce: ['salesforce.com'],
    adobe: ['adobe.com'],
    netflix: ['netflix.com'],
    uber: ['uber.com'],
    twitter: ['twitter.com', 'x.com'],
    instagram: ['instagram.com'],
};
/**
 * Advanced Phishing Detector
 */
class AdvancedPhishingDetector {
    /**
     * Analyze email for phishing indicators
     */
    async analyzePhishing(email) {
        const reasons = [];
        let riskScore = 0;
        // Run all detection mechanisms
        const dkimReplay = this.detectDKIMReplay(email);
        const homograph = this.detectHomographAttack(email.fromEmail);
        const brandImpersonation = this.detectBrandImpersonation(email);
        const displaySpoofing = this.detectDisplayNameSpoofing(email);
        const credentialHarvest = this.detectCredentialHarvesting(email);
        const invoiceFraud = this.detectInvoiceFraud(email);
        const urgencyTactics = this.detectUrgencyTactics(email);
        const suspiciousLinks = this.detectSuspiciousLinks(email);
        // Calculate risk score
        if (dkimReplay.detected) {
            riskScore += 40;
            reasons.push(dkimReplay.reason);
        }
        if (homograph.detected) {
            riskScore += 50;
            reasons.push(homograph.reason);
        }
        if (brandImpersonation.detected) {
            riskScore += 45;
            reasons.push(brandImpersonation.reason);
        }
        if (displaySpoofing.detected) {
            riskScore += 35;
            reasons.push(displaySpoofing.reason);
        }
        if (credentialHarvest.detected) {
            riskScore += 50;
            reasons.push(credentialHarvest.reason);
        }
        if (invoiceFraud.detected) {
            riskScore += 45;
            reasons.push(invoiceFraud.reason);
        }
        if (urgencyTactics.detected) {
            riskScore += 20;
            reasons.push(urgencyTactics.reason);
        }
        if (suspiciousLinks.detected) {
            riskScore += 30;
            reasons.push(suspiciousLinks.reason);
        }
        // Determine overall phishing likelihood
        let phishingLikelihood;
        if (riskScore >= 80) {
            phishingLikelihood = 'critical';
        }
        else if (riskScore >= 60) {
            phishingLikelihood = 'high';
        }
        else if (riskScore >= 40) {
            phishingLikelihood = 'medium';
        }
        else if (riskScore >= 20) {
            phishingLikelihood = 'low';
        }
        else {
            phishingLikelihood = 'none';
        }
        return {
            dkimReplayAttack: dkimReplay.detected,
            homographAttack: homograph.detected,
            brandImpersonation: brandImpersonation.detected,
            urgencyTactics: urgencyTactics.detected,
            credentialHarvesting: credentialHarvest.detected,
            invoiceFraud: invoiceFraud.detected,
            displayNameSpoofing: displaySpoofing.detected,
            suspiciousLinks: suspiciousLinks.detected,
            phishingLikelihood,
            riskScore: Math.min(100, riskScore),
            reasons
        };
    }
    /**
     * Detect DKIM replay attacks
     * Checks if DKIM signature timestamp is suspiciously old
     */
    detectDKIMReplay(email) {
        try {
            const headers = email.headers || {};
            const dkimSignature = headers['dkim-signature'] || headers['DKIM-Signature'];
            if (!dkimSignature) {
                return { detected: false, reason: '' };
            }
            // Extract timestamp from DKIM signature (t= parameter)
            const timestampMatch = dkimSignature.match(/t=(\d+)/);
            if (!timestampMatch) {
                return { detected: false, reason: '' };
            }
            const signatureTime = parseInt(timestampMatch[1], 10) * 1000; // Convert to ms
            const receivedTime = email.received_at ? new Date(email.received_at).getTime() : Date.now();
            // If signature is more than 48 hours old, potential replay attack
            const ageHours = (receivedTime - signatureTime) / (1000 * 60 * 60);
            if (ageHours > 48) {
                return {
                    detected: true,
                    reason: `DKIM signature is ${ageHours.toFixed(0)} hours old - potential replay attack`
                };
            }
            return { detected: false, reason: '' };
        }
        catch (error) {
            return { detected: false, reason: '' };
        }
    }
    /**
     * Detect homograph attacks (Unicode lookalike characters)
     * e.g., "аpple.com" (Cyrillic 'а') vs "apple.com" (Latin 'a')
     */
    detectHomographAttack(email) {
        const domain = email.split('@')[1]?.toLowerCase() || '';
        if (!domain) {
            return { detected: false, reason: '' };
        }
        // Check for Cyrillic characters (common in homograph attacks)
        const cyrillicPattern = /[\u0400-\u04FF]/;
        // Check for Greek characters
        const greekPattern = /[\u0370-\u03FF]/;
        // Check for mixed scripts (red flag)
        const hasCyrillic = cyrillicPattern.test(domain);
        const hasGreek = greekPattern.test(domain);
        const hasLatin = /[a-zA-Z]/.test(domain);
        const mixedScripts = (hasCyrillic && hasLatin) || (hasGreek && hasLatin);
        if (mixedScripts) {
            return {
                detected: true,
                reason: 'Domain contains mixed Unicode scripts (potential homograph attack)'
            };
        }
        // Check for confusable characters
        const confusableChars = {
            'а': 'a', // Cyrillic 'а' looks like Latin 'a'
            'е': 'e', // Cyrillic 'е' looks like Latin 'e'
            'о': 'o', // Cyrillic 'о' looks like Latin 'o'
            'р': 'p', // Cyrillic 'р' looks like Latin 'p'
            'с': 'c', // Cyrillic 'с' looks like Latin 'c'
            'у': 'y', // Cyrillic 'у' looks like Latin 'y'
            'х': 'x', // Cyrillic 'х' looks like Latin 'x'
        };
        for (const [confusable, expected] of Object.entries(confusableChars)) {
            if (domain.includes(confusable)) {
                return {
                    detected: true,
                    reason: `Domain contains lookalike character '${confusable}' instead of '${expected}'`
                };
            }
        }
        return { detected: false, reason: '' };
    }
    /**
     * Detect brand impersonation
     * Checks if email claims to be from a well-known brand but uses wrong domain
     */
    detectBrandImpersonation(email) {
        const bodyLower = email.bodyText.toLowerCase();
        const senderDomain = email.fromEmail.split('@')[1]?.toLowerCase() || '';
        for (const [brand, legitimateDomains] of Object.entries(KNOWN_BRANDS)) {
            // Check if email mentions this brand
            const mentionsBrand = bodyLower.includes(brand);
            if (!mentionsBrand)
                continue;
            // Check if sender domain is legitimate
            const isLegitDomain = legitimateDomains.some(domain => senderDomain === domain || senderDomain.endsWith(`.${domain}`));
            if (isLegitDomain)
                continue;
            // Check if claiming to be from that brand
            const claimPatterns = [
                new RegExp(`from ${brand}`, 'i'),
                new RegExp(`${brand}\\s+(team|support|security|account|notification)`, 'i'),
                new RegExp(`official ${brand}`, 'i'),
                new RegExp(`${brand}\\s+customer\\s+(service|support)`, 'i'),
            ];
            const claimingToBeBrand = claimPatterns.some(pattern => pattern.test(bodyLower));
            if (claimingToBeBrand) {
                return {
                    detected: true,
                    reason: `Claims to be from ${brand.toUpperCase()} but sender domain is ${senderDomain}`
                };
            }
        }
        return { detected: false, reason: '' };
    }
    /**
     * Detect display name spoofing
     * Checks if display name doesn't match email address
     */
    detectDisplayNameSpoofing(email) {
        const fromHeader = email.from || email.fromEmail;
        // Extract display name and email address
        // Format: "Display Name <email@domain.com>" or just "email@domain.com"
        const displayNameMatch = fromHeader.match(/^"?([^"<]+)"?\s*<?([^>]+)>?$/);
        if (!displayNameMatch) {
            return { detected: false, reason: '' };
        }
        const displayName = displayNameMatch[1]?.trim() || '';
        const emailAddress = displayNameMatch[2]?.trim() || email.fromEmail;
        const domain = emailAddress.split('@')[1]?.toLowerCase() || '';
        // Extract company/organization name from display name
        const companyPatterns = [
            /\b(Amazon|Google|Microsoft|PayPal|Apple|Facebook|LinkedIn|Netflix|Uber)\b/gi,
            /\b(\w+)\s+(Team|Support|Security|Admin|Notification)/i,
        ];
        for (const pattern of companyPatterns) {
            const matches = displayName.match(pattern);
            if (matches) {
                const claimedCompany = matches[0].toLowerCase();
                // Check if domain matches claimed company
                if (!domain.includes(claimedCompany.toLowerCase().replace(/\s+(team|support|security|admin|notification)/i, ''))) {
                    return {
                        detected: true,
                        reason: `Display name claims "${claimedCompany}" but email is from ${domain}`
                    };
                }
            }
        }
        return { detected: false, reason: '' };
    }
    /**
     * Detect credential harvesting (password reset phishing)
     */
    detectCredentialHarvesting(email) {
        const bodyLower = email.bodyText.toLowerCase();
        const subjectLower = email.subject.toLowerCase();
        const phishingPatterns = [
            /reset.*password/i,
            /verify.*account/i,
            /suspended.*account/i,
            /unusual.*activity/i,
            /confirm.*identity/i,
            /update.*payment/i,
            /billing.*problem/i,
            /expired.*password/i,
            /unauthorized.*access/i,
            /security.*alert/i,
            /verify.*ownership/i,
        ];
        const hasPhishingLanguage = phishingPatterns.some(pattern => pattern.test(bodyLower) || pattern.test(subjectLower));
        if (!hasPhishingLanguage) {
            return { detected: false, reason: '' };
        }
        // Check for login/auth links
        const loginPatterns = [
            /login|sign[\s-]?in|authenticate|verify\s+now|click\s+here/i,
            /(https?:\/\/[^\s]+)/g, // Any URLs
        ];
        const hasLoginLinks = loginPatterns.some(pattern => pattern.test(bodyLower));
        if (hasPhishingLanguage && hasLoginLinks) {
            return {
                detected: true,
                reason: 'Contains password reset/account verification language with suspicious links'
            };
        }
        return { detected: false, reason: '' };
    }
    /**
     * Detect invoice fraud
     */
    detectInvoiceFraud(email) {
        const bodyLower = email.bodyText.toLowerCase();
        const subjectLower = email.subject.toLowerCase();
        // Check for invoice-related keywords
        const invoiceKeywords = /invoice|payment|wire transfer|bank details|urgent payment|outstanding balance|overdue|remittance/i;
        const hasInvoiceLanguage = invoiceKeywords.test(bodyLower) || invoiceKeywords.test(subjectLower);
        if (!hasInvoiceLanguage) {
            return { detected: false, reason: '' };
        }
        // Check for red flags
        let redFlagCount = 0;
        const redFlags = [];
        if (/urgent|asap|immediately|today|by end of day/i.test(bodyLower)) {
            redFlagCount++;
            redFlags.push('urgent payment demand');
        }
        if (/wire transfer|bank transfer|send money|direct deposit/i.test(bodyLower)) {
            redFlagCount++;
            redFlags.push('wire transfer request');
        }
        if (/new (bank|account)|updated (bank|account)|changed (bank|account)|different account/i.test(bodyLower)) {
            redFlagCount++;
            redFlags.push('changed bank details');
        }
        if (/(CEO|CFO|president|director).*request/i.test(bodyLower)) {
            redFlagCount++;
            redFlags.push('executive impersonation');
        }
        // Check if sender domain looks suspicious
        const domain = email.fromEmail.split('@')[1]?.toLowerCase() || '';
        if (/temp|test|fake|spam|random/i.test(domain) || domain.length < 5) {
            redFlagCount++;
            redFlags.push('suspicious sender domain');
        }
        if (redFlagCount >= 2) {
            return {
                detected: true,
                reason: `Invoice fraud indicators: ${redFlags.join(', ')}`
            };
        }
        return { detected: false, reason: '' };
    }
    /**
     * Detect urgency tactics
     */
    detectUrgencyTactics(email) {
        const text = `${email.subject} ${email.bodyText}`.toLowerCase();
        const urgencyPatterns = [
            /urgent|asap|immediately|right away|right now/i,
            /act now|limited time|expires? (soon|today|tonight)/i,
            /don't (miss|wait|delay)|hurry|quick(ly)?/i,
            /within.*hours?|by.*today|before.*midnight/i,
            /last chance|final (notice|warning|reminder)/i,
            /time.?sensitive|critical|emergency/i,
        ];
        let urgencyCount = 0;
        const foundPatterns = [];
        for (const pattern of urgencyPatterns) {
            if (pattern.test(text)) {
                urgencyCount++;
                foundPatterns.push(pattern.source);
            }
        }
        // 2+ urgency tactics = red flag
        if (urgencyCount >= 2) {
            return {
                detected: true,
                reason: `Multiple urgency tactics detected (${urgencyCount} patterns)`
            };
        }
        return { detected: false, reason: '' };
    }
    /**
     * Detect suspicious links
     */
    detectSuspiciousLinks(email) {
        const text = email.bodyText + (email.bodyHtml || '');
        // Extract URLs
        const urlPattern = /(https?:\/\/[^\s<>"']+)/gi;
        const urls = text.match(urlPattern) || [];
        if (urls.length === 0) {
            return { detected: false, reason: '' };
        }
        for (const url of urls) {
            try {
                const urlObj = new URL(url);
                const hostname = urlObj.hostname.toLowerCase();
                // Check for IP addresses (suspicious)
                if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
                    return {
                        detected: true,
                        reason: 'Contains link to IP address instead of domain'
                    };
                }
                // Check for suspicious TLDs
                const suspiciousTLDs = ['.xyz', '.top', '.work', '.click', '.link', '.loan', '.bid', '.stream'];
                if (suspiciousTLDs.some(tld => hostname.endsWith(tld))) {
                    return {
                        detected: true,
                        reason: `Contains link with suspicious TLD (${hostname})`
                    };
                }
                // Check for URL shorteners (can hide destination)
                const shorteners = ['bit.ly', 'tinyurl.com', 'goo.gl', 't.co', 'ow.ly'];
                if (shorteners.some(shortener => hostname.includes(shortener))) {
                    // URL shorteners are not necessarily malicious, so lower risk
                    // Only flag if combined with other suspicious indicators
                    continue;
                }
                // Check for very long URLs (obfuscation)
                if (url.length > 200) {
                    return {
                        detected: true,
                        reason: 'Contains suspiciously long URL (possible obfuscation)'
                    };
                }
            }
            catch (e) {
                // Invalid URL
                continue;
            }
        }
        return { detected: false, reason: '' };
    }
}
exports.AdvancedPhishingDetector = AdvancedPhishingDetector;
/**
 * Singleton instance
 */
exports.advancedPhishingDetector = new AdvancedPhishingDetector();
/**
 * Convenience function for quick analysis
 */
async function analyzePhishing(email) {
    return exports.advancedPhishingDetector.analyzePhishing(email);
}
