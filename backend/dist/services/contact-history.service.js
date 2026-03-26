"use strict";
/**
 * Contact History Service
 * Checks if sender is a known contact or has previous email history
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.checkContactHistory = checkContactHistory;
const prisma_1 = require("../lib/prisma");
/**
 * Check contact history for a sender
 *
 * @param senderEmail - Email address to check
 * @param userId - User ID
 * @returns Contact history with trust boost
 */
async function checkContactHistory(senderEmail, userId) {
    try {
        // Get all previous messages from this sender
        const previousMessages = await prisma_1.prisma.message.findMany({
            where: {
                sender_email: senderEmail,
                mailbox: {
                    user_id: userId,
                },
            },
            orderBy: {
                created_at: 'asc',
            },
            select: {
                id: true,
                created_at: true,
                user_verdict: true,
                verdict: true,
            },
        });
        if (previousMessages.length === 0) {
            // First-time sender - neutral
            return {
                isKnownContact: false,
                previousThreads: 0,
                userReplied: false,
                firstContactDate: null,
                trustBoost: 0,
                message: 'First-time sender - no history',
            };
        }
        // Check if user has marked sender as legit before
        const userMarkedNotSpam = previousMessages.some(msg => msg.user_verdict === 'legit');
        // Check if user has marked sender as spam before
        const userMarkedSpam = previousMessages.some(msg => msg.user_verdict === 'spam');
        // Automatic classification history
        const autoNotSpam = previousMessages.filter(msg => msg.verdict === 'legit' && !msg.user_verdict).length;
        const firstContactDate = previousMessages[0].created_at;
        // Calculate trust boost
        let trustBoost = 0;
        let message = '';
        if (userMarkedSpam) {
            // User previously marked this sender as spam = high penalty
            trustBoost = -0.3;
            message = `User previously marked sender as spam (${previousMessages.length} emails)`;
        }
        else if (userMarkedNotSpam) {
            // User confirmed lead = high boost
            trustBoost = 0.3;
            message = `Known contact: user confirmed lead (${previousMessages.length} emails)`;
        }
        else if (autoNotSpam >= 3) {
            // Multiple auto-classified lead = moderate boost
            trustBoost = 0.15;
            message = `Returning sender: ${autoNotSpam} previous lead emails`;
        }
        else if (previousMessages.length >= 3) {
            // Just message history = small boost
            trustBoost = 0.05;
            message = `Returning sender: ${previousMessages.length} previous emails`;
        }
        else {
            // One or two messages = minimal boost
            trustBoost = 0.02;
            message = 'Recent sender with limited history';
        }
        return {
            isKnownContact: userMarkedNotSpam || autoNotSpam >= 2,
            previousThreads: previousMessages.length,
            userReplied: userMarkedNotSpam, // Simplified (full impl would check actual replies)
            firstContactDate,
            trustBoost,
            message,
        };
    }
    catch (error) {
        console.error('[ContactHistory] Error checking history:', error.message);
        return {
            isKnownContact: false,
            previousThreads: 0,
            userReplied: false,
            firstContactDate: null,
            trustBoost: 0,
            message: 'Unable to check contact history',
        };
    }
}
