"use strict";
/**
 * AI-powered Email Classification Service
 * Uses OpenAI or Mistral for intelligent email classification
 * Supports personalized classification based on user context from onboarding
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.classifyEmailWithAI = classifyEmailWithAI;
exports.batchClassifyWithAI = batchClassifyWithAI;
const config_1 = require("../lib/config");
const prisma_1 = require("../lib/prisma");
/**
 * Get user context from database for personalized classification
 * Now supports both old and new field names for backward compatibility
 */
async function getUserContext(userId) {
    try {
        const userContext = await prisma_1.prisma.userContext.findUnique({
            where: { user_id: userId },
        });
        if (!userContext) {
            return null;
        }
        // Build readable strings from the context
        const userRole = userContext.user_role_custom || userContext.user_role || '';
        // NEW LOGIC: Use priority_emails if available, fallback to primary_goal
        let primaryGoal = '';
        if (userContext.priority_emails && userContext.priority_emails.length > 0) {
            // Join array items with commas for the prompt
            primaryGoal = userContext.priority_emails.join(', ');
            if (userContext.priority_emails_custom) {
                primaryGoal += `, ${userContext.priority_emails_custom}`;
            }
        }
        else {
            // Fallback to old field for backward compatibility
            primaryGoal = userContext.primary_goal_custom || userContext.primary_goal || '';
        }
        const targetAudience = userContext.target_audience_custom || userContext.target_audience || '';
        // NEW LOGIC: Use priority_senders if available, fallback to whitelist_domains
        let whitelistDomains = '';
        if (userContext.priority_senders && userContext.priority_senders.length > 0) {
            whitelistDomains = userContext.priority_senders.join(', ');
            if (userContext.priority_senders_custom) {
                whitelistDomains += `, ${userContext.priority_senders_custom}`;
            }
        }
        else {
            // Fallback to old field for backward compatibility
            whitelistDomains = userContext.whitelist_domains.join(', ') || '';
        }
        const dealBreakers = [
            ...(userContext.deal_breakers || []),
            ...(userContext.deal_breakers_custom ? [userContext.deal_breakers_custom] : [])
        ].join(', ') || '';
        return {
            userRole,
            primaryGoal, // Contains either old or new data
            targetAudience,
            whitelistDomains, // Contains either old or new data
            dealBreakers,
            // Add new fields for future prompt updates if needed
            priorityEmails: primaryGoal,
            prioritySenders: whitelistDomains,
            timezone: userContext.timezone || 'UTC',
        };
    }
    catch (error) {
        console.error('[AI Classifier] Error fetching user context:', error);
        return null;
    }
}
/**
 * Contextual classification prompt with user personalization
 * This prompt adapts to the user's role, goals, and preferences
 *
 * IMPORTANT: This prompt is the PRIMARY classification decision maker when AI is enabled.
 * It must be AGGRESSIVE at catching spam to protect users from unwanted emails.
 */
function getContextualPrompt(userContext) {
    // Default values if no user context
    const userRole = userContext?.userRole || 'Professional (generic)';
    const primaryGoal = userContext?.primaryGoal || 'Important business communications';
    const targetAudience = userContext?.targetAudience || 'Mixed (B2B and consumers)';
    const whitelistDomains = userContext?.whitelistDomains || '';
    const dealBreakers = userContext?.dealBreakers || '';
    const timezone = userContext?.timezone || 'UTC';
    return `You are a specialized AI email classifier acting as a STRICT spam filter.
Your PRIMARY mission: AGGRESSIVELY filter spam and bulk emails. Only rescue GENUINELY important emails.

## CRITICAL OPERATING PRINCIPLES (STRICT ORDER OF PRIORITY)
1. **SPAM BY DEFAULT**: When in doubt, classify as SPAM (not promotion)
2. **PROMOTION IS RARE**: Only use "promotion" for LEGITIMATE newsletters the user likely subscribed to
3. **LEGIT IS PRECIOUS**: Reserve "legit" for emails that CLEARLY require the user's attention
4. **Trust Nothing**: Assume all emails are spam until proven otherwise

## USER CONTEXT & PERSONALIZATION
- **User Role/Industry:** ${userRole}
- **Primary Business Goal:** ${primaryGoal}
- **Target Audience/Ideal Senders:** ${targetAudience}
- **VIP/Whitelist Domains:** ${whitelistDomains}
- **Auto-Reject Triggers:** ${dealBreakers}
- **User Timezone:** ${timezone}

## EMAIL ANALYSIS CONTEXT
From: {{senderName}} <{{fromEmail}}>
Domain: {{senderDomain}}
Subject: {{subject}}
Date Sent: {{date}}
Body Preview: {{body}}

## CLASSIFICATION DECISION TREE (STRICT ORDER - FOLLOW EXACTLY)

### PHASE 0: VIP OVERRIDE (IMMEDIATE LEGIT)
**Classify as LEGIT (confidence: 0.99) ONLY if:**
1. Domain is "@myinboxer.com" (always VIP)
2. Domain EXACTLY matches a domain in VIP/Whitelist Domains list above

### PHASE 1: SPAM DETECTION (AGGRESSIVE - CHECK FIRST)
**Classify as SPAM (confidence: 0.90+) if ANY of these are true:**

**1.1 BULK/MASS EMAIL INDICATORS (consider in context, NOT instant spam alone):**
- IMPORTANT: "Unsubscribe" links are legally required (CAN-SPAM/GDPR) in BOTH spam and legitimate emails. Do NOT classify as spam solely because of an unsubscribe link.
- Combination of: "view in browser" + commercial content + generic greeting = likely spam
- "You are receiving this" + no personalization + sales pitch = likely spam
- Generic sender (info@, marketing@, newsletter@) + aggressive sales language = likely spam
- No-reply sender alone is NOT spam — many legitimate services use no-reply addresses

**1.2 COMMERCIAL/ADVERTISING SPAM:**
- Sales pitches: "limited time", "act now", "exclusive offer", "special deal", "don't miss"
- Pricing language: "% off", "discount", "coupon", "promo code", "free shipping", "save $"
- Call-to-action spam: "click here", "buy now", "order now", "shop now", "sign up now"
- Urgency manipulation: "last chance", "expires soon", "only X left", "hurry"

**1.3 SCAM/PHISHING INDICATORS:**
- Financial scams: lottery, inheritance, crypto schemes, "get rich", "make money fast"
- Phishing: "verify your account", "confirm your identity", "unusual activity", "suspended"
- Credential theft: "update your password", "security alert", "billing problem"
- Too good to be true: "you've won", "congratulations", "free money", "guaranteed"

**1.4 GENERIC/TEMPLATE EMAIL:**
- Generic greetings: "Dear Sir/Madam", "Dear Customer", "Dear Friend", "To whom it may concern"
- No personalization with recipient's actual name
- Clearly automated/templated content

**1.5 USER DEAL BREAKERS:**
- Content matches ANY item in the user's "Auto-Reject Triggers" list

### PHASE 2: LEGIT QUALIFICATION (STRICT CRITERIA)
**Only reach this phase if NONE of Phase 1 triggered.**
**Classify as LEGIT (confidence: 0.85+) ONLY if ALL of these are true:**

**Required Criteria (meet EITHER path):**

**Path A — Personal/business email:**
1. **Personalized**: Uses recipient's actual name or references specific context
2. **No aggressive sales language**: No commercial spam phrases
3. **One of these**: Direct business inquiry, reply to existing conversation, from known contact or matches "Target Audience/Ideal Senders"

**Path B — Transactional/account email (LEGIT even with unsubscribe links):**
1. **Service notification**: Registration confirmation, welcome email, password reset, order receipt, invoice, shipping notification, security alert, login notification, verification code, account activation
2. **From recognizable service**: Domain matches a known company or service
3. **NOTE**: These emails often contain unsubscribe links — that does NOT make them spam

### PHASE 3: PROMOTION (VERY LIMITED USE)
**Use "promotion" ONLY for emails that are:**
1. From MAJOR, well-known brands (Apple, Google, Amazon, LinkedIn, etc.)
2. Clearly a newsletter the user LIKELY subscribed to (not cold outreach)
3. Contains NO scam/phishing indicators whatsoever
4. Professional design and legitimate company footer

**If you're unsure between spam and promotion → CHOOSE SPAM**

### PHASE 4: DEFAULT TO SPAM
**If the email doesn't clearly fit Phase 0, 2, or 3 → Classify as SPAM**

## CONFIDENCE SCORING
- SPAM: 0.90-0.99 (higher = more obvious spam)
- LEGIT: 0.85-0.99 (only if genuinely important)
- PROMOTION: 0.75-0.90 (only for legitimate brand newsletters)

## CRITICAL REMINDERS
- "Unsubscribe" link alone is NOT a spam indicator — it appears in legitimate emails too (legally required)
- Registration confirmations, order receipts, security alerts from real services = LEGIT (not spam)
- Cold outreach without personalization = SPAM
- Marketing language + generic greeting + aggressive sales = SPAM
- When torn between spam and promotion = SPAM
- Only "legit" for emails that GENUINELY need user attention or are transactional/account-related

**Output Format (JSON only):**
{
  "verdict": "legit|spam|promotion",
  "confidence": 0.XX,
  "priority": "high|medium|low",
  "reasoning": {
    "phaseApplied": "0|1|2|3|4",
    "keyRulesTriggered": ["rule1", "rule2"],
    "contextAlignment": "high|medium|low|none",
    "personalizationScore": 0-100,
    "riskAssessment": "safe|low_risk|suspicious|high_risk"
  },
  "reason": "Concise explanation for classification decision"
}`;
}
/**
 * Legacy default prompt for backwards compatibility
 * Used when no user context is available
 */
function getDefaultPrompt() {
    return getContextualPrompt(null);
}
/**
 * Build classification prompt with template variables replaced
 * Now supports personalized prompts based on user context
 */
function buildClassificationPrompt(email, customPrompt, userContext) {
    // Extract sender info for analysis
    const senderDomain = email.fromEmail.split('@')[1]?.toLowerCase() || '';
    const senderName = email.from || '';
    const bodyPreview = email.bodyText.substring(0, 1000) + (email.bodyText.length > 1000 ? '...' : '');
    // Priority: custom prompt > contextual prompt (with user data) > default
    let template;
    if (customPrompt) {
        template = customPrompt;
    }
    else {
        template = getContextualPrompt(userContext || null);
    }
    // Replace template variables
    return template
        .replace(/\{\{senderName\}\}/g, senderName)
        .replace(/\{\{fromEmail\}\}/g, email.fromEmail)
        .replace(/\{\{senderDomain\}\}/g, senderDomain)
        .replace(/\{\{subject\}\}/g, email.subject)
        .replace(/\{\{body\}\}/g, bodyPreview)
        .replace(/\{\{to\}\}/g, email.to || '')
        .replace(/\{\{date\}\}/g, email.date?.toISOString() || '');
}
/**
 * Safely parse JSON that may contain unescaped special characters or markdown wrappers
 */
function safeJsonParse(jsonString) {
    let fixedJson = jsonString.trim();
    // Strategy 1: Remove markdown code blocks FIRST if present
    // Handle various formats: ```json\n{...}```, ```json{...}```, ```\n{...}```
    if (fixedJson.includes('```')) {
        // Remove opening ```json or ```JSON or ``` marker (with or without newline)
        fixedJson = fixedJson.replace(/^```(?:json|JSON)?\s*\n?/i, '');
        // Remove closing ``` marker
        fixedJson = fixedJson.replace(/\n?```\s*$/i, '');
        fixedJson = fixedJson.trim();
        // Note: Markdown code block wrapping is normal for Mistral - no need to log
    }
    // Strategy 2: Try direct parsing
    try {
        return JSON.parse(fixedJson);
    }
    catch (parseError) {
        // Strategy 3: Extract JSON object from the string
        try {
            const start = fixedJson.indexOf('{');
            const end = fixedJson.lastIndexOf('}');
            if (start !== -1 && end !== -1 && end > start) {
                const jsonPart = fixedJson.substring(start, end + 1);
                return JSON.parse(jsonPart);
            }
        }
        catch (e) {
            // Continue to next strategy
        }
        // Strategy 4: Try more complex JSON repair
        try {
            return attemptToFixJson(fixedJson);
        }
        catch (fixError) {
            // All strategies failed - throw a descriptive error
            console.error('[AI Classifier] Failed to parse AI response:', {
                originalLength: jsonString.length,
                preview: jsonString.substring(0, 200),
                error: parseError.message
            });
            throw new Error(`Failed to parse AI response: ${parseError.message}`);
        }
    }
}
/**
 * Attempt to fix common JSON formatting issues
 */
function attemptToFixJson(input) {
    // This is a simplified approach - for more complex cases,
    // we'd want a more robust JSON repair algorithm
    try {
        // Try parsing as is first
        return JSON.parse(input);
    }
    catch {
        // If that fails, try to fix it
        let fixed = input;
        // Replace unescaped quotes in string values by finding key-value pairs
        // This uses a simpler approach: find property values and manually escape quotes
        try {
            // Match JSON property patterns: "key": "value" (with potential nested quotes in value)
            // We'll use a more careful approach to avoid breaking the JSON structure
            fixed = input.replace(/:\s*"[^"\\]*(?:\\.[^"\\]*)*"/g, function (match) {
                // Extract the key and value parts
                const colonIndex = match.indexOf(':');
                const valuePart = match.substring(colonIndex + 1).trim();
                // Only try to fix if it looks like a string value
                if (valuePart.startsWith('"')) {
                    // This is a simplified fix - in a production environment,
                    // we'd want a more robust JSON repair algorithm
                    return match; // For now, return as is to avoid breaking valid JSON
                }
                return match;
            });
            return JSON.parse(fixed);
        }
        catch {
            // If we still can't parse it, try the extraction method from before
            const start = fixed.indexOf('{');
            const end = fixed.lastIndexOf('}');
            if (start !== -1 && end !== -1 && end > start) {
                const jsonPart = fixed.substring(start, end + 1);
                return JSON.parse(jsonPart);
            }
            else {
                // If we can't find a valid JSON object, throw the original error
                throw new Error('Could not find or repair valid JSON object');
            }
        }
    }
}
/**
 * Pre-filter emails before AI classification - catch obvious spam
 */
function preFilterSpam(email, enablePreFilter) {
    // If pre-filter is disabled, skip and go straight to AI
    if (!enablePreFilter) {
        console.log('[Pre-Filter] Disabled - skipping pre-filter checks');
        return null;
    }
    const bodyLower = email.bodyText.toLowerCase();
    const subjectLower = email.subject.toLowerCase();
    // Also check HTML body for spam indicators (unsubscribe links are often in HTML)
    const htmlBodyLower = (email.bodyHtml || '').toLowerCase();
    const combinedText = `${bodyLower} ${subjectLower} ${htmlBodyLower}`;
    // Debug logging
    console.log('[Pre-Filter] Checking email:', {
        from: email.fromEmail,
        subject: email.subject.substring(0, 50),
        bodyTextLength: bodyLower.length,
        bodyHtmlLength: htmlBodyLower.length,
        bodyPreview: bodyLower.substring(0, 200) || htmlBodyLower.substring(0, 200),
        hasUnsubscribeInText: bodyLower.includes('unsubscribe'),
        hasUnsubscribeInHtml: htmlBodyLower.includes('unsubscribe'),
        isNoReply: email.fromEmail.toLowerCase().includes('no-reply') ||
            email.fromEmail.toLowerCase().includes('noreply') ||
            email.fromEmail.toLowerCase().includes('donotreply'),
    });
    // NOTE: Unsubscribe links and no-reply addresses are NOT standalone spam indicators.
    // Many legitimate transactional emails (registrations, order confirmations, security alerts)
    // include unsubscribe links (legally required by CAN-SPAM/GDPR) and use no-reply addresses.
    // These signals are still considered by the AI prompt as one factor among many.
    // Check for common spam phrases
    const spamPhrases = [
        'act now',
        'limited time',
        'last chance',
        'click here',
        'buy now',
        'order now',
        'gift to you',
        'free money',
        'guarantee',
        'risk free',
        'this is an advertisement',
    ];
    const foundSpamPhrases = spamPhrases.filter(phrase => combinedText.includes(phrase));
    console.log('[Pre-Filter] Spam phrases found:', foundSpamPhrases.length > 0 ? foundSpamPhrases : 'none');
    if (foundSpamPhrases.length >= 2) {
        console.log('[Pre-Filter] ✓ CAUGHT: Multiple spam phrases detected');
        return {
            verdict: 'spam',
            confidence: 0.90,
            reason: `Multiple spam indicators: ${foundSpamPhrases.join(', ')} (pre-filter)`,
            priority: 'low',
        };
    }
    // No obvious spam detected - proceed to AI
    console.log('[Pre-Filter] ✗ PASSED: No spam indicators found, proceeding to AI');
    return null;
}
/**
 * Post-process AI verdict to catch promotions that should be spam
 * This runs AFTER the AI makes its decision to apply stricter rules
 */
function postProcessVerdict(email, aiResult) {
    // Only process promotions - legit and spam verdicts are already handled
    if (aiResult.verdict !== 'promotion') {
        return aiResult;
    }
    const bodyLower = email.bodyText.toLowerCase();
    const subjectLower = email.subject.toLowerCase();
    const htmlBodyLower = (email.bodyHtml || '').toLowerCase();
    const combinedText = `${bodyLower} ${subjectLower} ${htmlBodyLower}`;
    const fromLower = email.fromEmail.toLowerCase();
    // Spam indicators that warrant downgrading promotion → spam
    // NOTE: Unsubscribe links, no-reply addresses, and generic senders alone are NOT spam indicators.
    // Legitimate newsletters from major brands use all of these. Only downgrade on actual spam content.
    const spamIndicators = [];
    // 1. Commercial spam phrases (2+ required — the strongest signal of actual spam)
    const commercialPhrases = [
        'limited time', 'act now', 'exclusive offer', 'special deal', "don't miss",
        '% off', 'discount', 'coupon', 'promo code', 'free shipping', 'save $',
        'click here', 'buy now', 'order now', 'shop now', 'sign up now',
        'last chance', 'expires soon', 'hurry', 'free money', 'risk free',
        'guarantee', 'you have been selected', "you've won", 'congratulations',
        'claim your', 'act immediately',
    ];
    const foundCommercial = commercialPhrases.filter(phrase => combinedText.includes(phrase));
    if (foundCommercial.length >= 2) {
        spamIndicators.push(`commercial phrases: ${foundCommercial.slice(0, 3).join(', ')}`);
    }
    // 2. Scam/phishing language
    const scamPhrases = ['lottery', 'inheritance', 'crypto', 'get rich', 'make money fast', 'nigerian', 'prince'];
    const foundScam = scamPhrases.filter(phrase => combinedText.includes(phrase));
    if (foundScam.length >= 1) {
        spamIndicators.push(`scam language: ${foundScam.join(', ')}`);
    }
    // If actual spam content found, downgrade to spam
    if (spamIndicators.length > 0) {
        console.log(`[Post-Process] DOWNGRADE: promotion → spam (indicators: ${spamIndicators.join(', ')})`);
        return {
            verdict: 'spam',
            confidence: Math.max(0.90, aiResult.confidence),
            reason: `${aiResult.reason} | Post-process: Downgraded from promotion (${spamIndicators.join(', ')})`,
            priority: 'low',
        };
    }
    // No spam indicators - keep as promotion (rare case)
    console.log('[Post-Process] Keeping as promotion - no spam indicators detected');
    return aiResult;
}
/**
 * Call Mistral AI for classification
 */
async function classifyWithMistral(email, customPrompt, enablePreFilter = true, userContext) {
    // Pre-filter obvious spam before calling AI (if enabled)
    const preFilterResult = preFilterSpam(email, enablePreFilter);
    if (preFilterResult) {
        console.log(`[Mistral] Pre-filter caught spam: ${preFilterResult.reason}`);
        return preFilterResult;
    }
    const mistralApiKey = config_1.config.ai.mistral?.apiKey;
    const mistralModel = config_1.config.ai.mistral?.model || 'mistral-small-latest';
    if (!mistralApiKey) {
        throw new Error('MISTRAL_API_KEY not configured');
    }
    const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${mistralApiKey}`,
        },
        body: JSON.stringify({
            model: mistralModel,
            messages: [
                {
                    role: 'user',
                    content: buildClassificationPrompt(email, customPrompt, userContext),
                },
            ],
            temperature: 0.1, // Very low temperature for strict rule following
            max_tokens: 500, // Increased to prevent JSON truncation
        }),
    });
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Mistral API error: ${error}`);
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
        throw new Error('No response from Mistral AI');
    }
    // Parse JSON response - strip markdown code blocks if present and handle special characters safely
    // Note: Mistral often wraps JSON in ```json code blocks - this is handled by safeJsonParse
    const result = safeJsonParse(content.trim());
    // Validate response
    if (!result.verdict || !['legit', 'spam', 'promotion'].includes(result.verdict)) {
        throw new Error('Invalid verdict from AI');
    }
    // Build comprehensive reason from chain-of-thought if available
    let reason = result.reason || 'AI classification';
    if (result.reasoning) {
        const reasoningParts = [];
        if (result.reasoning.intent)
            reasoningParts.push(`Intent: ${result.reasoning.intent}`);
        if (result.reasoning.redFlags && result.reasoning.redFlags.length > 0) {
            reasoningParts.push(`Red flags: ${result.reasoning.redFlags.join(', ')}`);
        }
        if (result.reasoning.positiveSignals && result.reasoning.positiveSignals.length > 0) {
            reasoningParts.push(`Positive signals: ${result.reasoning.positiveSignals.join(', ')}`);
        }
        // Prepend chain-of-thought details to the summary reason
        if (reasoningParts.length > 0) {
            reason = `${result.reason} | ${reasoningParts.join(' | ')}`;
        }
    }
    // Enforce strict confidence threshold for legit emails (same as OpenAI)
    // If classified as legit but confidence < 0.85, downgrade to spam for safety
    let finalVerdict = result.verdict;
    let finalConfidence = Math.min(1, Math.max(0, result.confidence || 0.5));
    let finalPriority = result.priority || 'medium';
    let finalReason = reason;
    if (result.verdict === 'legit' && finalConfidence < 0.85) {
        console.log(`[Mistral] Low-confidence legit (${(finalConfidence * 100).toFixed(0)}%) downgraded to spam for safety`);
        finalVerdict = 'spam';
        finalPriority = 'low';
        finalReason = `Low confidence legit (${(finalConfidence * 100).toFixed(0)}%) - classified as spam for safety. ${reason}`;
    }
    const aiResult = {
        verdict: finalVerdict,
        confidence: finalConfidence,
        reason: finalReason,
        priority: finalPriority,
    };
    // Post-process to catch promotions that should be spam
    return postProcessVerdict(email, aiResult);
}
/**
 * Call OpenAI for classification
 */
async function classifyWithOpenAI(email, customPrompt, enablePreFilter = true, userContext) {
    // Pre-filter obvious spam before calling AI (if enabled)
    const preFilterResult = preFilterSpam(email, enablePreFilter);
    if (preFilterResult) {
        console.log(`[OpenAI] Pre-filter caught spam: ${preFilterResult.reason}`);
        return preFilterResult;
    }
    const openaiApiKey = config_1.config.ai.openai.apiKey;
    if (!openaiApiKey) {
        throw new Error('OPENAI_API_KEY not configured');
    }
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openaiApiKey}`,
        },
        body: JSON.stringify({
            model: 'gpt-4o-mini', // Fast and cost-effective
            messages: [
                {
                    role: 'system',
                    content: 'You are an expert email classifier. Always respond with valid JSON only. Follow the classification rules strictly without exception.',
                },
                {
                    role: 'user',
                    content: buildClassificationPrompt(email, customPrompt, userContext),
                },
            ],
            temperature: 0.1, // Very low temperature for strict rule following
            max_tokens: 500, // Increased to prevent JSON truncation
            response_format: { type: 'json_object' },
        }),
    });
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI API error: ${error}`);
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
        throw new Error('No response from OpenAI');
    }
    // Parse JSON response using safe parsing function
    const result = safeJsonParse(content.trim());
    if (!result.verdict || !['legit', 'spam', 'promotion'].includes(result.verdict)) {
        throw new Error('Invalid verdict from AI');
    }
    // Build comprehensive reason from chain-of-thought if available
    let reason = result.reason || 'AI classification';
    if (result.reasoning) {
        const reasoningParts = [];
        if (result.reasoning.intent)
            reasoningParts.push(`Intent: ${result.reasoning.intent}`);
        if (result.reasoning.redFlags && result.reasoning.redFlags.length > 0) {
            reasoningParts.push(`Red flags: ${result.reasoning.redFlags.join(', ')}`);
        }
        if (result.reasoning.positiveSignals && result.reasoning.positiveSignals.length > 0) {
            reasoningParts.push(`Positive signals: ${result.reasoning.positiveSignals.join(', ')}`);
        }
        // Prepend chain-of-thought details to the summary reason
        if (reasoningParts.length > 0) {
            reason = `${result.reason} | ${reasoningParts.join(' | ')}`;
        }
    }
    // Enforce strict confidence threshold for legit emails
    // If classified as legit but confidence < 0.85, downgrade to spam for safety
    let finalVerdict = result.verdict;
    let finalConfidence = Math.min(1, Math.max(0, result.confidence || 0.5));
    let finalPriority = result.priority || 'medium';
    let finalReason = reason;
    if (result.verdict === 'legit' && finalConfidence < 0.85) {
        console.log(`[OpenAI] Low-confidence legit (${(finalConfidence * 100).toFixed(0)}%) downgraded to spam for safety`);
        finalVerdict = 'spam';
        finalPriority = 'low';
        finalReason = `Low confidence legit (${(finalConfidence * 100).toFixed(0)}%) - classified as spam for safety. ${reason}`;
    }
    const aiResult = {
        verdict: finalVerdict,
        confidence: finalConfidence,
        reason: finalReason,
        priority: finalPriority,
    };
    // Post-process to catch promotions that should be spam
    return postProcessVerdict(email, aiResult);
}
/**
 * Main AI classification function with fallback
 * Now supports personalized classification based on user context
 */
async function classifyEmailWithAI(email, customPrompt, userId) {
    try {
        // Get AI provider and pre-filter setting from database settings
        const settings = await prisma_1.prisma.systemSettings.findFirst();
        console.log(`[AI Classifier] Settings from DB:`, settings ? { ai_provider: settings.ai_provider, enable_pre_filter: settings.enable_pre_filter } : 'NO SETTINGS RECORD');
        const aiProvider = settings?.ai_provider || 'openai'; // Default to OpenAI (matching database default)
        const enablePreFilter = settings?.enable_pre_filter ?? true; // Default to enabled
        // Fetch user context for personalized classification
        let userContext = null;
        if (userId) {
            userContext = await getUserContext(userId);
            if (userContext) {
                console.log(`[AI Classifier] Using personalized context for user: Role=${userContext.userRole}, Goal=${userContext.primaryGoal}`);
            }
        }
        console.log(`[AI Classifier] AI provider setting: ${aiProvider}, Pre-filter: ${enablePreFilter ? 'enabled' : 'disabled'}`);
        // If AI is disabled
        if (aiProvider === 'none') {
            console.log(`[AI Classifier] AI is disabled in settings - using rule-based only`);
            throw new Error('AI classification disabled in settings');
        }
        // Use selected AI provider
        if (aiProvider === 'openai') {
            console.log(`[AI Classifier] OpenAI selected - checking API key...`);
            if (!config_1.config.ai?.openai?.apiKey) {
                console.error(`[AI Classifier] OpenAI API key not configured!`);
                throw new Error('OpenAI API key not configured');
            }
            console.log(`[AI Classifier] Using OpenAI${customPrompt ? ' with custom prompt' : ''}${userContext ? ' with user context' : ''} for: "${email.subject}"`);
            const result = await classifyWithOpenAI(email, customPrompt, enablePreFilter, userContext);
            return {
                verdict: result.verdict,
                priority: result.priority,
                confidence: result.confidence,
                reason: result.reason + ' (AI: OpenAI)',
            };
        }
        if (aiProvider === 'mistral' && config_1.config.ai.mistral?.apiKey) {
            console.log(`[AI Classifier] Using Mistral${customPrompt ? ' with custom prompt' : ''}${userContext ? ' with user context' : ''} for: "${email.subject}"`);
            const result = await classifyWithMistral(email, customPrompt, enablePreFilter, userContext);
            return {
                verdict: result.verdict,
                priority: result.priority,
                confidence: result.confidence,
                reason: result.reason + ' (AI: Mistral)',
            };
        }
        // Fallback logic if selected provider not configured
        if (aiProvider === 'openai' && !config_1.config.ai.openai?.apiKey) {
            console.warn(`[AI Classifier] OpenAI selected but API key not configured - trying Mistral fallback`);
            if (config_1.config.ai.mistral?.apiKey) {
                const result = await classifyWithMistral(email, customPrompt, enablePreFilter, userContext);
                return {
                    verdict: result.verdict,
                    priority: result.priority,
                    confidence: result.confidence,
                    reason: result.reason + ' (AI: Mistral - fallback)',
                };
            }
        }
        if (aiProvider === 'mistral' && !config_1.config.ai.mistral?.apiKey) {
            console.warn(`[AI Classifier] Mistral selected but API key not configured - trying OpenAI fallback`);
            if (config_1.config.ai.openai?.apiKey) {
                const result = await classifyWithOpenAI(email, customPrompt, enablePreFilter, userContext);
                return {
                    verdict: result.verdict,
                    priority: result.priority,
                    confidence: result.confidence,
                    reason: result.reason + ' (AI: OpenAI - fallback)',
                };
            }
        }
        throw new Error(`AI provider '${aiProvider}' not configured or API key missing`);
    }
    catch (error) {
        console.error('[AI Classifier] Error:', error.message);
        // Return low-confidence spam verdict on AI failure (conservative approach)
        return {
            verdict: 'spam',
            priority: 'low',
            confidence: 0.3,
            reason: `AI classification failed: ${error.message}`,
        };
    }
}
/**
 * Batch classify emails with AI (with rate limiting)
 */
async function batchClassifyWithAI(emails, delayMs = 1000) {
    const results = [];
    for (const email of emails) {
        const result = await classifyEmailWithAI(email);
        results.push(result);
        // Delay between requests to avoid rate limiting
        if (delayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
    return results;
}
