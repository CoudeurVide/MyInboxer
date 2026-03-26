"use strict";
/**
 * Admin Middleware for SpamRescue
 * Handles authentication and authorization for admin routes
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminAuthMiddleware = adminAuthMiddleware;
exports.adminActionLoggingMiddleware = adminActionLoggingMiddleware;
exports.adminMiddleware = adminMiddleware;
const prisma_1 = require("../lib/prisma");
const logger_1 = require("../lib/logger");
/**
 * Admin authentication middleware
 * Checks if the authenticated user has admin privileges
 */
async function adminAuthMiddleware(request, reply) {
    try {
        // Verify the user is authenticated first
        await request.jwtVerify();
        // Get the user info from the JWT
        const userId = request.user?.userId;
        if (!userId) {
            return reply.status(401).send({
                success: false,
                error: 'Authentication required',
            });
        }
        // Fetch the user from the database to verify their role
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: userId },
            select: { role: true, email: true }
        });
        if (!user) {
            return reply.status(401).send({
                success: false,
                error: 'User not found',
            });
        }
        // Check if the user has admin or owner privileges
        if (user.role !== 'admin' && user.role !== 'owner') {
            logger_1.logger.warn(`Unauthorized admin access attempt by user ${userId} (${user.email})`);
            return reply.status(403).send({
                success: false,
                error: {
                    code: 'FORBIDDEN',
                    message: 'Admin access required',
                },
            });
        }
        // Add admin-specific information to request object
        request.adminUser = {
            id: userId,
            role: user.role,
            email: user.email
        };
    }
    catch (error) {
        logger_1.logger.error('Admin middleware authentication failed:', error);
        return reply.status(401).send({
            success: false,
            error: {
                code: 'UNAUTHORIZED',
                message: 'Invalid or missing admin authentication token',
            },
        });
    }
}
/**
 * Admin action logging middleware
 * Logs all admin actions for auditing purposes
 */
async function adminActionLoggingMiddleware(request, reply) {
    // This middleware just sets up logging for after the request completes
    // We'll use Fastify's lifecycle hooks properly
    const startTime = Date.now();
    // Hook into the response finish event (reliable Node.js HTTP event)
    reply.raw.once('finish', () => {
        (async () => {
            try {
                const adminUser = request.adminUser;
                if (!adminUser) {
                    return; // Only log if we have admin user info
                }
                // Determine the action type based on the HTTP method and route
                let actionType = `${request.method} ${request.routerPath}`;
                if (request.routeConfig?.adminActionType) {
                    actionType = request.routeConfig.adminActionType;
                }
                // Get the IP address (considering proxy headers)
                const ipAddress = request.headers['x-forwarded-for'] ||
                    request.headers['x-real-ip'] ||
                    request.ip;
                // Get user agent
                const userAgent = request.headers['user-agent'] || 'unknown';
                // Log the admin action
                await prisma_1.prisma.adminAction.create({
                    data: {
                        admin_id: adminUser.id,
                        action_type: actionType,
                        target_user_id: request.params?.userId || request.body?.userId || null,
                        details: {
                            method: request.method,
                            url: request.url,
                            route: request.routerPath,
                            statusCode: reply.raw.statusCode,
                            responseTime: Date.now() - startTime,
                            requestBody: request.body ? JSON.stringify(request.body) : null,
                            userAgent,
                            ipAddress,
                        },
                        ip_address: ipAddress || 'unknown',
                    }
                });
                logger_1.logger.info(`Admin action logged: ${actionType} by admin ${adminUser.id}`);
            }
            catch (error) {
                logger_1.logger.error('Failed to log admin action:', error);
                // Don't throw error as it shouldn't affect the main request
            }
        })();
    });
}
/**
 * Predefined admin middleware combination
 * Combines authentication and logging
 */
async function adminMiddleware(request, reply) {
    // First run the auth middleware
    await adminAuthMiddleware(request, reply);
    // The logging is now handled as a separate middleware or via route-specific logic
}
