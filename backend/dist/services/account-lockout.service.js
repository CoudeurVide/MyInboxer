"use strict";
/**
 * Account Lockout Service
 * Tracks failed login attempts per email and locks accounts after threshold.
 * Uses Redis for fast, ephemeral tracking (no DB schema changes needed).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAccountLocked = isAccountLocked;
exports.recordFailedAttempt = recordFailedAttempt;
exports.clearFailedAttempts = clearFailedAttempts;
exports.getRemainingAttempts = getRemainingAttempts;
const redis_1 = require("../lib/redis");
const LOCKOUT_PREFIX = 'lockout';
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_SECONDS = 15 * 60; // 15 minutes
const ATTEMPT_WINDOW_SECONDS = 15 * 60; // Track attempts within 15 minutes
/**
 * Check if an account is currently locked
 * @returns lockout info: locked status and time remaining
 */
async function isAccountLocked(email) {
    const lockKey = `${LOCKOUT_PREFIX}:lock:${email.toLowerCase()}`;
    const ttl = await redis_1.redis.ttl(lockKey);
    if (ttl > 0) {
        return { locked: true, retryAfterSeconds: ttl };
    }
    return { locked: false };
}
/**
 * Record a failed login attempt
 * @returns number of failed attempts and whether account is now locked
 */
async function recordFailedAttempt(email) {
    const normalizedEmail = email.toLowerCase();
    const attemptsKey = `${LOCKOUT_PREFIX}:attempts:${normalizedEmail}`;
    const lockKey = `${LOCKOUT_PREFIX}:lock:${normalizedEmail}`;
    // Increment failed attempts counter
    const attempts = await redis_1.redis.incr(attemptsKey);
    // Set expiry on first attempt
    if (attempts === 1) {
        await redis_1.redis.expire(attemptsKey, ATTEMPT_WINDOW_SECONDS);
    }
    // Check if threshold exceeded
    if (attempts >= MAX_FAILED_ATTEMPTS) {
        // Lock the account
        await redis_1.redis.setex(lockKey, LOCKOUT_DURATION_SECONDS, 'locked');
        // Reset the attempts counter
        await redis_1.redis.del(attemptsKey);
        return { attempts, locked: true };
    }
    return { attempts, locked: false };
}
/**
 * Clear failed attempts after successful login
 */
async function clearFailedAttempts(email) {
    const normalizedEmail = email.toLowerCase();
    const attemptsKey = `${LOCKOUT_PREFIX}:attempts:${normalizedEmail}`;
    await redis_1.redis.del(attemptsKey);
}
/**
 * Get remaining attempts before lockout
 */
async function getRemainingAttempts(email) {
    const attemptsKey = `${LOCKOUT_PREFIX}:attempts:${email.toLowerCase()}`;
    const attempts = await redis_1.redis.get(attemptsKey);
    return MAX_FAILED_ATTEMPTS - (parseInt(attempts) || 0);
}
