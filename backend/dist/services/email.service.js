"use strict";
/**
 * Email Service
 * Migrated to Resend for better deliverability and developer experience
 * Handles all transactional emails: lead notifications, billing, usage warnings, etc.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resend = void 0;
exports.sendNotSpamNotification = sendNotSpamNotification;
exports.sendScanCompleteNotification = sendScanCompleteNotification;
exports.sendWelcomeEmail = sendWelcomeEmail;
exports.sendUsageWarningEmail = sendUsageWarningEmail;
exports.sendSubscriptionConfirmationEmail = sendSubscriptionConfirmationEmail;
exports.sendTrialStartedEmail = sendTrialStartedEmail;
exports.sendTrialExpiredEmail = sendTrialExpiredEmail;
exports.sendTrialExpiredEmailAsync = sendTrialExpiredEmailAsync;
exports.sendPaymentReceiptEmail = sendPaymentReceiptEmail;
exports.sendSubscriptionCancelledEmail = sendSubscriptionCancelledEmail;
exports.sendWelcomeEmailAsync = sendWelcomeEmailAsync;
exports.sendUsageWarningEmailAsync = sendUsageWarningEmailAsync;
exports.sendSubscriptionConfirmationEmailAsync = sendSubscriptionConfirmationEmailAsync;
exports.sendTrialStartedEmailAsync = sendTrialStartedEmailAsync;
exports.sendPaymentReceiptEmailAsync = sendPaymentReceiptEmailAsync;
exports.sendSubscriptionCancelledEmailAsync = sendSubscriptionCancelledEmailAsync;
exports.sendFeedbackNotificationEmail = sendFeedbackNotificationEmail;
exports.sendFeedbackNotificationEmailAsync = sendFeedbackNotificationEmailAsync;
exports.sendAutoMoveSuggestionEmail = sendAutoMoveSuggestionEmail;
exports.sendAutoMoveSuggestionEmailAsync = sendAutoMoveSuggestionEmailAsync;
exports.sendWeeklyRecapEmail = sendWeeklyRecapEmail;
exports.sendWeeklyRecapEmailAsync = sendWeeklyRecapEmailAsync;
exports.sendEmail = sendEmail;
exports.sendEmailAsync = sendEmailAsync;
const resend_1 = require("resend");
const config_1 = require("../lib/config");
const email_template_service_1 = require("./email-template.service");
const email_notification_settings_service_1 = require("./email-notification-settings.service");
// Initialize Resend
const resend = new resend_1.Resend(process.env.RESEND_API_KEY);
exports.resend = resend;
// Email configuration
const FROM_EMAIL = process.env.EMAIL_FROM || 'MyInboxer <noreply@myinboxer.com>';
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@myinboxer.com';
const APP_URL = config_1.config.appUrl && !config_1.config.appUrl.includes('localhost')
    ? config_1.config.appUrl
    : config_1.config.frontendUrl && !config_1.config.frontendUrl.includes('localhost')
        ? config_1.config.frontendUrl
        : config_1.config.apiUrl && !config_1.config.apiUrl.includes('localhost')
            ? config_1.config.apiUrl.replace(/:\d+$/, '') // Strip port from API URL as last resort
            : 'http://localhost:3000';
// ========================================
// EMERGENCY KILL SWITCH
// ========================================
// Set DISABLE_ALL_EMAILS=true in .env to stop ALL email sending
const EMAILS_DISABLED = process.env.DISABLE_ALL_EMAILS === 'true';
if (EMAILS_DISABLED) {
    console.warn('⚠️  [Email] ALL EMAILS DISABLED - Set DISABLE_ALL_EMAILS=false in .env to re-enable');
}
// ========================================
// Rate Limiting for Resend (2 requests/second)
// ========================================
class EmailRateLimiter {
    queue = [];
    processing = false;
    lastSendTime = 0;
    minDelayMs = 500; // 500ms between sends = 2 per second
    async enqueue(fn) {
        return new Promise((resolve, reject) => {
            this.queue.push(async () => {
                try {
                    const result = await fn();
                    resolve(result);
                }
                catch (error) {
                    reject(error);
                }
            });
            this.processQueue();
        });
    }
    async processQueue() {
        if (this.processing || this.queue.length === 0)
            return;
        this.processing = true;
        while (this.queue.length > 0) {
            const now = Date.now();
            const timeSinceLastSend = now - this.lastSendTime;
            // Wait if we sent an email too recently
            if (timeSinceLastSend < this.minDelayMs) {
                await this.delay(this.minDelayMs - timeSinceLastSend);
            }
            const fn = this.queue.shift();
            if (fn) {
                this.lastSendTime = Date.now();
                await fn();
            }
        }
        this.processing = false;
    }
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
const emailRateLimiter = new EmailRateLimiter();
async function sendEmail(options) {
    // EMERGENCY KILL SWITCH - Check first before any other checks
    if (EMAILS_DISABLED) {
        console.log('[Email] ⚠️  Email blocked by DISABLE_ALL_EMAILS flag');
        return { success: false, error: 'All emails disabled by environment variable' };
    }
    // Check notification settings (cooldown, daily limits, thresholds)
    if (options.templateKey) {
        const canSend = await (0, email_notification_settings_service_1.canSendEmail)(options.templateKey, options.itemCount || 1);
        if (!canSend.allowed) {
            console.log(`[Email] ⚠️  Email blocked by notification settings: ${canSend.reason}`);
            return { success: false, error: `Notification blocked: ${canSend.reason}` };
        }
    }
    // Check if Resend is configured
    if (!process.env.RESEND_API_KEY) {
        console.warn('[Email] RESEND_API_KEY not configured - email disabled');
        return { success: false, error: 'Email service not configured' };
    }
    // Use rate limiter to respect Resend's 2 requests/second limit
    return emailRateLimiter.enqueue(async () => {
        try {
            const { data, error } = await resend.emails.send({
                from: FROM_EMAIL,
                to: Array.isArray(options.to) ? options.to : [options.to],
                subject: options.subject,
                html: options.html,
                text: options.text,
                reply_to: options.replyTo,
            });
            if (error) {
                console.error('[Email] Send failed:', error);
                return { success: false, error: error.message };
            }
            // Record successful send for rate limiting
            if (options.templateKey) {
                (0, email_notification_settings_service_1.recordEmailSent)(options.templateKey);
            }
            console.log(`[Email] ✓ Sent to ${options.to}: ${options.subject} (ID: ${data?.id})`);
            return { success: true, messageId: data?.id };
        }
        catch (error) {
            console.error('[Email] Unexpected error:', error);
            return { success: false, error: error.message };
        }
    });
}
// Fire-and-forget email sending (non-blocking)
function sendEmailAsync(options) {
    sendEmail(options).catch(error => {
        console.error('[Email] Async send failed:', error);
    });
}
async function sendNotSpamNotification(data) {
    console.log(`[EmailService] 📧 sendNotSpamNotification called for: ${data.recipientEmail}, subject: "${data.notSpamSubject?.substring(0, 50)}..."`);
    // Load template from database
    const template = await (0, email_template_service_1.loadTemplate)('lead_found');
    if (!template) {
        console.log('[EmailService] ⚠️ lead_found template is not active, skipping notification');
        return;
    }
    console.log(`[EmailService] ✓ lead_found template loaded successfully (is_active: ${template.is_active})`);
    // Build template variables - all content comes from database template
    const variables = {
        recipientEmail: data.recipientEmail,
        recipientName: data.recipientName || '',
        notSpamSubject: data.notSpamSubject,
        notSpamFrom: data.notSpamFrom,
        notSpamSenderEmail: data.notSpamSenderEmail,
        notSpamPriority: data.notSpamPriority,
        notSpamConfidence: data.notSpamConfidence,
        notSpamSnippet: data.notSpamSnippet,
        messageUrl: data.messageUrl,
        settingsUrl: `${APP_URL}/settings`,
        // Action URLs for quick action buttons
        actionUrlRescue: data.actionUrls?.rescue || '',
        actionUrlDelete: '', // Delete action disabled
        actionUrlView: data.actionUrls?.view || '',
        actionUrlLegit: data.actionUrls?.legit || '',
        actionUrlSpam: data.actionUrls?.spam || '',
        actionUrlPromotion: data.actionUrls?.promotion || '',
    };
    // Render template with variables
    const rendered = (0, email_template_service_1.renderTemplate)(template, variables);
    console.log(`[EmailService] Template rendered, subject: "${rendered.subject}"`);
    const result = await sendEmail({
        to: data.recipientEmail,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        templateKey: 'lead_found',
        itemCount: 1,
    });
    if (result.success) {
        console.log(`[EmailService] ✅ lead_found notification sent successfully to ${data.recipientEmail} (ID: ${result.messageId})`);
    }
    else {
        console.log(`[EmailService] ❌ lead_found notification failed: ${result.error}`);
    }
}
async function sendScanCompleteNotification(data) {
    if (data.notSpamFound === 0)
        return; // Only send if leads found
    // Try to load template from database
    const template = await (0, email_template_service_1.loadTemplate)('scan_complete');
    // If template is not active, don't send email
    if (!template) {
        console.log('[EmailService] scan_complete template is not active, skipping notification');
        return;
    }
    let subject;
    let html;
    let text;
    // Use database template with variable substitution
    const variables = {
        recipientEmail: data.recipientEmail,
        recipientName: data.recipientName || '',
        mailboxEmail: data.mailboxEmail,
        messagesProcessed: data.messagesProcessed,
        notSpamFound: data.notSpamFound,
        dashboardUrl: data.dashboardUrl,
        settingsUrl: `${APP_URL}/settings`,
    };
    const rendered = (0, email_template_service_1.renderTemplate)(template, variables);
    subject = rendered.subject;
    html = rendered.html;
    text = rendered.text;
    await sendEmail({
        to: data.recipientEmail,
        subject,
        html,
        text,
    });
}
async function sendWelcomeEmail(data) {
    // Check if template is active before sending
    const template = await (0, email_template_service_1.loadTemplate)('welcome');
    if (!template) {
        console.log('[EmailService] welcome template is not active, skipping notification');
        return;
    }
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Welcome to MyInboxer</title></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f3f4f6;">
<table role="presentation" style="width:100%;border-collapse:collapse;"><tr><td align="center" style="padding:40px 0;">
<table role="presentation" style="width:600px;border-collapse:collapse;background-color:#ffffff;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
<tr><td style="padding:32px;background-color:#6366f1;border-radius:8px 8px 0 0;"><h1 style="margin:0;color:#ffffff;font-size:28px;font-weight:bold;">Welcome to MyInboxer! 🎉</h1></td></tr>
<tr><td style="padding:32px;">
<p style="margin:0 0 16px 0;color:#374151;font-size:16px;">Hi${data.recipientName ? ` ${data.recipientName}` : ''},</p>
<p style="margin:0 0 24px 0;color:#374151;font-size:16px;">Thank you for signing up for MyInboxer! You're now on the <strong>${data.planName}</strong> plan.</p>
<h2 style="margin:0 0 16px 0;color:#111827;font-size:20px;font-weight:bold;">Getting Started</h2>
<ul style="margin:0 0 24px 0;padding-left:20px;color:#374151;font-size:15px;line-height:1.8;">
<li>Connect your first mailbox (Gmail or Outlook)</li>
<li>Run your first spam scan to find hidden leads</li>
<li>Set up email notifications for new leads</li>
<li>Customize your classification rules</li>
</ul>
<table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:24px;"><tr><td align="center"><a href="${APP_URL}/dashboard" style="display:inline-block;padding:14px 28px;background-color:#6366f1;color:#ffffff;text-decoration:none;border-radius:6px;font-size:16px;font-weight:600;">Go to Dashboard</a></td></tr></table>
<p style="margin:0;color:#6b7280;font-size:14px;line-height:1.5;">Need help? Check out our <a href="${APP_URL}/docs" style="color:#6366f1;text-decoration:none;">documentation</a> or <a href="mailto:${SUPPORT_EMAIL}" style="color:#6366f1;text-decoration:none;">contact support</a>.</p>
</td></tr>
<tr><td style="padding:24px 32px;background-color:#f9fafb;border-top:1px solid #e5e7eb;"><p style="margin:0;color:#6b7280;font-size:12px;">© ${new Date().getFullYear()} MyInboxer. All rights reserved.</p></td></tr>
</table></td></tr></table>
</body>
</html>`;
    const text = `Welcome to MyInboxer!\n\nHi${data.recipientName ? ` ${data.recipientName}` : ''},\n\nThank you for signing up for MyInboxer! You're now on the ${data.planName} plan.\n\nGetting Started:\n- Connect your first mailbox (Gmail or Outlook)\n- Run your first spam scan to find hidden leads\n- Set up email notifications for new leads\n- Customize your classification rules\n\nGo to Dashboard: ${APP_URL}/dashboard\n\nNeed help? Contact us at ${SUPPORT_EMAIL}`;
    sendEmailAsync({
        to: data.recipientEmail,
        subject: 'Welcome to MyInboxer! 🎉',
        html,
        text,
    });
}
async function sendUsageWarningEmail(data) {
    // Check if template is active before sending
    const template = await (0, email_template_service_1.loadTemplate)('usage_warning');
    if (!template) {
        console.log('[EmailService] usage_warning template is not active, skipping notification');
        return;
    }
    const isLimitReached = data.percentage >= 100;
    const color = isLimitReached ? '#ef4444' : '#f59e0b';
    const emoji = isLimitReached ? '🚨' : '⚠️';
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Usage Warning</title></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f3f4f6;">
<table role="presentation" style="width:100%;border-collapse:collapse;"><tr><td align="center" style="padding:40px 0;">
<table role="presentation" style="width:600px;border-collapse:collapse;background-color:#ffffff;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
<tr><td style="padding:32px;background-color:${color};border-radius:8px 8px 0 0;"><h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:bold;">${emoji} ${isLimitReached ? 'Limit Reached' : 'Approaching Limit'}</h1></td></tr>
<tr><td style="padding:32px;">
<p style="margin:0 0 16px 0;color:#374151;font-size:16px;">Hi${data.recipientName ? ` ${data.recipientName}` : ''},</p>
<p style="margin:0 0 24px 0;color:#374151;font-size:16px;">${isLimitReached ? `You've reached your ${data.featureName} limit` : `You've used ${data.percentage}% of your ${data.featureName} limit`} on your ${data.planName} plan.</p>
<table role="presentation" style="width:100%;border-collapse:collapse;background-color:#f9fafb;border-radius:8px;padding:20px;margin-bottom:24px;">
<tr><td><p style="margin:0 0 8px 0;color:#6b7280;font-size:14px;font-weight:600;">Current Usage</p><p style="margin:0;color:#111827;font-size:24px;font-weight:bold;">${data.current.toLocaleString()} / ${data.limit.toLocaleString()}</p><div style="margin-top:12px;width:100%;background-color:#e5e7eb;border-radius:4px;height:8px;overflow:hidden;"><div style="width:${Math.min(data.percentage, 100)}%;background-color:${color};height:8px;border-radius:4px;"></div></div></td></tr>
</table>
<p style="margin:0 0 24px 0;color:#374151;font-size:16px;">${isLimitReached ? 'Upgrade your plan to continue using this feature without interruption.' : 'Consider upgrading before you hit your limit.'}</p>
<table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:24px;"><tr><td align="center"><a href="${data.upgradeUrl}" style="display:inline-block;padding:14px 28px;background-color:${color};color:#ffffff;text-decoration:none;border-radius:6px;font-size:16px;font-weight:600;">Upgrade Plan</a></td></tr></table>
<p style="margin:0;color:#6b7280;font-size:14px;line-height:1.5;">Questions? <a href="mailto:${SUPPORT_EMAIL}" style="color:#6366f1;text-decoration:none;">Contact support</a></p>
</td></tr>
<tr><td style="padding:24px 32px;background-color:#f9fafb;border-top:1px solid #e5e7eb;"><p style="margin:0;color:#6b7280;font-size:12px;">© ${new Date().getFullYear()} MyInboxer. All rights reserved.</p></td></tr>
</table></td></tr></table>
</body>
</html>`;
    const text = `${isLimitReached ? 'Limit Reached' : 'Approaching Limit'}\n\nHi${data.recipientName ? ` ${data.recipientName}` : ''},\n\n${isLimitReached ? `You've reached your ${data.featureName} limit` : `You've used ${data.percentage}% of your ${data.featureName} limit`} on your ${data.planName} plan.\n\nCurrent Usage: ${data.current.toLocaleString()} / ${data.limit.toLocaleString()}\n\n${isLimitReached ? 'Upgrade your plan to continue using this feature without interruption.' : 'Consider upgrading before you hit your limit.'}\n\nUpgrade Plan: ${data.upgradeUrl}`;
    sendEmailAsync({
        to: data.recipientEmail,
        subject: `${emoji} ${isLimitReached ? 'Limit Reached' : 'Approaching Limit'}: ${data.featureName}`,
        html,
        text,
    });
}
async function sendSubscriptionConfirmationEmail(data) {
    // Check if template is active before sending
    const template = await (0, email_template_service_1.loadTemplate)('subscription_confirmation');
    if (!template) {
        console.log('[EmailService] subscription_confirmation template is not active, skipping notification');
        return;
    }
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Subscription Confirmed</title></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f3f4f6;">
<table role="presentation" style="width:100%;border-collapse:collapse;"><tr><td align="center" style="padding:40px 0;">
<table role="presentation" style="width:600px;border-collapse:collapse;background-color:#ffffff;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
<tr><td style="padding:32px;background-color:#10b981;border-radius:8px 8px 0 0;"><h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:bold;">✅ Subscription Confirmed</h1></td></tr>
<tr><td style="padding:32px;">
<p style="margin:0 0 16px 0;color:#374151;font-size:16px;">Hi${data.recipientName ? ` ${data.recipientName}` : ''},</p>
<p style="margin:0 0 24px 0;color:#374151;font-size:16px;">Your subscription to the <strong>${data.planName}</strong> plan has been confirmed!</p>
<table role="presentation" style="width:100%;border-collapse:collapse;background-color:#f9fafb;border-radius:8px;padding:20px;margin-bottom:24px;">
<tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;"><span style="color:#6b7280;font-size:14px;">Plan</span><br><strong style="color:#111827;font-size:16px;">${data.planName}</strong></td></tr>
<tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;"><span style="color:#6b7280;font-size:14px;">Amount</span><br><strong style="color:#111827;font-size:16px;">$${data.amount.toFixed(2)} / ${data.billingCycle === 'yearly' ? 'year' : 'month'}</strong></td></tr>
<tr><td style="padding:8px 0;"><span style="color:#6b7280;font-size:14px;">Next Billing Date</span><br><strong style="color:#111827;font-size:16px;">${data.nextBillingDate}</strong></td></tr>
</table>
<table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:24px;"><tr><td align="center"><a href="${APP_URL}/settings/billing" style="display:inline-block;padding:14px 28px;background-color:#10b981;color:#ffffff;text-decoration:none;border-radius:6px;font-size:16px;font-weight:600;">Manage Subscription</a></td></tr></table>
<p style="margin:0;color:#6b7280;font-size:14px;line-height:1.5;">You can manage your subscription, update payment methods, or cancel anytime from your billing settings.</p>
</td></tr>
<tr><td style="padding:24px 32px;background-color:#f9fafb;border-top:1px solid #e5e7eb;"><p style="margin:0;color:#6b7280;font-size:12px;">© ${new Date().getFullYear()} MyInboxer. All rights reserved.</p></td></tr>
</table></td></tr></table>
</body>
</html>`;
    const text = `Subscription Confirmed\n\nHi${data.recipientName ? ` ${data.recipientName}` : ''},\n\nYour subscription to the ${data.planName} plan has been confirmed!\n\nPlan: ${data.planName}\nAmount: $${data.amount.toFixed(2)} / ${data.billingCycle === 'yearly' ? 'year' : 'month'}\nNext Billing Date: ${data.nextBillingDate}\n\nManage Subscription: ${APP_URL}/settings/billing`;
    sendEmailAsync({
        to: data.recipientEmail,
        subject: `✅ Subscription Confirmed: ${data.planName}`,
        html,
        text,
    });
}
async function sendTrialStartedEmail(data) {
    // Check if template is active before sending
    const template = await (0, email_template_service_1.loadTemplate)('trial_started');
    if (!template) {
        console.log('[EmailService] trial_started template is not active, skipping notification');
        return;
    }
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Trial Started</title></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f3f4f6;">
<table role="presentation" style="width:100%;border-collapse:collapse;"><tr><td align="center" style="padding:40px 0;">
<table role="presentation" style="width:600px;border-collapse:collapse;background-color:#ffffff;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
<tr><td style="padding:32px;background-color:#3b82f6;border-radius:8px 8px 0 0;"><h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:bold;">🎉 Your Free Trial Has Started!</h1></td></tr>
<tr><td style="padding:32px;">
<p style="margin:0 0 16px 0;color:#374151;font-size:16px;">Hi${data.recipientName ? ` ${data.recipientName}` : ''},</p>
<p style="margin:0 0 24px 0;color:#374151;font-size:16px;">Welcome to MyInboxer! Your <strong>${data.trialDays}-day free trial</strong> of the <strong>${data.planName}</strong> plan is now active.</p>
<table role="presentation" style="width:100%;border-collapse:collapse;background-color:#eff6ff;border-radius:8px;padding:20px;margin-bottom:24px;border:1px solid #bfdbfe;">
<tr><td style="padding:16px;">
<p style="margin:0 0 8px 0;color:#1e40af;font-size:14px;font-weight:600;">✨ What's included in your trial:</p>
<ul style="margin:0 0 16px 0;padding-left:20px;color:#374151;font-size:14px;">
<li style="margin-bottom:8px;">Full access to all ${data.planName} plan features</li>
<li style="margin-bottom:8px;">AI-powered spam rescue technology</li>
<li style="margin-bottom:8px;">Automatic email classification</li>
<li style="margin-bottom:8px;">Priority support</li>
</ul>
<p style="margin:0;color:#6b7280;font-size:13px;"><strong>Trial ends:</strong> ${data.trialEndDate}</p>
</td></tr>
</table>
<table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:24px;"><tr><td align="center"><a href="${APP_URL}/dashboard" style="display:inline-block;padding:14px 28px;background-color:#3b82f6;color:#ffffff;text-decoration:none;border-radius:6px;font-size:16px;font-weight:600;">Start Rescuing Emails</a></td></tr></table>
<p style="margin:0 0 16px 0;color:#6b7280;font-size:14px;line-height:1.5;">No credit card required during your trial. You can upgrade to a paid plan anytime to continue using all features after your trial ends.</p>
<p style="margin:0;color:#6b7280;font-size:14px;line-height:1.5;">Need help getting started? Check out our <a href="${APP_URL}/docs" style="color:#3b82f6;text-decoration:none;">documentation</a> or reply to this email.</p>
</td></tr>
<tr><td style="padding:24px 32px;background-color:#f9fafb;border-top:1px solid #e5e7eb;"><p style="margin:0;color:#6b7280;font-size:12px;">© ${new Date().getFullYear()} MyInboxer. All rights reserved.</p></td></tr>
</table></td></tr></table>
</body>
</html>`;
    const text = `Your Free Trial Has Started!\n\nHi${data.recipientName ? ` ${data.recipientName}` : ''},\n\nWelcome to MyInboxer! Your ${data.trialDays}-day free trial of the ${data.planName} plan is now active.\n\nWhat's included:\n- Full access to all ${data.planName} plan features\n- AI-powered spam rescue technology\n- Automatic email classification\n- Priority support\n\nTrial ends: ${data.trialEndDate}\n\nStart rescuing emails: ${APP_URL}/dashboard\n\nNo credit card required during your trial.`;
    sendEmailAsync({
        to: data.recipientEmail,
        subject: `🎉 Your ${data.trialDays}-Day Free Trial Has Started!`,
        html,
        text,
    });
}
async function sendTrialExpiredEmail(data) {
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Trial Ended</title></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f3f4f6;">
<table role="presentation" style="width:100%;border-collapse:collapse;"><tr><td align="center" style="padding:40px 0;">
<table role="presentation" style="width:600px;border-collapse:collapse;background-color:#ffffff;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
<tr><td style="padding:32px;background-color:#dc2626;border-radius:8px 8px 0 0;"><h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:bold;">Your MyInboxer Trial Has Ended</h1></td></tr>
<tr><td style="padding:32px;">
<p style="margin:0 0 16px 0;color:#374151;font-size:16px;">Hi${data.recipientName ? ` ${data.recipientName}` : ''},</p>
<p style="margin:0 0 24px 0;color:#374151;font-size:16px;">Your free trial of the <strong>${data.planName}</strong> plan has ended. Your MyInboxer Agent has <strong>stopped scanning your inbox</strong> and is no longer classifying or rescuing emails.</p>
<table role="presentation" style="width:100%;border-collapse:collapse;background-color:#fef2f2;border-radius:8px;padding:20px;margin-bottom:24px;border:1px solid #fecaca;">
<tr><td style="padding:16px;">
<p style="margin:0 0 8px 0;color:#991b1b;font-size:14px;font-weight:600;">What this means:</p>
<ul style="margin:0;padding-left:20px;color:#374151;font-size:14px;">
<li style="margin-bottom:8px;">New emails are no longer being scanned or classified</li>
<li style="margin-bottom:8px;">Spam and promotional emails may reach your inbox unfiltered</li>
<li style="margin-bottom:8px;">Important emails may be missed without AI rescue</li>
</ul>
</td></tr>
</table>
<table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:24px;"><tr><td align="center"><a href="${data.pricingUrl}" style="display:inline-block;padding:14px 28px;background-color:#3b82f6;color:#ffffff;text-decoration:none;border-radius:6px;font-size:16px;font-weight:600;">View Plans & Upgrade</a></td></tr></table>
<p style="margin:0;color:#6b7280;font-size:14px;line-height:1.5;">Upgrade today to reactivate your MyInboxer Agent and keep your inbox clean.</p>
</td></tr>
<tr><td style="padding:24px 32px;background-color:#f9fafb;border-top:1px solid #e5e7eb;"><p style="margin:0;color:#6b7280;font-size:12px;">&copy; ${new Date().getFullYear()} MyInboxer. All rights reserved.</p></td></tr>
</table></td></tr></table>
</body>
</html>`;
    const text = `Your MyInboxer Trial Has Ended\n\nHi${data.recipientName ? ` ${data.recipientName}` : ''},\n\nYour free trial of the ${data.planName} plan has ended. Your MyInboxer Agent has stopped scanning your inbox.\n\nWhat this means:\n- New emails are no longer being scanned or classified\n- Spam and promotional emails may reach your inbox unfiltered\n- Important emails may be missed without AI rescue\n\nUpgrade now: ${data.pricingUrl}\n\nUpgrade today to reactivate your MyInboxer Agent.`;
    sendEmailAsync({
        to: data.recipientEmail,
        subject: 'Your MyInboxer Trial Has Ended — Upgrade to Stay Protected',
        html,
        text,
    });
}
function sendTrialExpiredEmailAsync(data) {
    sendTrialExpiredEmail(data).catch(error => {
        console.error('[Email] Failed to send trial expired email:', error);
    });
}
async function sendPaymentReceiptEmail(data) {
    // Check if template is active before sending
    const template = await (0, email_template_service_1.loadTemplate)('payment_receipt');
    if (!template) {
        console.log('[EmailService] payment_receipt template is not active, skipping notification');
        return;
    }
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Payment Receipt</title></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f3f4f6;">
<table role="presentation" style="width:100%;border-collapse:collapse;"><tr><td align="center" style="padding:40px 0;">
<table role="presentation" style="width:600px;border-collapse:collapse;background-color:#ffffff;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
<tr><td style="padding:32px;background-color:#6366f1;border-radius:8px 8px 0 0;"><h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:bold;">💳 Payment Receipt</h1></td></tr>
<tr><td style="padding:32px;">
<p style="margin:0 0 16px 0;color:#374151;font-size:16px;">Hi${data.recipientName ? ` ${data.recipientName}` : ''},</p>
<p style="margin:0 0 24px 0;color:#374151;font-size:16px;">Thank you for your payment! Here are the details:</p>
<table role="presentation" style="width:100%;border-collapse:collapse;background-color:#f9fafb;border-radius:8px;padding:20px;margin-bottom:24px;">
<tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;"><span style="color:#6b7280;font-size:14px;">Invoice Number</span><br><strong style="color:#111827;font-size:16px;">${data.invoiceNumber}</strong></td></tr>
<tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;"><span style="color:#6b7280;font-size:14px;">Date</span><br><strong style="color:#111827;font-size:16px;">${data.date}</strong></td></tr>
<tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;"><span style="color:#6b7280;font-size:14px;">Plan</span><br><strong style="color:#111827;font-size:16px;">${data.planName}</strong></td></tr>
<tr><td style="padding:8px 0;"><span style="color:#6b7280;font-size:14px;">Amount Paid</span><br><strong style="color:#10b981;font-size:20px;">$${data.amount.toFixed(2)}</strong></td></tr>
</table>
<table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:24px;"><tr><td align="center"><a href="${data.invoiceUrl}" style="display:inline-block;padding:14px 28px;background-color:#6366f1;color:#ffffff;text-decoration:none;border-radius:6px;font-size:16px;font-weight:600;">Download Invoice (PDF)</a></td></tr></table>
<p style="margin:0;color:#6b7280;font-size:14px;line-height:1.5;">Questions about your bill? <a href="mailto:${SUPPORT_EMAIL}" style="color:#6366f1;text-decoration:none;">Contact support</a></p>
</td></tr>
<tr><td style="padding:24px 32px;background-color:#f9fafb;border-top:1px solid #e5e7eb;"><p style="margin:0;color:#6b7280;font-size:12px;">© ${new Date().getFullYear()} MyInboxer. All rights reserved.</p></td></tr>
</table></td></tr></table>
</body>
</html>`;
    const text = `Payment Receipt\n\nHi${data.recipientName ? ` ${data.recipientName}` : ''},\n\nThank you for your payment!\n\nInvoice Number: ${data.invoiceNumber}\nDate: ${data.date}\nPlan: ${data.planName}\nAmount Paid: $${data.amount.toFixed(2)}\n\nDownload Invoice: ${data.invoiceUrl}`;
    sendEmailAsync({
        to: data.recipientEmail,
        subject: `💳 Payment Receipt: $${data.amount.toFixed(2)} - ${data.invoiceNumber}`,
        html,
        text,
    });
}
async function sendSubscriptionCancelledEmail(data) {
    // Check if template is active before sending
    const template = await (0, email_template_service_1.loadTemplate)('subscription_cancelled');
    if (!template) {
        console.log('[EmailService] subscription_cancelled template is not active, skipping notification');
        return;
    }
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Subscription Cancelled</title></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f3f4f6;">
<table role="presentation" style="width:100%;border-collapse:collapse;"><tr><td align="center" style="padding:40px 0;">
<table role="presentation" style="width:600px;border-collapse:collapse;background-color:#ffffff;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
<tr><td style="padding:32px;background-color:#6b7280;border-radius:8px 8px 0 0;"><h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:bold;">Subscription Cancelled</h1></td></tr>
<tr><td style="padding:32px;">
<p style="margin:0 0 16px 0;color:#374151;font-size:16px;">Hi${data.recipientName ? ` ${data.recipientName}` : ''},</p>
<p style="margin:0 0 24px 0;color:#374151;font-size:16px;">Your subscription to the <strong>${data.planName}</strong> plan has been cancelled.</p>
<p style="margin:0 0 24px 0;color:#374151;font-size:16px;">You'll continue to have access to all ${data.planName} features until <strong>${data.endDate}</strong>. After that, your account will be downgraded to the Free plan.</p>
<p style="margin:0 0 24px 0;color:#374151;font-size:16px;">We're sorry to see you go! If you have any feedback or if there's anything we can do to improve, please let us know.</p>
<table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:24px;"><tr><td align="center"><a href="${APP_URL}/pricing" style="display:inline-block;padding:14px 28px;background-color:#6366f1;color:#ffffff;text-decoration:none;border-radius:6px;font-size:16px;font-weight:600;">Reactivate Subscription</a></td></tr></table>
<p style="margin:0;color:#6b7280;font-size:14px;line-height:1.5;">Questions? <a href="mailto:${SUPPORT_EMAIL}" style="color:#6366f1;text-decoration:none;">Contact support</a></p>
</td></tr>
<tr><td style="padding:24px 32px;background-color:#f9fafb;border-top:1px solid #e5e7eb;"><p style="margin:0;color:#6b7280;font-size:12px;">© ${new Date().getFullYear()} MyInboxer. All rights reserved.</p></td></tr>
</table></td></tr></table>
</body>
</html>`;
    const text = `Subscription Cancelled\n\nHi${data.recipientName ? ` ${data.recipientName}` : ''},\n\nYour subscription to the ${data.planName} plan has been cancelled.\n\nYou'll continue to have access to all ${data.planName} features until ${data.endDate}. After that, your account will be downgraded to the Free plan.\n\nWe're sorry to see you go! If you have any feedback, please let us know.\n\nReactivate Subscription: ${APP_URL}/pricing`;
    sendEmailAsync({
        to: data.recipientEmail,
        subject: 'Subscription Cancelled',
        html,
        text,
    });
}
// ========================================
// Async Wrapper Functions (Fire-and-Forget)
// ========================================
function sendWelcomeEmailAsync(data) {
    sendWelcomeEmail(data).catch(error => {
        console.error('[Email] Failed to send welcome email:', error);
    });
}
function sendUsageWarningEmailAsync(data) {
    sendUsageWarningEmail(data).catch(error => {
        console.error('[Email] Failed to send usage warning email:', error);
    });
}
function sendSubscriptionConfirmationEmailAsync(data) {
    sendSubscriptionConfirmationEmail(data).catch(error => {
        console.error('[Email] Failed to send subscription confirmation email:', error);
    });
}
function sendTrialStartedEmailAsync(data) {
    sendTrialStartedEmail(data).catch(error => {
        console.error('[Email] Failed to send trial started email:', error);
    });
}
function sendPaymentReceiptEmailAsync(data) {
    sendPaymentReceiptEmail(data).catch(error => {
        console.error('[Email] Failed to send payment receipt email:', error);
    });
}
function sendSubscriptionCancelledEmailAsync(data) {
    sendSubscriptionCancelledEmail(data).catch(error => {
        console.error('[Email] Failed to send subscription cancelled email:', error);
    });
}
async function sendFeedbackNotificationEmail(data) {
    const ratingStars = '★'.repeat(data.rating) + '☆'.repeat(5 - data.rating);
    const ratingColor = data.rating >= 4 ? '#10b981' : data.rating >= 3 ? '#f59e0b' : '#ef4444';
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>New Feedback Received</title></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f3f4f6;">
<table role="presentation" style="width:100%;border-collapse:collapse;"><tr><td align="center" style="padding:40px 0;">
<table role="presentation" style="width:600px;border-collapse:collapse;background-color:#ffffff;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
<tr><td style="padding:32px;background-color:#6366f1;border-radius:8px 8px 0 0;"><h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:bold;">📝 New Feedback Received</h1></td></tr>
<tr><td style="padding:32px;">
<p style="margin:0 0 24px 0;color:#374151;font-size:16px;">A user has submitted feedback on MyInboxer:</p>
<table role="presentation" style="width:100%;border-collapse:collapse;background-color:#f9fafb;border-radius:8px;margin-bottom:24px;">
<tr><td style="padding:16px;">
<p style="margin:0 0 8px 0;color:#6b7280;font-size:12px;text-transform:uppercase;font-weight:600;">Rating</p>
<p style="margin:0 0 16px 0;font-size:24px;color:${ratingColor};">${ratingStars}</p>
<p style="margin:0 0 8px 0;color:#6b7280;font-size:12px;text-transform:uppercase;font-weight:600;">User</p>
<p style="margin:0 0 16px 0;color:#111827;font-size:14px;"><strong>${data.userName || 'Anonymous'}</strong><br/><span style="color:#6b7280;">${data.userEmail}</span></p>
${data.comment ? `
<p style="margin:0 0 8px 0;color:#6b7280;font-size:12px;text-transform:uppercase;font-weight:600;">Comment</p>
<p style="margin:0 0 16px 0;color:#111827;font-size:14px;background-color:#ffffff;padding:12px;border-radius:6px;border:1px solid #e5e7eb;">${data.comment}</p>
` : ''}
${data.pageUrl ? `
<p style="margin:0 0 8px 0;color:#6b7280;font-size:12px;text-transform:uppercase;font-weight:600;">Page</p>
<p style="margin:0;color:#6366f1;font-size:14px;">${data.pageUrl}</p>
` : ''}
</td></tr>
</table>
<p style="margin:0;color:#6b7280;font-size:12px;">Feedback ID: ${data.feedbackId}<br/>Submitted: ${data.createdAt}</p>
</td></tr>
<tr><td style="padding:24px 32px;background-color:#f9fafb;border-top:1px solid #e5e7eb;"><p style="margin:0;color:#6b7280;font-size:12px;">© ${new Date().getFullYear()} MyInboxer Admin Notification</p></td></tr>
</table></td></tr></table>
</body>
</html>`;
    const text = `New Feedback Received\n\nRating: ${data.rating}/5 stars\nUser: ${data.userName || 'Anonymous'} (${data.userEmail})\n${data.comment ? `Comment: ${data.comment}\n` : ''}${data.pageUrl ? `Page: ${data.pageUrl}\n` : ''}\nFeedback ID: ${data.feedbackId}\nSubmitted: ${data.createdAt}`;
    sendEmailAsync({
        to: data.adminEmail,
        subject: `📝 New Feedback: ${data.rating}/5 stars from ${data.userName || data.userEmail}`,
        html,
        text,
    });
}
function sendFeedbackNotificationEmailAsync(data) {
    sendFeedbackNotificationEmail(data).catch(error => {
        console.error('[Email] Failed to send feedback notification email:', error);
    });
}
async function sendAutoMoveSuggestionEmail(data) {
    // Check if template is active before sending
    const template = await (0, email_template_service_1.loadTemplate)('auto_move_suggestion');
    if (!template) {
        console.log('[EmailService] auto_move_suggestion template is not active, skipping notification');
        return;
    }
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Ready for Auto-Move?</title></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f3f4f6;">
<table role="presentation" style="width:100%;border-collapse:collapse;"><tr><td align="center" style="padding:40px 0;">
<table role="presentation" style="width:600px;border-collapse:collapse;background-color:#ffffff;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
<tr><td style="padding:32px;background-color:#10b981;border-radius:8px 8px 0 0;"><h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:bold;">🎉 Ready for Auto-Move?</h1></td></tr>
<tr><td style="padding:32px;">
<p style="margin:0 0 16px 0;color:#374151;font-size:16px;">Hi${data.recipientName ? ` ${data.recipientName}` : ''},</p>
<p style="margin:0 0 24px 0;color:#374151;font-size:16px;">Great news! You've reviewed <strong>${data.reviewCount}</strong> emails, and MyInboxer has learned your preferences.</p>
<table role="presentation" style="width:100%;border-collapse:collapse;background-color:#ecfdf5;border:2px solid #10b981;border-radius:8px;padding:20px;margin-bottom:24px;">
<tr><td>
<p style="margin:0 0 12px 0;color:#065f46;font-size:14px;font-weight:600;">🚀 UPGRADE SUGGESTION</p>
<p style="margin:0;color:#047857;font-size:15px;line-height:1.6;">Based on your review history, you're ready to enable <strong>Auto-Move</strong>. This means important emails will be automatically moved to your inbox without you needing to review each one.</p>
</td></tr>
</table>
<h3 style="margin:0 0 16px 0;color:#111827;font-size:16px;font-weight:bold;">What you'll get:</h3>
<ul style="margin:0 0 24px 0;padding-left:20px;color:#374151;font-size:15px;line-height:1.8;">
<li>Important emails moved to inbox instantly</li>
<li>No more manual review needed</li>
<li>You can still correct mistakes anytime</li>
</ul>
<table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:24px;">
<tr>
<td align="center" style="padding-right:8px;"><a href="${data.enableUrl}" style="display:inline-block;padding:14px 28px;background-color:#10b981;color:#ffffff;text-decoration:none;border-radius:6px;font-size:16px;font-weight:600;">Enable Auto-Move</a></td>
</tr>
</table>
<p style="margin:0;color:#6b7280;font-size:14px;line-height:1.5;">You can change this anytime in your <a href="${data.settingsUrl}" style="color:#6366f1;text-decoration:none;">mailbox settings</a>.</p>
</td></tr>
<tr><td style="padding:24px 32px;background-color:#f9fafb;border-top:1px solid #e5e7eb;"><p style="margin:0;color:#6b7280;font-size:12px;">© ${new Date().getFullYear()} MyInboxer. All rights reserved.</p></td></tr>
</table></td></tr></table>
</body>
</html>`;
    const text = `Ready for Auto-Move?\n\nHi${data.recipientName ? ` ${data.recipientName}` : ''},\n\nGreat news! You've reviewed ${data.reviewCount} emails, and MyInboxer has learned your preferences.\n\nBased on your review history, you're ready to enable Auto-Move. This means important emails will be automatically moved to your inbox without you needing to review each one.\n\nWhat you'll get:\n- Important emails moved to inbox instantly\n- No more manual review needed\n- You can still correct mistakes anytime\n\nEnable Auto-Move: ${data.enableUrl}\n\nYou can change this anytime in your mailbox settings: ${data.settingsUrl}`;
    sendEmailAsync({
        to: data.recipientEmail,
        subject: '🎉 Ready for Auto-Move? You\'ve reviewed enough emails!',
        html,
        text,
        templateKey: 'auto_move_suggestion',
    });
}
function sendAutoMoveSuggestionEmailAsync(data) {
    sendAutoMoveSuggestionEmail(data).catch(error => {
        console.error('[Email] Failed to send auto-move suggestion email:', error);
    });
}
async function sendWeeklyRecapEmail(data) {
    // Check if template is active before sending
    const template = await (0, email_template_service_1.loadTemplate)('weekly_recap');
    if (!template) {
        console.log('[EmailService] weekly_recap template is not active, skipping');
        return;
    }
    const topSendersHtml = data.topSenders.length > 0
        ? data.topSenders.map(s => `<tr><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#374151;font-size:14px;">${s.email}</td><td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#6366f1;font-size:14px;font-weight:600;text-align:right;">${s.count} email${s.count !== 1 ? 's' : ''}</td></tr>`).join('')
        : '<tr><td colspan="2" style="padding:12px;color:#6b7280;font-size:14px;text-align:center;">No senders this week</td></tr>';
    const topSendersText = data.topSenders.length > 0
        ? data.topSenders.map(s => `  - ${s.email}: ${s.count} email(s)`).join('\n')
        : '  No senders this week';
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Weekly Recap</title></head>
<body style="margin:0;padding:0;font-family:Arial,sans-serif;background-color:#f3f4f6;">
<table role="presentation" style="width:100%;border-collapse:collapse;"><tr><td align="center" style="padding:40px 0;">
<table role="presentation" style="width:600px;border-collapse:collapse;background-color:#ffffff;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1);">
<tr><td style="padding:32px;background:linear-gradient(135deg, #6366f1, #8b5cf6);border-radius:8px 8px 0 0;">
<h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:bold;">📈 Your Weekly Recap</h1>
<p style="margin:8px 0 0 0;color:rgba(255,255,255,0.85);font-size:14px;">${data.periodStart} — ${data.periodEnd}</p>
</td></tr>
<tr><td style="padding:32px;">
<p style="margin:0 0 24px 0;color:#374151;font-size:16px;">Hi${data.recipientName ? ` ${data.recipientName}` : ''},</p>
<p style="margin:0 0 24px 0;color:#374151;font-size:16px;">Here's a summary of your spam folder analysis this week:</p>

<!-- Stats Grid -->
<table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:24px;">
<tr>
<td style="width:50%;padding:16px;background-color:#f0fdf4;border-radius:8px 0 0 0;text-align:center;border:1px solid #bbf7d0;">
<p style="margin:0;color:#15803d;font-size:28px;font-weight:bold;">${data.totalScanned}</p>
<p style="margin:4px 0 0 0;color:#166534;font-size:12px;text-transform:uppercase;font-weight:600;">Emails Scanned</p>
</td>
<td style="width:50%;padding:16px;background-color:#eff6ff;border-radius:0 8px 0 0;text-align:center;border:1px solid #bfdbfe;">
<p style="margin:0;color:#1d4ed8;font-size:28px;font-weight:bold;">${data.legitFound}</p>
<p style="margin:4px 0 0 0;color:#1e40af;font-size:12px;text-transform:uppercase;font-weight:600;">Legit Rescued</p>
</td>
</tr>
<tr>
<td style="width:50%;padding:16px;background-color:#fef2f2;border-radius:0 0 0 8px;text-align:center;border:1px solid #fecaca;">
<p style="margin:0;color:#dc2626;font-size:28px;font-weight:bold;">${data.spamConfirmed}</p>
<p style="margin:4px 0 0 0;color:#991b1b;font-size:12px;text-transform:uppercase;font-weight:600;">Spam Confirmed</p>
</td>
<td style="width:50%;padding:16px;background-color:#fefce8;border-radius:0 0 8px 0;text-align:center;border:1px solid #fde68a;">
<p style="margin:0;color:#ca8a04;font-size:28px;font-weight:bold;">${data.accuracy}%</p>
<p style="margin:4px 0 0 0;color:#92400e;font-size:12px;text-transform:uppercase;font-weight:600;">Accuracy</p>
</td>
</tr>
</table>

<!-- Top Senders -->
<h3 style="margin:0 0 12px 0;color:#111827;font-size:16px;font-weight:bold;">Top Rescued Senders</h3>
<table role="presentation" style="width:100%;border-collapse:collapse;background-color:#f9fafb;border-radius:8px;margin-bottom:24px;overflow:hidden;">
${topSendersHtml}
</table>

<table role="presentation" style="width:100%;border-collapse:collapse;margin-bottom:24px;"><tr><td align="center">
<a href="${data.dashboardUrl}" style="display:inline-block;padding:14px 28px;background-color:#6366f1;color:#ffffff;text-decoration:none;border-radius:6px;font-size:16px;font-weight:600;">View Full Dashboard</a>
</td></tr></table>

<p style="margin:0;color:#6b7280;font-size:13px;line-height:1.5;">You can disable weekly recaps in your <a href="${APP_URL}/settings/notifications" style="color:#6366f1;text-decoration:none;">notification settings</a>.</p>
</td></tr>
<tr><td style="padding:24px 32px;background-color:#f9fafb;border-top:1px solid #e5e7eb;"><p style="margin:0;color:#6b7280;font-size:12px;">© ${new Date().getFullYear()} MyInboxer. All rights reserved.</p></td></tr>
</table></td></tr></table>
</body>
</html>`;
    const text = `Your Weekly Recap (${data.periodStart} — ${data.periodEnd})

Hi${data.recipientName ? ` ${data.recipientName}` : ''},

Here's a summary of your spam folder analysis this week:

- Emails Scanned: ${data.totalScanned}
- Legit Rescued: ${data.legitFound}
- Spam Confirmed: ${data.spamConfirmed}
- Accuracy: ${data.accuracy}%

Top Rescued Senders:
${topSendersText}

View Full Dashboard: ${data.dashboardUrl}

You can disable weekly recaps in your notification settings: ${APP_URL}/settings/notifications`;
    await sendEmail({
        to: data.recipientEmail,
        subject: `📈 Weekly Recap: ${data.legitFound} email${data.legitFound !== 1 ? 's' : ''} rescued this week`,
        html,
        text,
        templateKey: 'weekly_recap',
    });
}
function sendWeeklyRecapEmailAsync(data) {
    sendWeeklyRecapEmail(data).catch(error => {
        console.error('[Email] Failed to send weekly recap email:', error);
    });
}
