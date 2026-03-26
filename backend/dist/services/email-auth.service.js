"use strict";
/**
 * Email Authentication Service
 * Validates SPF, DKIM, DMARC for incoming emails to improve classification
 * Adapted from ClaudeEmailChecker project
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkEmailAuthentication = checkEmailAuthentication;
const promises_1 = __importDefault(require("dns/promises"));
/**
 * Check email authentication based on sender domain and optional email headers
 *
 * @param fromDomain - Sender's email domain (e.g., "company.com")
 * @param emailHeaders - Optional headers from Gmail/Outlook (SPF-Result, DKIM-Result, etc.)
 * @returns Authentication result with trust scores
 */
async function checkEmailAuthentication(fromDomain, emailHeaders) {
    // If headers are provided, use them (already validated by Gmail/Outlook)
    if (emailHeaders) {
        return parseAuthenticationHeaders(emailHeaders, fromDomain);
    }
    // Otherwise, check DNS records directly
    return await checkDomainAuthentication(fromDomain);
}
/**
 * Parse authentication results from email headers (Gmail/Outlook provide these)
 */
function parseAuthenticationHeaders(headers, fromDomain) {
    // Gmail provides: Authentication-Results header
    // Outlook provides: similar headers
    const authResults = headers['authentication-results'] || headers['Authentication-Results'] || '';
    // Parse SPF
    const spfMatch = authResults.match(/spf=(pass|fail|softfail|neutral|none)/i);
    const spfStatus = (spfMatch?.[1]?.toLowerCase() || 'none');
    const spfScore = {
        'pass': 5,
        'softfail': -1,
        'neutral': 0,
        'fail': -5,
        'none': -3,
    }[spfStatus] || 0;
    // Parse DKIM
    const dkimMatch = authResults.match(/dkim=(pass|fail|none)/i);
    const dkimStatus = (dkimMatch?.[1]?.toLowerCase() || 'none');
    const dkimScore = {
        'pass': 5,
        'fail': -5,
        'none': -3,
    }[dkimStatus] || 0;
    // Parse DMARC
    const dmarcMatch = authResults.match(/dmarc=(pass|fail|none)/i);
    const dmarcStatus = (dmarcMatch?.[1]?.toLowerCase() || 'none');
    const dmarcScore = {
        'pass': 5,
        'fail': -5,
        'none': -3,
    }[dmarcStatus] || 0;
    const totalScore = spfScore + dkimScore + dmarcScore;
    const trustBoost = Math.min(0.3, Math.max(-0.3, totalScore / 50)); // Normalize to ±0.3
    let trustLevel;
    if (totalScore >= 10)
        trustLevel = 'high'; // All 3 pass
    else if (totalScore >= 0)
        trustLevel = 'medium'; // Mixed results
    else if (totalScore >= -5)
        trustLevel = 'low'; // Some failures
    else
        trustLevel = 'critical'; // Multiple failures = likely spoofed
    return {
        spf: {
            status: spfStatus,
            score: spfScore,
            message: getSPFMessage(spfStatus),
        },
        dkim: {
            status: dkimStatus,
            score: dkimScore,
            message: getDKIMMessage(dkimStatus),
        },
        dmarc: {
            status: dmarcStatus,
            policy: 'none', // Would need to parse DMARC record
            score: dmarcScore,
            message: getDMARCMessage(dmarcStatus),
        },
        overall: {
            score: totalScore,
            trustBoost,
            trustLevel,
            message: getOverallMessage(trustLevel, spfStatus, dkimStatus, dmarcStatus),
        },
    };
}
/**
 * Check domain DNS records for SPF/DKIM/DMARC configuration
 * Used when email headers aren't available
 */
async function checkDomainAuthentication(domain) {
    try {
        const [spfResult, dkimResult, dmarcResult] = await Promise.all([
            checkSPF(domain),
            checkDKIM(domain),
            checkDMARC(domain),
        ]);
        const totalScore = spfResult.score + dkimResult.score + dmarcResult.score;
        const trustBoost = Math.min(0.3, Math.max(-0.3, totalScore / 50));
        let trustLevel;
        if (totalScore >= 10)
            trustLevel = 'high';
        else if (totalScore >= 0)
            trustLevel = 'medium';
        else if (totalScore >= -5)
            trustLevel = 'low';
        else
            trustLevel = 'critical';
        return {
            spf: spfResult,
            dkim: dkimResult,
            dmarc: dmarcResult,
            overall: {
                score: totalScore,
                trustBoost,
                trustLevel,
                message: getOverallMessage(trustLevel, spfResult.status, dkimResult.status, dmarcResult.status),
            },
        };
    }
    catch (error) {
        console.error('[EmailAuth] Authentication check failed:', error.message);
        // Return neutral result on error
        return {
            spf: { status: 'none', score: -2, message: 'Unable to check SPF' },
            dkim: { status: 'none', score: -2, message: 'Unable to check DKIM' },
            dmarc: { status: 'none', score: -2, message: 'Unable to check DMARC' },
            overall: {
                score: -6,
                trustBoost: -0.1,
                trustLevel: 'low',
                message: 'Authentication unavailable - treat with caution',
            },
        };
    }
}
/**
 * Check SPF record
 */
async function checkSPF(domain) {
    try {
        const records = await promises_1.default.resolveTxt(domain);
        const spfRecord = records.find(r => r.join('').startsWith('v=spf1'));
        if (!spfRecord) {
            return {
                status: 'none',
                score: -3,
                message: 'No SPF record found - sender not authenticated',
            };
        }
        const spfString = spfRecord.join('');
        const mechanism = spfString.match(/([~\-+?])all/)?.[0] || '';
        const hasHardFail = mechanism === '-all';
        return {
            status: hasHardFail ? 'pass' : 'softfail',
            score: hasHardFail ? 5 : 2,
            message: hasHardFail
                ? 'SPF configured with strict policy'
                : 'SPF configured with lenient policy',
        };
    }
    catch {
        return {
            status: 'fail',
            score: -5,
            message: 'SPF record invalid or inaccessible',
        };
    }
}
/**
 * Check DKIM record (check for common selectors)
 */
async function checkDKIM(domain) {
    const DKIM_SELECTORS = ['default', 'google', 'k1', 'selector1', 's1', 'dkim'];
    for (const selector of DKIM_SELECTORS) {
        try {
            const dkimDomain = `${selector}._domainkey.${domain}`;
            const records = await promises_1.default.resolveTxt(dkimDomain);
            if (records.length > 0) {
                const dkimRecord = records[0].join('');
                if (dkimRecord.includes('v=DKIM1') || dkimRecord.includes('p=')) {
                    return {
                        status: 'pass',
                        score: 5,
                        message: `DKIM configured (selector: ${selector})`,
                    };
                }
            }
        }
        catch {
            continue;
        }
    }
    return {
        status: 'none',
        score: -3,
        message: 'No DKIM records found - email not cryptographically signed',
    };
}
/**
 * Check DMARC record
 */
async function checkDMARC(domain) {
    try {
        const dmarcDomain = `_dmarc.${domain}`;
        const records = await promises_1.default.resolveTxt(dmarcDomain);
        const dmarcRecord = records.find(r => r.join('').startsWith('v=DMARC1'));
        if (!dmarcRecord) {
            return {
                status: 'none',
                policy: 'none',
                score: -3,
                message: 'No DMARC policy set - domain not protected',
            };
        }
        const dmarcString = dmarcRecord.join('');
        const policyMatch = dmarcString.match(/p=(reject|quarantine|none)/i);
        const policy = (policyMatch?.[1]?.toLowerCase() || 'none');
        const score = {
            'reject': 5,
            'quarantine': 3,
            'none': -1,
        }[policy] || 0;
        return {
            status: policy !== 'none' ? 'pass' : 'none',
            policy,
            score,
            message: getDMARCPolicyMessage(policy),
        };
    }
    catch {
        return {
            status: 'fail',
            policy: 'none',
            score: -5,
            message: 'DMARC record invalid or inaccessible',
        };
    }
}
// ============================================
// MESSAGE HELPERS
// ============================================
function getSPFMessage(status) {
    const messages = {
        'pass': 'Sender authorized by SPF',
        'softfail': 'SPF soft fail - potentially unauthorized',
        'fail': 'SPF hard fail - sender NOT authorized (likely spoofed)',
        'neutral': 'SPF neutral - no policy',
        'none': 'No SPF record found',
    };
    return messages[status] || 'SPF status unknown';
}
function getDKIMMessage(status) {
    const messages = {
        'pass': 'Email cryptographically signed and verified',
        'fail': 'DKIM signature invalid or tampered (likely spoofed)',
        'none': 'No DKIM signature found',
    };
    return messages[status] || 'DKIM status unknown';
}
function getDMARCMessage(status) {
    const messages = {
        'pass': 'DMARC authentication passed',
        'fail': 'DMARC authentication failed (high risk)',
        'none': 'No DMARC policy',
    };
    return messages[status] || 'DMARC status unknown';
}
function getDMARCPolicyMessage(policy) {
    const messages = {
        'reject': 'Domain has strict DMARC policy (reject)',
        'quarantine': 'Domain has moderate DMARC policy (quarantine)',
        'none': 'Domain has no DMARC enforcement',
    };
    return messages[policy] || 'DMARC policy unknown';
}
function getOverallMessage(trustLevel, spf, dkim, dmarc) {
    if (trustLevel === 'high') {
        return 'All authentication checks passed - highly trustworthy sender';
    }
    else if (trustLevel === 'critical') {
        return `CRITICAL: Multiple auth failures (SPF:${spf} DKIM:${dkim} DMARC:${dmarc}) - likely spoofed/phishing`;
    }
    else if (trustLevel === 'low') {
        return `Weak authentication (SPF:${spf} DKIM:${dkim} DMARC:${dmarc}) - treat with caution`;
    }
    else {
        return `Mixed authentication results (SPF:${spf} DKIM:${dkim} DMARC:${dmarc}) - moderate trust`;
    }
}
