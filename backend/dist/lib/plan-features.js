"use strict";
/**
 * Plan Feature Definitions for SpamRescue
 * Defines all the features that can be configured per subscription plan
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLAN_FEATURES = void 0;
exports.getPlanFeature = getPlanFeature;
exports.validateFeatureValue = validateFeatureValue;
// Define all possible features that can be configured per plan
exports.PLAN_FEATURES = [
    {
        key: 'max_mailboxes',
        name: 'Maximum Mailboxes',
        description: 'Maximum number of email accounts that can be connected',
        type: 'number',
        defaultValue: 1,
        unit: 'accounts'
    },
    {
        key: 'scan_frequency_minutes',
        name: 'Scan Frequency',
        description: 'Minimum time interval between scans of the same mailbox',
        type: 'number',
        defaultValue: 360, // 6 hours
        unit: 'minutes'
    },
    {
        key: 'max_messages_per_scan',
        name: 'Max Messages Per Scan',
        description: 'Maximum number of messages to process per scan',
        type: 'number',
        defaultValue: 50,
        unit: 'messages'
    },
    {
        key: 'ai_classification_enabled',
        name: 'AI Classification',
        description: 'Whether AI-powered email classification is enabled',
        type: 'boolean',
        defaultValue: false
    },
    {
        key: 'max_ai_classifications_per_month',
        name: 'Max AI Classifications',
        description: 'Maximum number of AI classification requests per month',
        type: 'number',
        defaultValue: 100,
        unit: 'classifications'
    },
    {
        key: 'custom_classification_rules',
        name: 'Custom Classification Rules',
        description: 'Whether user can create custom classification rules',
        type: 'boolean',
        defaultValue: false
    },
    {
        key: 'email_notification_enabled',
        name: 'Email Notifications',
        description: 'Whether email notifications are enabled',
        type: 'boolean',
        defaultValue: true
    },
    {
        key: 'slack_notification_enabled',
        name: 'Slack Notifications',
        description: 'Whether Slack notifications are enabled',
        type: 'boolean',
        defaultValue: false
    },
    {
        key: 'telegram_notification_enabled',
        name: 'Telegram Notifications',
        description: 'Whether Telegram notifications are enabled',
        type: 'boolean',
        defaultValue: false
    },
    {
        key: 'sms_notification_enabled',
        name: 'SMS Notifications',
        description: 'Whether SMS notifications are enabled',
        type: 'boolean',
        defaultValue: false
    },
    {
        key: 'custom_notification_webhooks',
        name: 'Custom Webhooks',
        description: 'Whether custom webhook notifications are enabled',
        type: 'boolean',
        defaultValue: false
    },
    {
        key: 'support_priority',
        name: 'Support Priority',
        description: 'Level of support priority (low, medium, high, priority)',
        type: 'string',
        defaultValue: 'low'
    },
    {
        key: 'max_storage_mb',
        name: 'Max Storage',
        description: 'Maximum storage for attachments and processed data',
        type: 'number',
        defaultValue: 100,
        unit: 'MB'
    },
    {
        key: 'api_rate_limit_requests_per_minute',
        name: 'API Rate Limit',
        description: 'Number of API requests allowed per minute',
        type: 'number',
        defaultValue: 10,
        unit: 'requests/min'
    },
    {
        key: 'custom_branding',
        name: 'Custom Branding',
        description: 'Whether custom branding is allowed',
        type: 'boolean',
        defaultValue: false
    },
    {
        key: 'advanced_analytics',
        name: 'Advanced Analytics',
        description: 'Access to advanced analytics and reporting',
        type: 'boolean',
        defaultValue: false
    },
    {
        key: 'user_management',
        name: 'User Management',
        description: 'Ability to add team members',
        type: 'boolean',
        defaultValue: false
    },
    {
        key: 'max_team_members',
        name: 'Max Team Members',
        description: 'Maximum number of team members allowed',
        type: 'number',
        defaultValue: 1,
        unit: 'users'
    },
    {
        key: 'custom_domains',
        name: 'Custom Domains',
        description: 'Ability to use custom domains for notifications',
        type: 'boolean',
        defaultValue: false
    },
    {
        key: 'data_export',
        name: 'Data Export',
        description: 'Ability to export processed data',
        type: 'boolean',
        defaultValue: false
    },
    {
        key: 'ai_models',
        name: 'AI Models',
        description: 'Available AI models for classification (comma-separated: mistral, openai, gemini, custom)',
        type: 'string',
        defaultValue: 'mistral'
    },
    {
        key: 'bulk_operations',
        name: 'Bulk Operations',
        description: 'Ability to perform bulk operations on messages',
        type: 'boolean',
        defaultValue: false
    },
    {
        key: 'auto_move_recovered',
        name: 'Auto-Move Recovered',
        description: 'Automatically move recovered emails to inbox',
        type: 'boolean',
        defaultValue: false
    },
    {
        key: 'unsubscribe_automation',
        name: 'Unsubscribe Automation',
        description: 'Automated unsubscribe from unwanted newsletters',
        type: 'boolean',
        defaultValue: false
    },
    {
        key: 'advanced_phishing_detect',
        name: 'Advanced Phishing Detection',
        description: 'Enhanced phishing and threat detection',
        type: 'boolean',
        defaultValue: false
    },
    {
        key: 'api_access',
        name: 'API Access',
        description: 'Level of API access (false, standard, full)',
        type: 'string',
        defaultValue: 'false'
    },
    {
        key: 'phone_support',
        name: 'Phone Support',
        description: 'Access to phone support',
        type: 'boolean',
        defaultValue: false
    },
    {
        key: 'custom_onboarding',
        name: 'Custom Onboarding',
        description: 'Personalized onboarding assistance',
        type: 'boolean',
        defaultValue: false
    },
    {
        key: 'hipaa_soc2',
        name: 'HIPAA/SoC2 Compliance',
        description: 'HIPAA and SoC2 compliance options (false, contact, enabled)',
        type: 'string',
        defaultValue: 'false'
    }
];
// Helper function to get a feature definition by key
function getPlanFeature(key) {
    return exports.PLAN_FEATURES.find(feature => feature.key === key);
}
// Helper function to validate a feature value
function validateFeatureValue(feature, value) {
    switch (feature.type) {
        case 'number':
            return typeof value === 'number' && !isNaN(value);
        case 'boolean':
            return typeof value === 'boolean';
        case 'string':
            return typeof value === 'string';
        case 'array':
            return Array.isArray(value);
        default:
            return false;
    }
}
