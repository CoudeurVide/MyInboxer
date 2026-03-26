"use strict";
/**
 * Security Event Logging Service
 * Logs authentication events, account changes, and suspicious activity
 * for CASA/ASVS compliance (audit trail).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.logSecurityEvent = logSecurityEvent;
const prisma_1 = require("../lib/prisma");
/**
 * Log a security event to the audit_logs table
 */
async function logSecurityEvent(params) {
    const { eventType, userId, ipAddress, userAgent, details, status = 'success' } = params;
    try {
        await prisma_1.prisma.auditLog.create({
            data: {
                user_id: userId || null,
                action: eventType,
                resource: 'security',
                resource_id: userId || null,
                details: details ? JSON.parse(JSON.stringify(details)) : undefined,
                ip_address: ipAddress,
                user_agent: userAgent,
                status,
            },
        });
    }
    catch (error) {
        // Never let audit logging failures break the app
        console.error('[SecurityEvent] Failed to log event:', eventType, error);
    }
}
