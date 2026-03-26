"use strict";
/**
 * MFA (Multi-Factor Authentication) Routes
 * Endpoints for setting up and managing 2FA
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
exports.mfaRoutes = void 0;
const mfaService = __importStar(require("../../services/mfa.service"));
const prisma_1 = require("../../lib/prisma");
const password_service_1 = require("../../services/password.service");
const mfaRoutes = async (app) => {
    /**
     * Setup MFA - Generate secret and QR code
     * POST /api/mfa/setup
     */
    app.post('/setup', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user?.userId;
            if (!userId) {
                return reply.status(401).send({
                    success: false,
                    error: 'Unauthorized',
                });
            }
            // Get user email
            const user = await prisma_1.prisma.user.findUnique({
                where: { id: userId },
                select: { email: true, mfa_enabled: true },
            });
            if (!user) {
                return reply.status(404).send({
                    success: false,
                    error: 'User not found',
                });
            }
            if (user.mfa_enabled) {
                return reply.status(400).send({
                    success: false,
                    error: 'MFA is already enabled. Disable it first to set up again.',
                });
            }
            // Generate MFA secret and QR code
            const mfaSetup = await mfaService.generateMFASecret(userId, user.email);
            return reply.status(200).send({
                success: true,
                data: {
                    qrCode: mfaSetup.qrCodeUrl,
                    secret: mfaSetup.manualEntryKey,
                    backupCodes: mfaSetup.backupCodes,
                },
            });
        }
        catch (error) {
            app.log.error('MFA setup error:', error);
            return reply.status(500).send({
                success: false,
                error: error.message || 'Failed to set up MFA',
            });
        }
    });
    /**
     * Verify and enable MFA
     * POST /api/mfa/verify
     */
    app.post('/verify', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user?.userId;
            const { token } = request.body;
            if (!userId) {
                return reply.status(401).send({
                    success: false,
                    error: 'Unauthorized',
                });
            }
            if (!token || token.length !== 6) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid token format. Must be 6 digits.',
                });
            }
            // Verify token and enable MFA
            const verified = await mfaService.verifyMFASetup(userId, token);
            if (!verified) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid verification code. Please try again.',
                });
            }
            return reply.status(200).send({
                success: true,
                message: 'MFA enabled successfully',
            });
        }
        catch (error) {
            app.log.error('MFA verification error:', error);
            return reply.status(500).send({
                success: false,
                error: error.message || 'Failed to verify MFA',
            });
        }
    });
    /**
     * Disable MFA (requires password)
     * POST /api/mfa/disable
     */
    app.post('/disable', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user?.userId;
            const { password } = request.body;
            if (!userId) {
                return reply.status(401).send({
                    success: false,
                    error: 'Unauthorized',
                });
            }
            if (!password) {
                return reply.status(400).send({
                    success: false,
                    error: 'Password required to disable MFA',
                });
            }
            // Verify password
            const user = await prisma_1.prisma.user.findUnique({
                where: { id: userId },
                select: { password_hash: true, mfa_enabled: true },
            });
            if (!user) {
                return reply.status(404).send({
                    success: false,
                    error: 'User not found',
                });
            }
            const passwordValid = await password_service_1.passwordService.comparePassword(password, user.password_hash);
            if (!passwordValid) {
                return reply.status(401).send({
                    success: false,
                    error: 'Invalid password',
                });
            }
            if (!user.mfa_enabled) {
                return reply.status(400).send({
                    success: false,
                    error: 'MFA is not enabled',
                });
            }
            // Disable MFA
            await mfaService.disableMFA(userId);
            return reply.status(200).send({
                success: true,
                message: 'MFA disabled successfully',
            });
        }
        catch (error) {
            app.log.error('MFA disable error:', error);
            return reply.status(500).send({
                success: false,
                error: error.message || 'Failed to disable MFA',
            });
        }
    });
    /**
     * Get MFA status
     * GET /api/mfa/status
     */
    app.get('/status', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user?.userId;
            if (!userId) {
                return reply.status(401).send({
                    success: false,
                    error: 'Unauthorized',
                });
            }
            const enabled = await mfaService.isMFAEnabled(userId);
            return reply.status(200).send({
                success: true,
                data: {
                    enabled,
                },
            });
        }
        catch (error) {
            app.log.error('MFA status error:', error);
            return reply.status(500).send({
                success: false,
                error: 'Failed to get MFA status',
            });
        }
    });
    /**
     * Regenerate backup codes
     * POST /api/mfa/backup-codes
     */
    app.post('/backup-codes', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user?.userId;
            const { token } = request.body;
            if (!userId) {
                return reply.status(401).send({
                    success: false,
                    error: 'Unauthorized',
                });
            }
            // Verify current MFA token before generating new backup codes
            const verification = await mfaService.verifyMFALogin(userId, token);
            if (!verification.valid) {
                return reply.status(401).send({
                    success: false,
                    error: 'Invalid MFA token',
                });
            }
            const backupCodes = await mfaService.regenerateBackupCodes(userId);
            return reply.status(200).send({
                success: true,
                data: {
                    backupCodes,
                },
            });
        }
        catch (error) {
            app.log.error('Backup codes generation error:', error);
            return reply.status(500).send({
                success: false,
                error: 'Failed to generate backup codes',
            });
        }
    });
};
exports.mfaRoutes = mfaRoutes;
