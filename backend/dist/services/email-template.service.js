"use strict";
/**
 * Email Template Service
 * Manages database-driven email templates with variable substitution
 * Falls back to hardcoded templates if database templates are not available
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadTemplate = loadTemplate;
exports.loadAllTemplates = loadAllTemplates;
exports.loadAllTemplatesForAdmin = loadAllTemplatesForAdmin;
exports.clearTemplateCache = clearTemplateCache;
exports.renderTemplate = renderTemplate;
exports.createTemplate = createTemplate;
exports.updateTemplate = updateTemplate;
exports.deleteTemplate = deleteTemplate;
exports.getTemplatePreview = getTemplatePreview;
const prisma_1 = require("../lib/prisma");
const config_1 = require("../lib/config");
// ========================================
// Template Cache
// ========================================
const templateCache = new Map();
let cacheExpiry = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
// ========================================
// Template Loading
// ========================================
/**
 * Load a template from the database by key
 * Uses caching to reduce database queries
 */
async function loadTemplate(templateKey) {
    try {
        // Check cache first
        if (Date.now() < cacheExpiry && templateCache.has(templateKey)) {
            return templateCache.get(templateKey);
        }
        // Query database using Prisma raw SQL
        const result = await prisma_1.prisma.$queryRaw `
      SELECT * FROM email_templates
      WHERE template_key = ${templateKey} AND is_active = true
      LIMIT 1
    `;
        if (result.length === 0) {
            return null;
        }
        const template = result[0];
        // Update cache
        templateCache.set(templateKey, template);
        if (templateCache.size === 1) {
            // Set cache expiry on first template load
            cacheExpiry = Date.now() + CACHE_TTL;
        }
        return template;
    }
    catch (error) {
        console.error(`[EmailTemplateService] Failed to load template "${templateKey}":`, error);
        return null;
    }
}
/**
 * Load all active templates from database
 */
async function loadAllTemplates() {
    try {
        const result = await prisma_1.prisma.$queryRaw `
      SELECT * FROM email_templates WHERE is_active = true ORDER BY template_key
    `;
        return result;
    }
    catch (error) {
        console.error('[EmailTemplateService] Failed to load templates:', error);
        return [];
    }
}
/**
 * Load all templates (active and inactive) for admin management
 */
async function loadAllTemplatesForAdmin() {
    try {
        const result = await prisma_1.prisma.$queryRaw `
      SELECT * FROM email_templates ORDER BY template_key
    `;
        return result;
    }
    catch (error) {
        console.error('[EmailTemplateService] Failed to load templates for admin:', error);
        return [];
    }
}
/**
 * Clear template cache (useful after template updates)
 */
function clearTemplateCache() {
    templateCache.clear();
    cacheExpiry = 0;
}
// ========================================
// Template Rendering
// ========================================
/**
 * Render a template with provided variables
 * Supports {{variable}} syntax for substitution
 *
 * @param template - The template to render
 * @param variables - Key-value pairs for substitution
 * @returns Rendered subject, HTML, and text
 */
function renderTemplate(template, variables) {
    // Helper function to process template variables
    const processVariables = (vars) => {
        const processed = { ...vars };
        // Auto-generate recipientNameGreeting
        if (vars.recipientName && !vars.recipientNameGreeting) {
            processed.recipientNameGreeting = ` ${vars.recipientName}`;
        }
        else if (!vars.recipientNameGreeting) {
            processed.recipientNameGreeting = '';
        }
        // Auto-generate plural forms
        if (typeof vars.notSpamFound === 'number') {
            processed.notSpamFoundPlural = vars.notSpamFound !== 1 ? 's' : '';
        }
        // Convert confidence score to percentage
        if (typeof vars.notSpamConfidence === 'number') {
            processed.notSpamConfidencePercent = Math.round(vars.notSpamConfidence * 100);
        }
        // Map priority to colors, emojis, and styles
        if (vars.notSpamPriority) {
            const priority = vars.notSpamPriority;
            const priorityConfig = {
                high: { color: '#dc2626', bgColor: '#fee2e2', textColor: '#991b1b', emoji: '🔴' },
                medium: { color: '#f59e0b', bgColor: '#fef3c7', textColor: '#92400e', emoji: '🟡' },
                low: { color: '#10b981', bgColor: '#f3f4f6', textColor: '#4b5563', emoji: '⚪' },
            };
            const config = priorityConfig[priority] || priorityConfig.low;
            processed.priorityColor = config.color;
            processed.priorityBgColor = config.bgColor;
            processed.priorityTextColor = config.textColor;
            processed.priorityEmoji = config.emoji;
            processed.priorityLabel = priority.toUpperCase();
        }
        // Map warning level to colors
        if (vars.warningLevel) {
            const warningColors = {
                critical: '#dc2626',
                warning: '#f59e0b',
                info: '#3b82f6',
            };
            processed.warningColor = warningColors[vars.warningLevel] || '#f59e0b';
        }
        return processed;
    };
    // Process variables with auto-generated values
    const processedVars = processVariables(variables);
    // Replace {{variable}} patterns in template strings
    const substitute = (str) => {
        return str.replace(/\{\{(\w+)\}\}/g, (match, key) => {
            const value = processedVars[key];
            if (value === undefined || value === null) {
                console.warn(`[EmailTemplateService] Missing variable "${key}" in template "${template.template_key}"`);
                return '';
            }
            return String(value);
        });
    };
    return {
        subject: substitute(template.subject_template),
        html: substitute(template.html_template),
        text: substitute(template.text_template),
    };
}
// ========================================
// Template CRUD Operations
// ========================================
/**
 * Create a new email template
 */
async function createTemplate(data) {
    const result = await prisma_1.prisma.$queryRaw `
    INSERT INTO email_templates
    (template_key, name, description, subject_template, html_template, text_template, variables, is_active, updated_by)
    VALUES (
      ${data.template_key},
      ${data.name},
      ${data.description || null},
      ${data.subject_template},
      ${data.html_template},
      ${data.text_template},
      ${JSON.stringify(data.variables)}::jsonb,
      ${data.is_active ?? true},
      ${data.updated_by || null}
    )
    RETURNING *
  `;
    clearTemplateCache();
    return result[0];
}
/**
 * Update an existing email template
 */
async function updateTemplate(templateKey, data) {
    // Build update data object for Prisma (safe parameterized query)
    const updateData = {};
    if (data.name !== undefined)
        updateData.name = data.name;
    if (data.description !== undefined)
        updateData.description = data.description;
    if (data.subject_template !== undefined)
        updateData.subject_template = data.subject_template;
    if (data.html_template !== undefined)
        updateData.html_template = data.html_template;
    if (data.text_template !== undefined)
        updateData.text_template = data.text_template;
    if (data.variables !== undefined)
        updateData.variables = data.variables;
    if (data.is_active !== undefined)
        updateData.is_active = data.is_active;
    if (Object.keys(updateData).length === 0) {
        throw new Error('No fields to update');
    }
    updateData.updated_at = new Date();
    try {
        const result = await prisma_1.prisma.email_templates.update({
            where: { template_key: templateKey },
            data: updateData,
        });
        clearTemplateCache();
        return result;
    }
    catch (error) {
        if (error.code === 'P2025') {
            // Record not found
            return null;
        }
        console.error(`[EmailTemplateService] Failed to update template ${templateKey}:`, error.message);
        throw error;
    }
}
/**
 * Delete an email template (soft delete by setting is_active = false)
 */
async function deleteTemplate(templateKey) {
    const result = await prisma_1.prisma.$executeRaw `
    UPDATE email_templates SET is_active = false WHERE template_key = ${templateKey}
  `;
    clearTemplateCache();
    return result > 0;
}
/**
 * Get template preview with sample data
 */
function getTemplatePreview(template, sampleVariables) {
    // Merge with default sample data
    const defaultSamples = {
        recipientEmail: 'user@example.com',
        recipientName: 'John Doe',
        mailboxEmail: 'john@company.com',
        messagesProcessed: 150,
        notSpamFound: 3,
        notSpamSubject: 'Important Partnership Opportunity',
        notSpamFrom: 'Jane Smith',
        notSpamSenderEmail: 'jane@partner.com',
        notSpamPriority: 'high',
        notSpamConfidence: 0.92,
        notSpamSnippet: 'Hi John, I came across your work and would love to discuss...',
        dashboardUrl: `${config_1.config.appUrl || config_1.config.frontendUrl || 'http://localhost:3000'}/dashboard`,
        messageUrl: `${config_1.config.appUrl || config_1.config.frontendUrl || 'http://localhost:3000'}/messages/123`,
        settingsUrl: `${config_1.config.appUrl || config_1.config.frontendUrl || 'http://localhost:3000'}/settings`,
        supportEmail: 'support@myinboxer.com',
        planName: 'Pro',
        usageCount: 850,
        limitCount: 1000,
        usagePercent: 85,
        resourceType: 'scans',
        warningLevel: 'warning',
        warningMessage: 'You are approaching your monthly scan limit.',
        upgradeUrl: `${config_1.config.appUrl || config_1.config.frontendUrl || 'http://localhost:3000'}/pricing`,
    };
    return renderTemplate(template, { ...defaultSamples, ...sampleVariables });
}
