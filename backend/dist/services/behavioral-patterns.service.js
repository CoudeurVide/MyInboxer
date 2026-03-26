"use strict";
/**
 * Behavioral Pattern Analyzer Service
 * Phase 3D: Machine Learning Integration
 *
 * This service provides:
 * - User behavior pattern analysis
 * - Sender interaction patterns
 * - Temporal analysis (when users read/reply)
 * - Anomaly detection
 * - Engagement predictions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.behavioralPatternsService = void 0;
exports.analyzeUserBehavior = analyzeUserBehavior;
exports.detectEmailAnomalies = detectEmailAnomalies;
exports.predictUserEngagement = predictUserEngagement;
exports.getSenderBehaviorProfile = getSenderBehaviorProfile;
const prisma_1 = require("../lib/prisma");
const redis_1 = require("../lib/redis");
/**
 * Behavioral Patterns Service
 */
class BehavioralPatternsService {
    cacheTTL = 3600; // 1 hour
    /**
     * Analyze user behavioral patterns
     */
    async analyzeUserPatterns(userId) {
        // Try cache first
        const cacheKey = `behavioral-patterns:${userId}`;
        const cached = await (0, redis_1.getFromCache)(cacheKey);
        if (cached) {
            return cached;
        }
        // Get user's email history (last 90 days)
        const emailHistory = await this.getUserEmailHistory(userId, 90);
        const patterns = {
            userId,
            patterns: {
                preferredSenders: await this.analyzePreferredSenders(emailHistory),
                typicalSendTimes: this.analyzeTemporalPatterns(emailHistory, 'hour'),
                typicalDays: this.analyzeTemporalPatterns(emailHistory, 'day'),
                averageThreadLength: this.calculateAvgThreadLength(emailHistory),
                replyRate: this.calculateReplyRate(emailHistory),
                forwardRate: this.calculateForwardRate(emailHistory),
                commonKeywords: this.extractCommonKeywords(emailHistory),
                topDomains: this.extractTopDomains(emailHistory),
                averageBodyLength: this.calculateAvgBodyLength(emailHistory),
                preferredLanguage: 'en', // Simplified
            },
            lastUpdated: new Date(),
        };
        // Cache patterns
        await (0, redis_1.setInCache)(cacheKey, patterns, this.cacheTTL);
        console.log(`[BehavioralPatterns] Analyzed patterns for user ${userId}`);
        return patterns;
    }
    /**
     * Detect anomalies in email
     */
    async detectAnomalies(email, userId) {
        const patterns = await this.analyzeUserPatterns(userId);
        const factors = [];
        // Check sender anomaly
        const senderAnomaly = this.checkSenderAnomaly(email, patterns);
        if (senderAnomaly.severity > 0) {
            factors.push(senderAnomaly);
        }
        // Check temporal anomaly
        const timeAnomaly = this.checkTemporalAnomaly(email, patterns);
        if (timeAnomaly.severity > 0) {
            factors.push(timeAnomaly);
        }
        // Check content anomaly
        const contentAnomaly = this.checkContentAnomaly(email, patterns);
        if (contentAnomaly.severity > 0) {
            factors.push(contentAnomaly);
        }
        // Check domain anomaly
        const domainAnomaly = this.checkDomainAnomaly(email, patterns);
        if (domainAnomaly.severity > 0) {
            factors.push(domainAnomaly);
        }
        // Calculate overall anomaly score
        const score = factors.length > 0
            ? factors.reduce((sum, f) => sum + f.severity, 0) / factors.length
            : 0;
        const confidence = factors.length >= 2 ? 0.8 : factors.length === 1 ? 0.5 : 0.3;
        return {
            score,
            factors,
            isAnomalous: score > 0.7,
            confidence,
        };
    }
    /**
     * Predict user engagement
     */
    async predictEngagement(email, userId) {
        const patterns = await this.analyzeUserPatterns(userId);
        const senderProfile = await this.getSenderProfile(email.from, userId);
        const factors = [];
        // Base probabilities
        let willRead = 0.5;
        let willReply = 0.3;
        let willDelete = 0.2;
        // Adjust based on sender history
        if (senderProfile) {
            willRead += senderProfile.engagement * 0.3;
            willReply = senderProfile.replyRate;
            factors.push(`Known sender (${senderProfile.totalEmails} emails)`);
        }
        else {
            willDelete += 0.2; // New senders more likely to be deleted
            factors.push('New sender');
        }
        // Adjust based on temporal patterns
        const emailHour = email.date ? email.date.getHours() : new Date().getHours();
        const hourPattern = patterns.patterns.typicalSendTimes.find(t => t.hour === emailHour);
        if (hourPattern && hourPattern.frequency > 0.1) {
            willRead += 0.1;
            factors.push('Typical time');
        }
        else {
            willRead -= 0.1;
            factors.push('Unusual time');
        }
        // Adjust based on subject
        const hasUrgentSubject = email.subject?.match(/(urgent|asap|important)/i);
        if (hasUrgentSubject) {
            willRead += 0.15;
            willReply += 0.1;
            factors.push('Urgent subject');
        }
        // Normalize probabilities
        const total = willRead + willReply + willDelete;
        willRead /= total;
        willReply /= total;
        willDelete /= total;
        // Expected reply time
        const expectedReplyTime = senderProfile?.avgReplyTime || 480; // Default 8 hours
        return {
            willRead: Math.max(0, Math.min(1, willRead)),
            willReply: Math.max(0, Math.min(1, willReply)),
            willDelete: Math.max(0, Math.min(1, willDelete)),
            expectedReplyTime,
            confidence: senderProfile ? 0.8 : 0.4,
            factors,
        };
    }
    /**
     * Get sender profile
     */
    async getSenderProfile(senderEmail, userId) {
        try {
            // Query messages from the sender to build profile
            const messages = await prisma_1.prisma.message.findMany({
                where: {
                    sender_email: senderEmail.toLowerCase(),
                    mailbox: {
                        user_id: userId
                    }
                },
                orderBy: {
                    received_at: 'asc'
                },
                select: {
                    received_at: true,
                    verdict: true,
                    reviewed_at: true
                }
            });
            if (messages.length === 0) {
                return null;
            }
            const totalEmails = messages.length;
            const firstSeen = messages[0].received_at;
            const lastSeen = messages[messages.length - 1].received_at;
            const daysSinceFirst = (Date.now() - firstSeen.getTime()) / (1000 * 60 * 60 * 24);
            // Calculate reply rate based on reviewed messages
            const reviewedCount = messages.filter(m => m.reviewed_at !== null).length;
            const replyRate = totalEmails > 0 ? reviewedCount / totalEmails : 0;
            return {
                email: senderEmail,
                domain: senderEmail.split('@')[1] || '',
                totalEmails,
                firstSeen,
                lastSeen,
                frequency: daysSinceFirst > 0 ? (totalEmails / daysSinceFirst) * 7 : 0,
                replyRate,
                avgReplyTime: 480, // Default: 8 hours (placeholder since we don't track reply times yet)
                engagement: replyRate, // Use reply rate as engagement proxy
                categories: [], // Would be populated from classification history
            };
        }
        catch (error) {
            console.warn('[BehavioralPatterns] Failed to get sender profile:', error);
            return null;
        }
    }
    /**
     * Helper: Get user email history
     */
    async getUserEmailHistory(userId, days) {
        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - days);
        try {
            const messages = await prisma_1.prisma.message.findMany({
                where: {
                    mailbox: {
                        user_id: userId
                    },
                    received_at: {
                        gte: sinceDate
                    }
                },
                orderBy: {
                    received_at: 'desc'
                },
                select: {
                    sender_email: true,
                    received_at: true,
                    verdict: true,
                    reviewed_at: true,
                    body_text: true,
                    body_html: true
                }
            });
            // Convert to legacy format for compatibility
            return messages.map(msg => ({
                sender_email: msg.sender_email,
                received_date: msg.received_at,
                was_replied: msg.reviewed_at !== null,
                reply_time: msg.reviewed_at,
                engagement_score: msg.reviewed_at ? 1 : 0,
                text_body: msg.body_text,
                html_body: msg.body_html,
                thread_length: 1,
                was_forwarded: false
            }));
        }
        catch (error) {
            console.warn('[BehavioralPatterns] Failed to get user email history:', error);
            return [];
        }
    }
    /**
     * Helper: Analyze preferred senders
     */
    async analyzePreferredSenders(emailHistory) {
        const senderStats = new Map();
        emailHistory.forEach(email => {
            const sender = email.sender_email;
            const stats = senderStats.get(sender) || {
                count: 0,
                replies: 0,
                totalReplyTime: 0,
                engagement: [],
            };
            stats.count++;
            if (email.was_replied) {
                stats.replies++;
                if (email.reply_time) {
                    const replyMinutes = (new Date(email.reply_time).getTime() - new Date(email.received_date).getTime()) / (1000 * 60);
                    stats.totalReplyTime += replyMinutes;
                }
            }
            if (email.engagement_score) {
                stats.engagement.push(parseFloat(email.engagement_score));
            }
            senderStats.set(sender, stats);
        });
        // Convert to array and sort by frequency
        const senders = Array.from(senderStats.entries())
            .map(([email, stats]) => {
            const daysCovered = 90; // From history period
            const frequency = (stats.count / daysCovered) * 7; // Per week
            const replyRate = stats.count > 0 ? stats.replies / stats.count : 0;
            const avgReplyTime = stats.replies > 0 ? stats.totalReplyTime / stats.replies : 0;
            const engagement = stats.engagement.length > 0
                ? stats.engagement.reduce((sum, e) => sum + e, 0) / stats.engagement.length
                : 0;
            return {
                email,
                frequency,
                replyRate,
                avgReplyTime,
                engagement,
            };
        })
            .sort((a, b) => b.frequency - a.frequency)
            .slice(0, 20); // Top 20
        return senders;
    }
    /**
     * Helper: Analyze temporal patterns
     */
    analyzeTemporalPatterns(emailHistory, type) {
        const counts = new Map();
        emailHistory.forEach(email => {
            const date = new Date(email.received_date);
            const value = type === 'hour' ? date.getHours() : date.getDay();
            counts.set(value, (counts.get(value) || 0) + 1);
        });
        const total = emailHistory.length;
        const range = type === 'hour' ? 24 : 7;
        const patterns = [];
        for (let i = 0; i < range; i++) {
            const count = counts.get(i) || 0;
            const frequency = total > 0 ? count / total : 0;
            patterns.push({
                [type]: i,
                frequency,
            });
        }
        return patterns;
    }
    /**
     * Helper: Calculate average thread length
     */
    calculateAvgThreadLength(emailHistory) {
        const threadLengths = emailHistory
            .map(e => parseInt(e.thread_length || '1'))
            .filter(l => l > 0);
        return threadLengths.length > 0
            ? threadLengths.reduce((sum, l) => sum + l, 0) / threadLengths.length
            : 1;
    }
    /**
     * Helper: Calculate reply rate
     */
    calculateReplyRate(emailHistory) {
        const replies = emailHistory.filter(e => e.was_replied).length;
        return emailHistory.length > 0 ? replies / emailHistory.length : 0;
    }
    /**
     * Helper: Calculate forward rate
     */
    calculateForwardRate(emailHistory) {
        const forwards = emailHistory.filter(e => e.was_forwarded).length;
        return emailHistory.length > 0 ? forwards / emailHistory.length : 0;
    }
    /**
     * Helper: Extract common keywords
     */
    extractCommonKeywords(emailHistory) {
        const keywordCounts = new Map();
        emailHistory.forEach(email => {
            const body = (email.text_body || email.html_body || '').toLowerCase();
            const words = body
                .split(/\s+/)
                .filter(w => w.length > 4 && !this.isStopWord(w));
            words.forEach(word => {
                keywordCounts.set(word, (keywordCounts.get(word) || 0) + 1);
            });
        });
        return Array.from(keywordCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 50)
            .map(([word]) => word);
    }
    /**
     * Helper: Extract top domains
     */
    extractTopDomains(emailHistory) {
        const domainCounts = new Map();
        emailHistory.forEach(email => {
            const domain = email.sender_email?.split('@')[1];
            if (domain) {
                domainCounts.set(domain, (domainCounts.get(domain) || 0) + 1);
            }
        });
        return Array.from(domainCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 20)
            .map(([domain]) => domain);
    }
    /**
     * Helper: Calculate average body length
     */
    calculateAvgBodyLength(emailHistory) {
        const lengths = emailHistory
            .map(e => (e.text_body || e.html_body || '').length)
            .filter(l => l > 0);
        return lengths.length > 0
            ? lengths.reduce((sum, l) => sum + l, 0) / lengths.length
            : 0;
    }
    /**
     * Helper: Check sender anomaly
     */
    checkSenderAnomaly(email, patterns) {
        const isKnownSender = patterns.patterns.preferredSenders.some(s => s.email === email.from);
        if (!isKnownSender) {
            return {
                factor: 'unknown_sender',
                severity: 0.6,
                description: 'Email from unknown sender',
            };
        }
        return {
            factor: 'known_sender',
            severity: 0,
            description: 'Email from known sender',
        };
    }
    /**
     * Helper: Check temporal anomaly
     */
    checkTemporalAnomaly(email, patterns) {
        const emailHour = email.date ? email.date.getHours() : new Date().getHours();
        const hourPattern = patterns.patterns.typicalSendTimes.find(t => t.hour === emailHour);
        if (!hourPattern || hourPattern.frequency < 0.05) {
            return {
                factor: 'unusual_time',
                severity: 0.5,
                description: `Email received at unusual hour (${emailHour}:00)`,
            };
        }
        return {
            factor: 'typical_time',
            severity: 0,
            description: 'Email received at typical time',
        };
    }
    /**
     * Helper: Check content anomaly
     */
    checkContentAnomaly(email, patterns) {
        const bodyLength = (email.bodyText || email.bodyHtml || '').length;
        const avgLength = patterns.patterns.averageBodyLength;
        // Check if body length is significantly different
        if (avgLength > 0 && (bodyLength < avgLength * 0.3 || bodyLength > avgLength * 3)) {
            return {
                factor: 'unusual_length',
                severity: 0.4,
                description: `Email length (${bodyLength}) differs significantly from average (${Math.round(avgLength)})`,
            };
        }
        return {
            factor: 'typical_length',
            severity: 0,
            description: 'Email length is typical',
        };
    }
    /**
     * Helper: Check domain anomaly
     */
    checkDomainAnomaly(email, patterns) {
        const domain = email.from.split('@')[1] || '';
        const isKnownDomain = patterns.patterns.topDomains.includes(domain);
        if (!isKnownDomain) {
            return {
                factor: 'unknown_domain',
                severity: 0.5,
                description: `Email from unknown domain (${domain})`,
            };
        }
        return {
            factor: 'known_domain',
            severity: 0,
            description: 'Email from known domain',
        };
    }
    /**
     * Helper: Check if word is stop word
     */
    isStopWord(word) {
        const stopWords = ['the', 'is', 'at', 'which', 'on', 'and', 'or', 'but', 'for', 'from', 'with', 'this', 'that', 'these', 'those'];
        return stopWords.includes(word.toLowerCase());
    }
}
// Export singleton instance
exports.behavioralPatternsService = new BehavioralPatternsService();
/**
 * Main exports
 */
async function analyzeUserBehavior(userId) {
    return exports.behavioralPatternsService.analyzeUserPatterns(userId);
}
async function detectEmailAnomalies(email, userId) {
    return exports.behavioralPatternsService.detectAnomalies(email, userId);
}
async function predictUserEngagement(email, userId) {
    return exports.behavioralPatternsService.predictEngagement(email, userId);
}
async function getSenderBehaviorProfile(senderEmail, userId) {
    return exports.behavioralPatternsService.getSenderProfile(senderEmail, userId);
}
