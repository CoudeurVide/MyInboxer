"use strict";
/**
 * Admin Email Templates Routes
 * Manage email templates - CRUD operations
 * Restricted to admin users only
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
exports.emailTemplatesRoutes = void 0;
const emailTemplateService = __importStar(require("../../services/email-template.service"));
const admin_middleware_1 = require("../../middleware/admin.middleware");
const emailTemplatesRoutes = async (app) => {
    /**
     * Clear template cache
     * POST /api/admin/email-templates/cache/clear
     * IMPORTANT: This must be registered BEFORE /:key routes
     */
    app.post('/cache/clear', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            emailTemplateService.clearTemplateCache();
            return reply.status(200).send({
                success: true,
                data: {
                    message: 'Template cache cleared successfully',
                },
            });
        }
        catch (error) {
            app.log.error(`Clear template cache error: ${error?.message || error}`);
            throw error;
        }
    });
    /**
     * Get template preview with sample data
     * POST /api/admin/email-templates/:key/preview
     * IMPORTANT: Must come BEFORE /:key GET route
     */
    app.post('/:key/preview', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const { key } = request.params;
            const body = request.body;
            const template = await emailTemplateService.loadTemplate(key);
            if (!template) {
                return reply.status(404).send({
                    success: false,
                    error: {
                        code: 'TEMPLATE_NOT_FOUND',
                        message: 'Email template not found',
                    },
                });
            }
            const preview = emailTemplateService.getTemplatePreview(template, body.sampleData || {});
            return reply.status(200).send({
                success: true,
                data: {
                    preview,
                },
            });
        }
        catch (error) {
            app.log.error(`Preview email template error: ${error?.message || error}`);
            throw error;
        }
    });
    /**
     * List all email templates
     * GET /api/admin/email-templates
     */
    app.get('/', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const templates = await emailTemplateService.loadAllTemplatesForAdmin();
            return reply.status(200).send({
                success: true,
                data: {
                    templates,
                },
            });
        }
        catch (error) {
            app.log.error(`Get email templates error: ${error?.message || error}`);
            throw error;
        }
    });
    /**
     * Get a single email template
     * GET /api/admin/email-templates/:key
     */
    app.get('/:key', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const { key } = request.params;
            const template = await emailTemplateService.loadTemplate(key);
            if (!template) {
                return reply.status(404).send({
                    success: false,
                    error: {
                        code: 'TEMPLATE_NOT_FOUND',
                        message: 'Email template not found',
                    },
                });
            }
            return reply.status(200).send({
                success: true,
                data: {
                    template,
                },
            });
        }
        catch (error) {
            app.log.error(`Get email template error: ${error?.message || error}`);
            throw error;
        }
    });
    /**
     * Create a new email template
     * POST /api/admin/email-templates
     */
    app.post('/', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const userId = request.user?.userId;
            const body = request.body;
            const template = await emailTemplateService.createTemplate({
                template_key: body.template_key,
                name: body.name,
                description: body.description,
                subject_template: body.subject_template,
                html_template: body.html_template,
                text_template: body.text_template,
                variables: body.variables || [],
                is_active: body.is_active ?? true,
                updated_by: userId,
            });
            return reply.status(201).send({
                success: true,
                data: {
                    template,
                    message: 'Email template created successfully',
                },
            });
        }
        catch (error) {
            if (error.message?.includes('duplicate key')) {
                return reply.status(409).send({
                    success: false,
                    error: {
                        code: 'TEMPLATE_EXISTS',
                        message: 'Template key already exists',
                    },
                });
            }
            app.log.error(`Create email template error: ${error?.message || error}`);
            throw error;
        }
    });
    /**
     * Update an email template
     * PATCH /api/admin/email-templates/:key
     */
    app.patch('/:key', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const userId = request.user?.userId;
            const { key } = request.params;
            const body = request.body;
            const template = await emailTemplateService.updateTemplate(key, {
                name: body.name,
                description: body.description,
                subject_template: body.subject_template,
                html_template: body.html_template,
                text_template: body.text_template,
                variables: body.variables,
                is_active: body.is_active,
                updated_by: userId,
            });
            if (!template) {
                return reply.status(404).send({
                    success: false,
                    error: {
                        code: 'TEMPLATE_NOT_FOUND',
                        message: 'Email template not found',
                    },
                });
            }
            return reply.status(200).send({
                success: true,
                data: {
                    template,
                    message: 'Email template updated successfully',
                },
            });
        }
        catch (error) {
            app.log.error(`Update email template error: ${error?.message || error}`);
            throw error;
        }
    });
    /**
     * Delete an email template (soft delete)
     * DELETE /api/admin/email-templates/:key
     */
    app.delete('/:key', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            const { key } = request.params;
            const deleted = await emailTemplateService.deleteTemplate(key);
            if (!deleted) {
                return reply.status(404).send({
                    success: false,
                    error: {
                        code: 'TEMPLATE_NOT_FOUND',
                        message: 'Email template not found',
                    },
                });
            }
            return reply.status(200).send({
                success: true,
                data: {
                    message: 'Email template deleted successfully',
                },
            });
        }
        catch (error) {
            app.log.error(`Delete email template error: ${error?.message || error}`);
            throw error;
        }
    });
};
exports.emailTemplatesRoutes = emailTemplatesRoutes;
