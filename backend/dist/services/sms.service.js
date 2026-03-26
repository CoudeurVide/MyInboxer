"use strict";
/**
 * SMS Service
 * Handles sending SMS alerts via Twilio for high-priority lead messages
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSMSNotSpamAlert = sendSMSNotSpamAlert;
exports.sendVerificationCode = sendVerificationCode;
exports.isValidPhoneNumber = isValidPhoneNumber;
const twilio_1 = __importDefault(require("twilio"));
const config_1 = require("../lib/config");
const prisma_1 = require("../lib/prisma");
// Initialize Twilio client
let twilioClient = null;
function getTwilioClient() {
    if (!twilioClient) {
        if (!config_1.config.sms.twilio.accountSid || !config_1.config.sms.twilio.authToken) {
            console.warn('Twilio not configured. SMS alerts disabled.');
            return null;
        }
        twilioClient = (0, twilio_1.default)(config_1.config.sms.twilio.accountSid, config_1.config.sms.twilio.authToken);
    }
    return twilioClient;
}
/**
 * Send SMS alert for high-confidence lead message
 */
async function sendSMSNotSpamAlert(data) {
    const client = getTwilioClient();
    if (!client) {
        console.log('SMS alerts disabled - Twilio not configured');
        return false;
    }
    try {
        // Check if phone number is verified
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: data.userId },
            select: { phone_verified: true },
        });
        if (!user?.phone_verified) {
            console.log(`SMS alert skipped - phone not verified for user ${data.userId}`);
            return false;
        }
        // Only send for high confidence lead messages (>= 80%)
        if (data.notSpamConfidence < 0.8) {
            console.log(`SMS alert skipped - confidence too low: ${data.notSpamConfidence}`);
            return false;
        }
        // Check rate limit (max 10 SMS per hour per user)
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const recentAlerts = await prisma_1.prisma.alert.count({
            where: {
                mailbox: {
                    user_id: data.userId,
                },
                type: 'new_lead',
                channel: 'sms',
                created_at: {
                    gte: oneHourAgo,
                },
            },
        });
        if (recentAlerts >= 10) {
            console.log(`SMS alert rate limit exceeded for user ${data.userId}: ${recentAlerts} in past hour`);
            return false;
        }
        // Truncate subject if too long
        const subject = data.notSpamSubject.length > 30
            ? data.notSpamSubject.slice(0, 30) + '...'
            : data.notSpamSubject;
        // Format message URL
        const messageUrl = `${(config_1.config.appUrl || config_1.config.frontendUrl)}/messages/${data.messageId}`;
        // Compose SMS message
        const smsBody = `🎯 Important Email from ${data.notSpamFrom}: "${subject}" (${Math.round(data.notSpamConfidence * 100)}% confidence)\nView: ${messageUrl}`;
        // Send SMS via Twilio
        const message = await client.messages.create({
            to: data.recipientPhone,
            from: config_1.config.sms.twilio.phoneNumber,
            body: smsBody,
        });
        console.log(`SMS alert sent to ${data.recipientPhone}: ${message.sid}`);
        // Track SMS alert in database
        const mailbox = await prisma_1.prisma.mailbox.findFirst({
            where: {
                user_id: data.userId,
            },
            select: {
                id: true,
            },
        });
        if (mailbox) {
            await prisma_1.prisma.alert.create({
                data: {
                    mailbox_id: mailbox.id,
                    type: 'new_lead',
                    channel: 'sms',
                    status: 'sent',
                    payload: {
                        messageId: data.messageId,
                        subject: data.notSpamSubject,
                        from: data.notSpamSenderEmail,
                        confidence: data.notSpamConfidence,
                        twilioSid: message.sid,
                    },
                    sent_at: new Date(),
                },
            });
        }
        return true;
    }
    catch (error) {
        console.error('Failed to send SMS alert:', error);
        // Track failed alert
        const mailbox = await prisma_1.prisma.mailbox.findFirst({
            where: {
                user_id: data.userId,
            },
            select: {
                id: true,
            },
        });
        if (mailbox) {
            await prisma_1.prisma.alert.create({
                data: {
                    mailbox_id: mailbox.id,
                    type: 'new_lead',
                    channel: 'sms',
                    status: 'failed',
                    payload: {
                        messageId: data.messageId,
                        error: error.message,
                    },
                },
            });
        }
        return false;
    }
}
/**
 * Send SMS verification code
 */
async function sendVerificationCode(phone, code) {
    const client = getTwilioClient();
    if (!client) {
        console.log('SMS verification disabled - Twilio not configured');
        return false;
    }
    try {
        const message = await client.messages.create({
            to: phone,
            from: config_1.config.sms.twilio.phoneNumber,
            body: `Your SpamRescue verification code is: ${code}\n\nThis code expires in 10 minutes.`,
        });
        console.log(`Verification SMS sent to ${phone}: ${message.sid}`);
        return true;
    }
    catch (error) {
        console.error('Failed to send verification SMS:', error);
        return false;
    }
}
/**
 * Validate phone number format (E.164)
 */
function isValidPhoneNumber(phone) {
    // E.164 format: +[country code][number]
    // Example: +14155552671
    const e164Regex = /^\+[1-9]\d{1,14}$/;
    return e164Regex.test(phone);
}
