"use strict";
/**
 * Mailbox Schedule Routes
 * Endpoints for managing automated scan schedules
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const zod_1 = require("zod");
const node_cron_1 = __importDefault(require("node-cron"));
const cron_service_1 = require("../../services/cron.service");
const prisma_1 = require("../../lib/prisma");
// Validation schemas
const SetScheduleSchema = zod_1.z.object({
    schedule: zod_1.z.string().nullable(),
    notificationEnabled: zod_1.z.boolean().optional(),
    notificationChannels: zod_1.z.array(zod_1.z.enum(['email', 'slack', 'telegram', 'sms'])).optional(),
    monitoredFolders: zod_1.z.array(zod_1.z.enum(['spam', 'promotions', 'updates', 'social', 'forums', 'all'])).optional(),
    autoMoveOnClassify: zod_1.z.boolean().optional(),
});
const scheduleRoutes = async (fastify) => {
    /**
     * GET /api/mailboxes/:mailboxId/schedule
     * Get current scan schedule for a mailbox
     */
    fastify.get('/:mailboxId/schedule', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        const { mailboxId } = request.params;
        const userId = request.user?.userId;
        if (!userId) {
            return reply.status(401).send({
                success: false,
                error: 'Authentication required',
            });
        }
        const mailbox = await prisma_1.prisma.mailbox.findFirst({
            where: {
                id: mailboxId,
                user_id: userId,
            },
            select: {
                id: true,
                email_address: true,
                scan_schedule: true,
                notification_enabled: true,
                notification_channels: true,
                monitored_folders: true,
                auto_move_on_classify: true,
                last_scan_at: true,
            },
        });
        if (!mailbox) {
            return reply.status(404).send({
                success: false,
                error: 'Mailbox not found',
            });
        }
        return reply.send({
            success: true,
            data: {
                mailboxId: mailbox.id,
                email: mailbox.email_address,
                schedule: mailbox.scan_schedule,
                notificationEnabled: mailbox.notification_enabled,
                notificationChannels: mailbox.notification_channels,
                monitoredFolders: mailbox.monitored_folders,
                autoMoveOnClassify: mailbox.auto_move_on_classify,
                lastScannedAt: mailbox.last_scan_at,
            },
        });
    });
    /**
     * PUT /api/mailboxes/:mailboxId/schedule
     * Update scan schedule for a mailbox
     */
    fastify.put('/:mailboxId/schedule', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        const { mailboxId } = request.params;
        const userId = request.user?.userId;
        if (!userId) {
            return reply.status(401).send({
                success: false,
                error: 'Authentication required',
            });
        }
        // Validate body
        const validation = SetScheduleSchema.safeParse(request.body);
        if (!validation.success) {
            return reply.status(400).send({
                success: false,
                error: 'Invalid request body',
                details: validation.error.issues,
            });
        }
        const { schedule, notificationEnabled, notificationChannels, monitoredFolders, autoMoveOnClassify } = validation.data;
        // Verify mailbox ownership
        const mailbox = await prisma_1.prisma.mailbox.findFirst({
            where: {
                id: mailboxId,
                user_id: userId,
            },
            select: {
                id: true,
                scan_schedule: true,
                notification_enabled: true,
                notification_channels: true,
                monitored_folders: true,
                auto_move_on_classify: true,
            },
        });
        if (!mailbox) {
            return reply.status(404).send({
                success: false,
                error: 'Mailbox not found',
            });
        }
        // Validate cron expression if provided
        if (schedule) {
            if (!node_cron_1.default.validate(schedule)) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid cron expression',
                    message: 'Schedule must be a valid cron expression (e.g., "0 */6 * * *" for every 6 hours)',
                });
            }
        }
        // Cancel existing schedule
        (0, cron_service_1.cancelMailboxScans)(mailboxId);
        // Update database
        const updated = await prisma_1.prisma.mailbox.update({
            where: { id: mailboxId },
            data: {
                scan_schedule: schedule,
                notification_enabled: notificationEnabled !== undefined
                    ? notificationEnabled
                    : mailbox.notification_enabled,
                notification_channels: notificationChannels !== undefined
                    ? notificationChannels
                    : mailbox.notification_channels,
                monitored_folders: monitoredFolders !== undefined
                    ? monitoredFolders
                    : mailbox.monitored_folders,
                auto_move_on_classify: autoMoveOnClassify !== undefined
                    ? autoMoveOnClassify
                    : mailbox.auto_move_on_classify,
            },
            select: {
                id: true,
                email_address: true,
                scan_schedule: true,
                notification_enabled: true,
                notification_channels: true,
                monitored_folders: true,
                auto_move_on_classify: true,
                last_scan_at: true,
            },
        });
        // Schedule new job if schedule is set
        if (schedule) {
            try {
                (0, cron_service_1.scheduleScan)(mailboxId, userId, schedule);
            }
            catch (error) {
                return reply.status(500).send({
                    success: false,
                    error: 'Failed to schedule scan',
                    message: error.message,
                });
            }
        }
        return reply.send({
            success: true,
            message: schedule
                ? 'Scan schedule updated successfully'
                : 'Automatic scanning disabled',
            data: {
                mailboxId: updated.id,
                email: updated.email_address,
                schedule: updated.scan_schedule,
                notificationEnabled: updated.notification_enabled,
                notificationChannels: updated.notification_channels,
                monitoredFolders: updated.monitored_folders,
                autoMoveOnClassify: updated.auto_move_on_classify,
                lastScannedAt: updated.last_scan_at,
            },
        });
    });
    /**
     * DELETE /api/mailboxes/:mailboxId/schedule
     * Disable automatic scanning for a mailbox
     */
    fastify.delete('/:mailboxId/schedule', {
        onRequest: [fastify.authenticate],
    }, async (request, reply) => {
        const { mailboxId } = request.params;
        const userId = request.user?.userId;
        if (!userId) {
            return reply.status(401).send({
                success: false,
                error: 'Authentication required',
            });
        }
        // Verify mailbox ownership
        const mailbox = await prisma_1.prisma.mailbox.findFirst({
            where: {
                id: mailboxId,
                user_id: userId,
            },
        });
        if (!mailbox) {
            return reply.status(404).send({
                success: false,
                error: 'Mailbox not found',
            });
        }
        // Cancel schedule
        (0, cron_service_1.cancelMailboxScans)(mailboxId);
        // Update database
        await prisma_1.prisma.mailbox.update({
            where: { id: mailboxId },
            data: {
                scan_schedule: null,
            },
        });
        return reply.send({
            success: true,
            message: 'Automatic scanning disabled',
        });
    });
    /**
     * GET /api/mailboxes/:mailboxId/schedule/presets
     * Get common cron schedule presets
     */
    fastify.get('/:mailboxId/schedule/presets', async (request, reply) => {
        return reply.send({
            success: true,
            data: {
                presets: [
                    {
                        label: 'Every hour',
                        value: '0 * * * *',
                        description: 'Scan every hour on the hour',
                    },
                    {
                        label: 'Every 3 hours',
                        value: '0 */3 * * *',
                        description: 'Scan every 3 hours',
                    },
                    {
                        label: 'Every 6 hours',
                        value: '0 */6 * * *',
                        description: 'Scan every 6 hours (recommended)',
                    },
                    {
                        label: 'Every 12 hours',
                        value: '0 */12 * * *',
                        description: 'Scan twice daily',
                    },
                    {
                        label: 'Once daily (9 AM)',
                        value: '0 9 * * *',
                        description: 'Scan once per day at 9:00 AM',
                    },
                    {
                        label: 'Once daily (6 PM)',
                        value: '0 18 * * *',
                        description: 'Scan once per day at 6:00 PM',
                    },
                    {
                        label: 'Weekdays only (9 AM)',
                        value: '0 9 * * 1-5',
                        description: 'Scan Monday-Friday at 9:00 AM',
                    },
                    {
                        label: 'Weekly (Monday 9 AM)',
                        value: '0 9 * * 1',
                        description: 'Scan once per week on Mondays',
                    },
                ],
            },
        });
    });
};
exports.default = scheduleRoutes;
