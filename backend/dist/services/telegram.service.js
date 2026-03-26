"use strict";
/**
 * Telegram Service
 * Handles sending legit email alerts to Telegram chats via bot API
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendTelegramLeadAlert = sendTelegramLeadAlert;
exports.testTelegramBot = testTelegramBot;
exports.getTelegramBotInfo = getTelegramBotInfo;
const node_telegram_bot_api_1 = __importDefault(require("node-telegram-bot-api"));
const config_1 = require("../lib/config");
const prisma_1 = require("../lib/prisma");
// Initialize Telegram bot (lazy loaded)
let telegramBot = null;
function getTelegramBot() {
    if (!telegramBot) {
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (!botToken) {
            console.warn('Telegram bot token not configured. Telegram alerts disabled.');
            return null;
        }
        try {
            telegramBot = new node_telegram_bot_api_1.default(botToken, { polling: false });
        }
        catch (error) {
            console.error('Failed to initialize Telegram bot:', error);
            return null;
        }
    }
    return telegramBot;
}
/**
 * Send Telegram alert for detected legit message
 */
async function sendTelegramLeadAlert(data) {
    const bot = getTelegramBot();
    if (!bot) {
        console.log('Telegram bot not configured');
        return false;
    }
    if (!data.telegramChatId) {
        console.log('Telegram chat ID not configured');
        return false;
    }
    try {
        const priorityEmoji = {
            high: '🔴',
            medium: '🟡',
            low: '⚪',
        };
        const confidencePercent = Math.round(data.legitConfidence * 100);
        const messageUrl = `${(config_1.config.appUrl || config_1.config.frontendUrl)}/messages/${data.messageId}`;
        // Format message with Telegram Markdown
        const telegramMessage = `
🎯 *Legit Email Detected in Your Spam Folder*

*From:* ${escapeMarkdown(data.legitFrom)}
*Email:* \`${data.legitSenderEmail}\`
*Subject:* ${escapeMarkdown(data.legitSubject)}

*Priority:* ${priorityEmoji[data.legitPriority]} ${data.legitPriority.toUpperCase()}
*Confidence:* ${confidencePercent}%

*Preview:*
${escapeMarkdown(data.legitSnippet)}

[View Full Message](${messageUrl}) | [Move to Inbox](${messageUrl}?action=rescue)

_Detected by MyInboxer_
`.trim();
        // Send message with inline keyboard
        await bot.sendMessage(data.telegramChatId, telegramMessage, {
            parse_mode: 'Markdown',
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: '👀 View Full Message',
                            url: messageUrl,
                        },
                        {
                            text: '📥 Move to Inbox',
                            url: `${messageUrl}?action=rescue`,
                        },
                    ],
                    [
                        {
                            text: '⚙️ Manage Alerts',
                            url: `${(config_1.config.appUrl || config_1.config.frontendUrl)}/settings`,
                        },
                    ],
                ],
            },
        });
        console.log(`Telegram alert sent to chat ${data.telegramChatId} for message ${data.messageId}`);
        // Track Telegram alert in database
        const mailbox = await prisma_1.prisma.mailbox.findFirst({
            where: { user_id: data.userId },
            select: { id: true },
        });
        if (mailbox) {
            await prisma_1.prisma.alert.create({
                data: {
                    mailbox_id: mailbox.id,
                    type: 'new_legit',
                    channel: 'webhook',
                    status: 'sent',
                    payload: {
                        messageId: data.messageId,
                        subject: data.legitSubject,
                        from: data.legitSenderEmail,
                        confidence: data.legitConfidence,
                        platform: 'telegram',
                        chatId: data.telegramChatId,
                    },
                    sent_at: new Date(),
                },
            });
        }
        return true;
    }
    catch (error) {
        console.error('Failed to send Telegram alert:', error);
        // Track failed alert
        const mailbox = await prisma_1.prisma.mailbox.findFirst({
            where: { user_id: data.userId },
            select: { id: true },
        });
        if (mailbox) {
            await prisma_1.prisma.alert.create({
                data: {
                    mailbox_id: mailbox.id,
                    type: 'new_legit',
                    channel: 'webhook',
                    status: 'failed',
                    payload: {
                        messageId: data.messageId,
                        error: error.message,
                        platform: 'telegram',
                    },
                },
            });
        }
        return false;
    }
}
/**
 * Test Telegram bot connection
 */
async function testTelegramBot(chatId) {
    const bot = getTelegramBot();
    if (!bot) {
        return false;
    }
    try {
        await bot.sendMessage(chatId, '✅ *SpamRescue successfully connected!*\n\nYou will receive important email alerts in this chat.', {
            parse_mode: 'Markdown',
        });
        return true;
    }
    catch (error) {
        console.error('Telegram bot test failed:', error);
        return false;
    }
}
/**
 * Get Telegram bot info (for verification)
 */
async function getTelegramBotInfo() {
    const bot = getTelegramBot();
    if (!bot) {
        return null;
    }
    try {
        const info = await bot.getMe();
        return info;
    }
    catch (error) {
        console.error('Failed to get Telegram bot info:', error);
        return null;
    }
}
/**
 * Escape special characters for Telegram Markdown
 */
function escapeMarkdown(text) {
    // Escape special Markdown characters
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}
