"use strict";
/**
 * User Classification Preferences Routes
 * Allows users to configure their classification preferences
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
exports.classificationPreferencesRoutes = void 0;
const preferencesService = __importStar(require("../../services/user-classification-preferences.service"));
const classificationPreferencesRoutes = async (app) => {
    /**
     * Get current user's classification preferences
     * GET /api/classification/preferences
     */
    app.get('/', {
        onRequest: [app.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user?.userId;
            if (!userId) {
                return reply.status(401).send({
                    success: false,
                    error: {
                        code: 'UNAUTHORIZED',
                        message: 'User not authenticated',
                    },
                });
            }
            const preferences = await preferencesService.getUserPreferences(userId);
            return reply.status(200).send({
                success: true,
                data: {
                    preferences,
                },
            });
        }
        catch (error) {
            app.log.error('Get user preferences error:', error);
            return reply.status(500).send({
                success: false,
                error: {
                    code: 'INTERNAL_SERVER_ERROR',
                    message: 'Failed to fetch preferences',
                },
            });
        }
    });
    /**
     * Update current user's classification preferences
     * PUT /api/classification/preferences
     */
    app.put('/', {
        onRequest: [app.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user?.userId;
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
            // Validate input
            const updates = {};
            if (body.strictness_level) {
                if (!['lenient', 'balanced', 'strict'].includes(body.strictness_level)) {
                    return reply.status(400).send({
                        success: false,
                        error: {
                            code: 'INVALID_INPUT',
                            message: 'strictness_level must be lenient, balanced, or strict',
                        },
                    });
                }
                updates.strictness_level = body.strictness_level;
            }
            if (body.ai_aggressiveness) {
                if (!['conservative', 'balanced', 'aggressive'].includes(body.ai_aggressiveness)) {
                    return reply.status(400).send({
                        success: false,
                        error: {
                            code: 'INVALID_INPUT',
                            message: 'ai_aggressiveness must be conservative, balanced, or aggressive',
                        },
                    });
                }
                updates.ai_aggressiveness = body.ai_aggressiveness;
            }
            if (body.whitelisted_domains !== undefined) {
                if (!Array.isArray(body.whitelisted_domains)) {
                    return reply.status(400).send({
                        success: false,
                        error: {
                            code: 'INVALID_INPUT',
                            message: 'whitelisted_domains must be an array',
                        },
                    });
                }
                updates.whitelisted_domains = body.whitelisted_domains;
            }
            if (body.blacklisted_domains !== undefined) {
                if (!Array.isArray(body.blacklisted_domains)) {
                    return reply.status(400).send({
                        success: false,
                        error: {
                            code: 'INVALID_INPUT',
                            message: 'blacklisted_domains must be an array',
                        },
                    });
                }
                updates.blacklisted_domains = body.blacklisted_domains;
            }
            const preferences = await preferencesService.updateUserPreferences(userId, updates);
            return reply.status(200).send({
                success: true,
                data: {
                    preferences,
                    message: 'Preferences updated successfully',
                },
            });
        }
        catch (error) {
            app.log.error('Update user preferences error:', error);
            return reply.status(500).send({
                success: false,
                error: {
                    code: 'INTERNAL_SERVER_ERROR',
                    message: 'Failed to update preferences',
                },
            });
        }
    });
    /**
     * Reset current user's preferences to defaults
     * POST /api/classification/preferences/reset
     */
    app.post('/reset', {
        onRequest: [app.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user?.userId;
            if (!userId) {
                return reply.status(401).send({
                    success: false,
                    error: {
                        code: 'UNAUTHORIZED',
                        message: 'User not authenticated',
                    },
                });
            }
            const preferences = await preferencesService.resetUserPreferences(userId);
            return reply.status(200).send({
                success: true,
                data: {
                    preferences,
                    message: 'Preferences reset to defaults',
                },
            });
        }
        catch (error) {
            app.log.error('Reset user preferences error:', error);
            return reply.status(500).send({
                success: false,
                error: {
                    code: 'INTERNAL_SERVER_ERROR',
                    message: 'Failed to reset preferences',
                },
            });
        }
    });
};
exports.classificationPreferencesRoutes = classificationPreferencesRoutes;
