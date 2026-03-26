"use strict";
/**
 * Slack Service
 * Handles sending lead alerts to Slack channels via webhooks
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendSlackNotSpamAlert = sendSlackNotSpamAlert;
exports.testSlackWebhook = testSlackWebhook;
const config_1 = require("../lib/config");
const prisma_1 = require("../lib/prisma");
/**
 * Send Slack alert for detected lead message
 */
async function sendSlackNotSpamAlert(data) {
    if (!data.slackWebhookUrl) {
        console.log('Slack webhook not configured');
        return false;
    }
    try {
        // Build Slack message with rich formatting (Block Kit)
        const priorityEmoji = {
            high: ':red_circle:',
            medium: ':large_orange_circle:',
            low: ':white_circle:',
        };
        const confidencePercent = Math.round(data.notSpamConfidence * 100);
        const messageUrl = `${(config_1.config.appUrl || config_1.config.frontendUrl)}/messages/${data.messageId}`;
        const slackMessage = {
            text: `🎯 New Important Email Detected: ${data.notSpamSubject}`,
            blocks: [
                {
                    type: 'header',
                    text: {
                        type: 'plain_text',
                        text: '🎯 New Important Email Detected in Your Spam Folder',
                        emoji: true,
                    },
                },
                {
                    type: 'section',
                    fields: [
                        {
                            type: 'mrkdwn',
                            text: `*From:*\n${data.notSpamFrom}`,
                        },
                        {
                            type: 'mrkdwn',
                            text: `*Email:*\n${data.notSpamSenderEmail}`,
                        },
                        {
                            type: 'mrkdwn',
                            text: `*Priority:*\n${priorityEmoji[data.notSpamPriority]} ${data.notSpamPriority.toUpperCase()}`,
                        },
                        {
                            type: 'mrkdwn',
                            text: `*Confidence:*\n${confidencePercent}%`,
                        },
                    ],
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `*Subject:*\n${data.notSpamSubject}`,
                    },
                },
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `*Preview:*\n${data.notSpamSnippet}`,
                    },
                },
                {
                    type: 'actions',
                    elements: [
                        {
                            type: 'button',
                            text: {
                                type: 'plain_text',
                                text: 'View Full Message',
                                emoji: true,
                            },
                            url: messageUrl,
                            style: 'primary',
                        },
                        {
                            type: 'button',
                            text: {
                                type: 'plain_text',
                                text: 'Move to Inbox',
                                emoji: true,
                            },
                            url: `${messageUrl}?action=rescue`,
                        },
                    ],
                },
                {
                    type: 'context',
                    elements: [
                        {
                            type: 'mrkdwn',
                            text: `Detected by SpamRescue | <${(config_1.config.appUrl || config_1.config.frontendUrl)}/settings|Manage Alerts>`,
                        },
                    ],
                },
            ],
        };
        // Send to Slack webhook
        const response = await fetch(data.slackWebhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(slackMessage),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Slack webhook returned ${response.status}: ${errorText}`);
        }
        console.log(`Slack alert sent for message ${data.messageId}`);
        // Track Slack alert in database
        const mailbox = await prisma_1.prisma.mailbox.findFirst({
            where: { user_id: data.userId },
            select: { id: true },
        });
        if (mailbox) {
            await prisma_1.prisma.alert.create({
                data: {
                    mailbox_id: mailbox.id,
                    type: 'new_lead',
                    channel: 'webhook',
                    status: 'sent',
                    payload: {
                        messageId: data.messageId,
                        subject: data.notSpamSubject,
                        from: data.notSpamSenderEmail,
                        confidence: data.notSpamConfidence,
                        platform: 'slack',
                    },
                    sent_at: new Date(),
                },
            });
        }
        return true;
    }
    catch (error) {
        console.error('Failed to send Slack alert:', error);
        // Track failed alert
        const mailbox = await prisma_1.prisma.mailbox.findFirst({
            where: { user_id: data.userId },
            select: { id: true },
        });
        if (mailbox) {
            await prisma_1.prisma.alert.create({
                data: {
                    mailbox_id: mailbox.id,
                    type: 'new_lead',
                    channel: 'webhook',
                    status: 'failed',
                    payload: {
                        messageId: data.messageId,
                        error: error.message,
                        platform: 'slack',
                    },
                },
            });
        }
        return false;
    }
}
/**
 * Test Slack webhook connection
 */
async function testSlackWebhook(webhookUrl) {
    try {
        const testMessage = {
            text: '✅ SpamRescue successfully connected to your Slack workspace!',
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: '✅ *SpamRescue successfully connected!*\n\nYou will receive important email alerts in this channel.',
                    },
                },
            ],
        };
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(testMessage),
        });
        return response.ok;
    }
    catch (error) {
        console.error('Slack webhook test failed:', error);
        return false;
    }
}
