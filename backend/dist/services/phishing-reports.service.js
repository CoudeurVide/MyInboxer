"use strict";
/**
 * Phishing Reports Service
 * Community-driven phishing detection database
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportPhishingEmail = reportPhishingEmail;
exports.checkEmailPhishing = checkEmailPhishing;
exports.getPhishingStatistics = getPhishingStatistics;
exports.verifyPhishingReport = verifyPhishingReport;
exports.markAsFalsePositive = markAsFalsePositive;
exports.getPhishingReportsByType = getPhishingReportsByType;
exports.getTopPhishingDomains = getTopPhishingDomains;
exports.bulkReportPhishing = bulkReportPhishing;
const prisma_1 = require("../lib/prisma");
const redis_1 = require("../lib/redis");
const crypto = __importStar(require("crypto"));
/**
 * Report a phishing email
 */
async function reportPhishingEmail(userId, emailData, phishingType, confidence = 0.5 // Default confidence
) {
    // Calculate body hash
    const bodyHash = crypto.createHash('sha256').update(emailData.body).digest('hex');
    // Check if similar report already exists (same sender + subject hash)
    const existingReport = await prisma_1.prisma.phishingReport.findFirst({
        where: {
            sender_email: emailData.senderEmail.toLowerCase(),
            subject: emailData.subject,
            status: 'pending', // Only consider pending reports
        },
    });
    const report = await prisma_1.prisma.phishingReport.upsert({
        where: {
            id: existingReport?.id || 'temp', // Will be ignored in create
        },
        update: {
            verified_count: {
                increment: 1, // Increment count if already reported
            },
            reported_at: new Date(),
        },
        create: {
            reported_by: userId,
            sender_email: emailData.senderEmail.toLowerCase(),
            subject: emailData.subject,
            body_hash: bodyHash,
            phishing_type: phishingType,
            confidence,
            verified_count: 1,
            urls: emailData.urls,
            is_verified: false,
            status: 'pending',
        },
    });
    // Check if this report should now be verified (3+ reports)
    let updatedReport = report;
    if (report.verified_count >= 3) {
        updatedReport = await prisma_1.prisma.phishingReport.update({
            where: { id: report.id },
            data: {
                is_verified: true,
                status: 'verified',
            },
        });
    }
    // Invalidate cache for this type of check
    await (0, redis_1.deleteFromCache)(redis_1.CacheKeys.phishingCheck(report.sender_email));
    await (0, redis_1.deleteFromCache)(redis_1.CacheKeys.phishingCheck(bodyHash));
    // Also invalidate global stats
    await (0, redis_1.deleteFromCache)(redis_1.CacheKeys.phishingStats);
    return {
        id: updatedReport.id,
        reportedBy: updatedReport.reported_by,
        senderEmail: updatedReport.sender_email,
        subject: updatedReport.subject,
        bodyHash: updatedReport.body_hash,
        phishingType: updatedReport.phishing_type,
        confidence: updatedReport.confidence,
        verifiedCount: updatedReport.verified_count,
        urls: updatedReport.urls,
        isVerified: updatedReport.is_verified,
        status: updatedReport.status,
        reportedAt: updatedReport.reported_at,
    };
}
/**
 * Check if an email matches known phishing patterns
 */
async function checkEmailPhishing(emailData) {
    const senderEmail = emailData.senderEmail.toLowerCase();
    const bodyHash = crypto.createHash('sha256').update(emailData.body).digest('hex');
    // Try cache first (15 minutes TTL)
    const cacheKey = `${senderEmail}:${bodyHash}`;
    const cached = await (0, redis_1.getFromCache)(redis_1.CacheKeys.phishingCheck(cacheKey));
    if (cached) {
        return cached;
    }
    // Check for reports matching the sender
    const senderMatches = await prisma_1.prisma.phishingReport.findMany({
        where: {
            sender_email: senderEmail,
            status: { in: ['pending', 'verified'] },
            OR: [
                { is_verified: true },
                { verified_count: { gte: 2 } }, // Close to verification
            ],
        },
    });
    // Check for reports matching the body hash
    const bodyMatches = await prisma_1.prisma.phishingReport.findMany({
        where: {
            body_hash: bodyHash,
            status: { in: ['pending', 'verified'] },
            OR: [
                { is_verified: true },
                { verified_count: { gte: 2 } },
            ],
        },
    });
    // Check for reports matching any of the URLs in a single query
    let urlMatches = [];
    if (emailData.urls.length > 0) {
        // Use a single query with OR conditions for all URLs
        const urlConditions = emailData.urls.map(url => ({
            urls: { has: url }
        }));
        urlMatches = await prisma_1.prisma.phishingReport.findMany({
            where: {
                AND: [
                    { status: { in: ['pending', 'verified'] } },
                    {
                        OR: [
                            { is_verified: true },
                            { verified_count: { gte: 2 } }
                        ]
                    },
                    {
                        OR: urlConditions
                    }
                ]
            },
        });
    }
    // Combine all matches
    const allMatches = [...senderMatches, ...bodyMatches, ...urlMatches];
    // Calculate aggregated confidence
    let totalConfidence = 0;
    let reportCount = 0;
    for (const match of allMatches) {
        totalConfidence += match.confidence;
        reportCount++;
    }
    const avgConfidence = reportCount > 0 ? totalConfidence / reportCount : 0;
    // Determine threat level based on confidence and report count
    let threatLevel = 'low';
    if (avgConfidence >= 0.8 && reportCount >= 3) {
        threatLevel = 'critical';
    }
    else if (avgConfidence >= 0.6 || reportCount >= 3) {
        threatLevel = 'high';
    }
    else if (avgConfidence >= 0.4 || reportCount >= 2) {
        threatLevel = 'medium';
    }
    // Prepare matched patterns
    const matchedPatterns = [
        ...senderMatches.map(r => ({
            pattern: {
                id: r.id,
                patternHash: r.body_hash,
                matchType: 'sender',
                confidence: r.confidence,
                reportCount: r.verified_count,
                firstSeen: r.reported_at,
                lastSeen: r.reported_at
            },
            matchType: 'sender'
        })),
        ...bodyMatches.map(r => ({
            pattern: {
                id: r.id,
                patternHash: r.body_hash,
                matchType: 'body',
                confidence: r.confidence,
                reportCount: r.verified_count,
                firstSeen: r.reported_at,
                lastSeen: r.reported_at
            },
            matchType: 'body'
        })),
    ];
    const result = {
        isPhishing: reportCount > 0 && avgConfidence > 0.3,
        confidence: avgConfidence,
        matchedPatterns,
        reportCount,
        relatedReports: allMatches.map(r => ({
            id: r.id,
            reportedBy: r.reported_by,
            senderEmail: r.sender_email,
            subject: r.subject,
            bodyHash: r.body_hash,
            phishingType: r.phishing_type,
            confidence: r.confidence,
            verifiedCount: r.verified_count,
            urls: r.urls,
            isVerified: r.is_verified,
            status: r.status,
            reportedAt: r.reported_at,
        })),
        threatLevel,
    };
    // Cache for 15 minutes
    await (0, redis_1.setInCache)(redis_1.CacheKeys.phishingCheck(cacheKey), result, 900);
    return result;
}
/**
 * Get phishing statistics
 */
async function getPhishingStatistics() {
    // Try cache first (1 hour TTL)
    const cached = await (0, redis_1.getFromCache)(redis_1.CacheKeys.phishingStats);
    if (cached) {
        return cached;
    }
    // Get counts
    const [totalReports, verifiedReports, falsePositives] = await Promise.all([
        prisma_1.prisma.phishingReport.count({
            where: { status: { in: ['pending', 'verified'] } }
        }),
        prisma_1.prisma.phishingReport.count({
            where: { status: 'verified' }
        }),
        prisma_1.prisma.phishingReport.count({
            where: { status: 'false_positive' }
        }),
    ]);
    // Get weekly trends (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const weeklyReports = await prisma_1.prisma.phishingReport.groupBy({
        by: ['reported_at'],
        where: {
            reported_at: {
                gte: sevenDaysAgo
            }
        },
        _count: true,
    });
    // Format daily trends
    const dailyMap = new Map();
    const currentDate = new Date(sevenDaysAgo);
    // Initialize all dates in the period
    while (currentDate <= new Date()) {
        const dateStr = currentDate.toISOString().split('T')[0];
        dailyMap.set(dateStr, { reports: 0, verified: 0 });
        currentDate.setDate(currentDate.getDate() + 1);
    }
    // Fill in actual data
    for (const report of weeklyReports) {
        const dateStr = report.reported_at.toISOString().split('T')[0];
        const existing = dailyMap.get(dateStr) || { reports: 0, verified: 0 };
        existing.reports = report._count || 0;
        dailyMap.set(dateStr, existing);
    }
    // Get verified counts separately to add to daily data
    const verifiedDaily = await prisma_1.prisma.phishingReport.groupBy({
        by: ['reported_at'],
        where: {
            reported_at: {
                gte: sevenDaysAgo
            },
            status: 'verified'
        },
        _count: true,
    });
    for (const report of verifiedDaily) {
        const dateStr = report.reported_at.toISOString().split('T')[0];
        const existing = dailyMap.get(dateStr);
        if (existing) {
            existing.verified = report._count || 0;
        }
    }
    const weeklyTrends = Array.from(dailyMap.entries()).map(([date, data]) => ({
        date,
        reports: data.reports,
        verified: data.verified,
    }));
    const result = {
        totalReports,
        verifiedReports,
        falsePositives,
        weeklyTrends,
    };
    // Cache for 1 hour
    await (0, redis_1.setInCache)(redis_1.CacheKeys.phishingStats(), result, 3600);
    return result;
}
/**
 * Mark a phishing report as verified
 */
async function verifyPhishingReport(reportId, verifiedByUserId) {
    const report = await prisma_1.prisma.phishingReport.update({
        where: { id: reportId },
        data: {
            is_verified: true,
            status: 'verified',
            verified_by: verifiedByUserId,
        },
    });
    // Invalidate related caches
    await (0, redis_1.deleteFromCache)(redis_1.CacheKeys.phishingCheck(report.sender_email));
    await (0, redis_1.deleteFromCache)(redis_1.CacheKeys.phishingCheck(report.body_hash));
    await (0, redis_1.deleteFromCache)(redis_1.CacheKeys.phishingStats);
    return {
        id: report.id,
        reportedBy: report.reported_by,
        senderEmail: report.sender_email,
        subject: report.subject,
        bodyHash: report.body_hash,
        phishingType: report.phishing_type,
        confidence: report.confidence,
        verifiedCount: report.verified_count,
        urls: report.urls,
        isVerified: report.is_verified,
        status: report.status,
        reportedAt: report.reported_at,
    };
}
/**
 * Mark a phishing report as false positive
 */
async function markAsFalsePositive(reportId, markedByUserId) {
    const report = await prisma_1.prisma.phishingReport.update({
        where: { id: reportId },
        data: {
            status: 'false_positive',
            verified_by: markedByUserId,
        },
    });
    // Invalidate related caches
    await (0, redis_1.deleteFromCache)(redis_1.CacheKeys.phishingCheck(report.sender_email));
    await (0, redis_1.deleteFromCache)(redis_1.CacheKeys.phishingCheck(report.body_hash));
    await (0, redis_1.deleteFromCache)(redis_1.CacheKeys.phishingStats);
    return {
        id: report.id,
        reportedBy: report.reported_by,
        senderEmail: report.sender_email,
        subject: report.subject,
        bodyHash: report.body_hash,
        phishingType: report.phishing_type,
        confidence: report.confidence,
        verifiedCount: report.verified_count,
        urls: report.urls,
        isVerified: report.is_verified,
        status: report.status,
        reportedAt: report.reported_at,
    };
}
/**
 * Get reports by phishing type
 */
async function getPhishingReportsByType(phishingType) {
    const reports = await prisma_1.prisma.phishingReport.findMany({
        where: {
            phishing_type: phishingType,
            status: { in: ['pending', 'verified'] },
        },
        orderBy: {
            reported_at: 'desc',
        },
        take: 100, // Limit to last 100 reports
    });
    return reports.map(report => ({
        id: report.id,
        reportedBy: report.reported_by,
        senderEmail: report.sender_email,
        subject: report.subject,
        bodyHash: report.body_hash,
        phishingType: report.phishing_type,
        confidence: report.confidence,
        verifiedCount: report.verified_count,
        urls: report.urls,
        isVerified: report.is_verified,
        status: report.status,
        reportedAt: report.reported_at,
    }));
}
/**
 * Get top phishing domains
 */
async function getTopPhishingDomains(limit = 10) {
    // Get the most reported domains
    const domainCounts = await prisma_1.prisma.phishingReport.groupBy({
        by: ['sender_email'],
        where: {
            status: { in: ['pending', 'verified'] },
        },
        _count: {
            sender_email: true,
        },
        orderBy: {
            _count: {
                sender_email: 'desc',
            },
        },
        take: limit,
    });
    return domainCounts.map(dc => ({
        domain: dc.sender_email,
        count: dc._count.sender_email,
    }));
}
/**
 * Bulk report phishing emails
 */
async function bulkReportPhishing(userId, reports) {
    let successful = 0;
    let failed = 0;
    const errors = [];
    for (const report of reports) {
        try {
            await reportPhishingEmail(userId, {
                senderEmail: report.senderEmail,
                subject: report.subject,
                body: report.body,
                urls: report.urls,
            }, report.phishingType, report.confidence || 0.5);
            successful++;
        }
        catch (error) {
            failed++;
            errors.push(`Failed to report email from ${report.senderEmail}: ${error.message}`);
        }
    }
    // Invalidate global stats cache
    await (0, redis_1.deleteFromCache)(redis_1.CacheKeys.phishingStats);
    return { successful, failed, errors };
}
