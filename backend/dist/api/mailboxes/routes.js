"use strict";
/**
 * Mailbox Routes
 * Manage connected email accounts
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
exports.mailboxRoutes = void 0;
const mailboxService = __importStar(require("../../services/mailbox.service"));
const security_event_service_1 = require("../../services/security-event.service");
const mailboxRoutes = async (app) => {
    /**
     * List user's mailboxes
     * GET /api/mailboxes
     */
    app.get('/', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user?.userId;
            if (!userId || typeof userId !== 'string') {
                return reply.status(401).send({
                    success: false,
                    error: {
                        code: 'UNAUTHORIZED',
                        message: 'User not authenticated',
                    },
                });
            }
            const mailboxes = await mailboxService.getUserMailboxes(userId);
            // Transform snake_case to camelCase for API response
            const transformedMailboxes = mailboxes.map((m) => ({
                id: m.id,
                provider: m.provider,
                email: m.email_address,
                status: m.status,
                lastSyncAt: m.last_scan_at,
                last_scan_at: m.last_scan_at, // Keep for backwards compatibility
                scan_schedule: m.scan_schedule,
                createdAt: m.created_at,
                auto_move_on_classify: m.auto_move_on_classify || false,
            }));
            return reply.status(200).send({
                success: true,
                data: {
                    mailboxes: transformedMailboxes,
                },
            });
        }
        catch (error) {
            app.log.error('Get mailboxes error:', error);
            throw error;
        }
    });
    /**
     * Get mailbox by ID
     * GET /api/mailboxes/:id
     */
    app.get('/:id', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user?.userId;
            const { id } = request.params;
            if (!userId) {
                return reply.status(401).send({
                    success: false,
                    error: {
                        code: 'UNAUTHORIZED',
                        message: 'User not authenticated',
                    },
                });
            }
            const mailbox = await mailboxService.getMailboxWithTokens(id, userId);
            // Don't return tokens to client
            const { accessToken, refreshToken, ...safeMailbox } = mailbox;
            return reply.status(200).send({
                success: true,
                data: {
                    mailbox: safeMailbox,
                },
            });
        }
        catch (error) {
            if (error.message === 'MAILBOX_NOT_FOUND') {
                return reply.status(404).send({
                    success: false,
                    error: {
                        code: 'MAILBOX_NOT_FOUND',
                        message: 'Mailbox not found',
                    },
                });
            }
            app.log.error('Get mailbox error:', error);
            throw error;
        }
    });
    /**
     * Update mailbox settings
     * PATCH /api/mailboxes/:id
     */
    app.patch('/:id', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user?.userId;
            const { id } = request.params;
            const body = request.body;
            if (!userId) {
                return reply.status(401).send({
                    success: false,
                    error: {
                        code: 'UNAUTHORIZED',
                        message: 'User not authenticated',
                    },
                });
            }
            // Update notification settings
            const updatedMailbox = await mailboxService.updateMailboxSettings(id, userId, {
                notificationEnabled: body.notification_enabled,
                notificationChannels: body.notification_channels,
                autoWhitelistEnabled: body.auto_whitelist_enabled,
                autoMoveOnClassify: body.auto_move_on_classify,
                monitoredFolders: body.monitored_folders,
            });
            return reply.status(200).send({
                success: true,
                data: {
                    mailbox: updatedMailbox,
                    message: 'Mailbox settings updated successfully',
                },
            });
        }
        catch (error) {
            if (error.message === 'MAILBOX_NOT_FOUND') {
                return reply.status(404).send({
                    success: false,
                    error: {
                        code: 'MAILBOX_NOT_FOUND',
                        message: 'Mailbox not found',
                    },
                });
            }
            app.log.error('Update mailbox error:', error);
            throw error;
        }
    });
    /**
     * Delete mailbox
     * DELETE /api/mailboxes/:id
     */
    app.delete('/:id', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user?.userId;
            const { id } = request.params;
            if (!userId) {
                return reply.status(401).send({
                    success: false,
                    error: {
                        code: 'UNAUTHORIZED',
                        message: 'User not authenticated',
                    },
                });
            }
            await mailboxService.deleteMailbox(id, userId);
            // Log security event for mailbox disconnection
            await (0, security_event_service_1.logSecurityEvent)({
                eventType: 'mailbox_disconnected',
                userId,
                ipAddress: request.ip,
                userAgent: request.headers['user-agent'] || '',
                details: { mailboxId: id },
            });
            return reply.status(200).send({
                success: true,
                data: {
                    message: 'Mailbox deleted successfully',
                },
            });
        }
        catch (error) {
            app.log.error('Delete mailbox error:', error);
            throw error;
        }
    });
};
exports.mailboxRoutes = mailboxRoutes;
