"use strict";
/**
 * User Classification Preferences Service
 * Manages user-level classification overrides (strictness, AI power, domains)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getUserPreferences = getUserPreferences;
exports.updateUserPreferences = updateUserPreferences;
exports.resetUserPreferences = resetUserPreferences;
exports.getStrictnessMultiplier = getStrictnessMultiplier;
exports.getAIThreshold = getAIThreshold;
exports.isWhitelisted = isWhitelisted;
exports.isBlacklisted = isBlacklisted;
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
/**
 * Get user's classification preferences
 * Returns default preferences (table was deprecated)
 */
async function getUserPreferences(userId) {
    // Return default preferences
    // The user_classification_preferences table was deprecated and removed
    // This function now returns default balanced settings
    return {
        id: userId,
        user_id: userId,
        strictness_level: 'balanced',
        ai_aggressiveness: 'balanced',
        whitelisted_domains: [],
        blacklisted_domains: [],
        created_at: new Date(),
        updated_at: new Date(),
    };
}
/**
 * Update user's classification preferences
 * Now returns default preferences (table was deprecated)
 */
async function updateUserPreferences(userId, updates) {
    // Table was deprecated, return default preferences with updates applied
    const defaultPrefs = await getUserPreferences(userId);
    return {
        ...defaultPrefs,
        strictness_level: updates.strictness_level || defaultPrefs.strictness_level,
        ai_aggressiveness: updates.ai_aggressiveness || defaultPrefs.ai_aggressiveness,
        whitelisted_domains: updates.whitelisted_domains || defaultPrefs.whitelisted_domains,
        blacklisted_domains: updates.blacklisted_domains || defaultPrefs.blacklisted_domains,
        updated_at: new Date(),
    };
}
/**
 * Create user preferences with specified values
 * Now returns in-memory preferences (table was deprecated)
 */
async function createUserPreferences(userId, initial) {
    // Table was deprecated, return in-memory preferences
    return {
        id: userId,
        user_id: userId,
        strictness_level: initial.strictness_level || 'balanced',
        ai_aggressiveness: initial.ai_aggressiveness || 'balanced',
        whitelisted_domains: initial.whitelisted_domains || [],
        blacklisted_domains: initial.blacklisted_domains || [],
        created_at: new Date(),
        updated_at: new Date(),
    };
}
/**
 * Reset user preferences to defaults
 */
async function resetUserPreferences(userId) {
    return await updateUserPreferences(userId, {
        strictness_level: 'balanced',
        ai_aggressiveness: 'balanced',
        whitelisted_domains: [],
        blacklisted_domains: [],
    });
}
/**
 * Get strictness multiplier for thresholds
 */
function getStrictnessMultiplier(level) {
    const multipliers = {
        lenient: 0.7, // Lower thresholds = more emails classified as leads
        balanced: 1.0, // Default thresholds
        strict: 1.3, // Higher thresholds = fewer false positives
    };
    return multipliers[level];
}
/**
 * Get AI confidence threshold based on aggressiveness
 */
function getAIThreshold(level) {
    const thresholds = {
        conservative: 0.8, // AI only for very uncertain cases (20% of emails)
        balanced: 0.65, // AI for moderately uncertain cases (30% of emails)
        aggressive: 0.5, // AI for most cases (50% of emails)
    };
    return thresholds[level];
}
/**
 * Check if a domain is whitelisted for a user
 */
function isWhitelisted(domain, preferences) {
    return preferences.whitelisted_domains.some((d) => d.toLowerCase() === domain.toLowerCase());
}
/**
 * Check if a domain is blacklisted for a user
 */
function isBlacklisted(domain, preferences) {
    return preferences.blacklisted_domains.some((d) => d.toLowerCase() === domain.toLowerCase());
}
