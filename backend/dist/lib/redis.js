"use strict";
/**
 * Redis Client (Upstash)
 * Production-ready caching layer for rate limiting and classification results
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CacheKeys = exports.redis = void 0;
exports.isRedisAvailable = isRedisAvailable;
exports.getFromCache = getFromCache;
exports.setInCache = setInCache;
exports.deleteFromCache = deleteFromCache;
exports.incrementCounter = incrementCounter;
exports.exists = exists;
exports.getTTL = getTTL;
exports.clearPattern = clearPattern;
exports.redisHealthCheck = redisHealthCheck;
exports.logRedisStatus = logRedisStatus;
const redis_1 = require("@upstash/redis");
const config_1 = require("./config");
/**
 * Redis client instance (Upstash)
 * Only created if Redis credentials are configured
 */
exports.redis = config_1.config.redis.url && config_1.config.redis.token
    ? new redis_1.Redis({
        url: config_1.config.redis.url,
        token: config_1.config.redis.token,
    })
    : null;
/**
 * Check if Redis is available
 */
function isRedisAvailable() {
    return exports.redis !== null;
}
/**
 * Get value from Redis with fallback
 */
async function getFromCache(key) {
    if (!exports.redis)
        return null;
    try {
        const value = await exports.redis.get(key);
        return value;
    }
    catch (error) {
        console.warn(`[Redis] Failed to get key "${key}":`, error);
        return null;
    }
}
/**
 * Set value in Redis with TTL
 */
async function setInCache(key, value, ttlSeconds) {
    if (!exports.redis)
        return false;
    try {
        if (ttlSeconds) {
            await exports.redis.setex(key, ttlSeconds, JSON.stringify(value));
        }
        else {
            await exports.redis.set(key, JSON.stringify(value));
        }
        return true;
    }
    catch (error) {
        console.warn(`[Redis] Failed to set key "${key}":`, error);
        return false;
    }
}
/**
 * Delete value from Redis
 */
async function deleteFromCache(key) {
    if (!exports.redis)
        return false;
    try {
        await exports.redis.del(key);
        return true;
    }
    catch (error) {
        console.warn(`[Redis] Failed to delete key "${key}":`, error);
        return false;
    }
}
/**
 * Increment counter in Redis (for rate limiting)
 */
async function incrementCounter(key, ttlSeconds) {
    if (!exports.redis)
        throw new Error('Redis not available for rate limiting');
    try {
        const count = await exports.redis.incr(key);
        // Set TTL on first increment
        if (count === 1) {
            await exports.redis.expire(key, ttlSeconds);
        }
        return count;
    }
    catch (error) {
        console.error(`[Redis] Failed to increment counter "${key}":`, error);
        throw error;
    }
}
/**
 * Check if key exists in Redis
 */
async function exists(key) {
    if (!exports.redis)
        return false;
    try {
        const result = await exports.redis.exists(key);
        return result === 1;
    }
    catch (error) {
        console.warn(`[Redis] Failed to check existence of key "${key}":`, error);
        return false;
    }
}
/**
 * Get TTL of a key
 */
async function getTTL(key) {
    if (!exports.redis)
        return null;
    try {
        const ttl = await exports.redis.ttl(key);
        return ttl;
    }
    catch (error) {
        console.warn(`[Redis] Failed to get TTL for key "${key}":`, error);
        return null;
    }
}
/**
 * Clear all keys matching a pattern (use with caution)
 */
async function clearPattern(pattern) {
    if (!exports.redis)
        return 0;
    try {
        const keys = await exports.redis.keys(pattern);
        if (keys.length === 0)
            return 0;
        await exports.redis.del(...keys);
        return keys.length;
    }
    catch (error) {
        console.error(`[Redis] Failed to clear pattern "${pattern}":`, error);
        return 0;
    }
}
/**
 * Health check for Redis connection
 */
async function redisHealthCheck() {
    if (!exports.redis) {
        return { healthy: false };
    }
    try {
        const start = Date.now();
        await exports.redis.ping();
        const latency = Date.now() - start;
        return {
            healthy: true,
            latency
        };
    }
    catch (error) {
        console.error('[Redis] Health check failed:', error);
        return { healthy: false };
    }
}
/**
 * Cache key builders for different use cases
 */
exports.CacheKeys = {
    /**
     * Classification result cache key
     */
    classification: (emailHash) => `classification:${emailHash}`,
    /**
     * Domain reputation cache key
     */
    domainReputation: (domain) => `domain:${domain}`,
    /**
     * Sender reputation cache key
     */
    senderReputation: (userId, senderEmail) => `sender:${userId}:${senderEmail}`,
    /**
     * Rate limit key
     */
    rateLimit: (identifier, window) => `rate:${window}:${identifier}`,
    /**
     * User session key
     */
    session: (sessionId) => `session:${sessionId}`,
    /**
     * Thread analysis cache key
     */
    thread: (mailboxId, threadId) => `thread:${mailboxId}:${threadId}`,
    /**
     * Threat intelligence cache key (Phase 2)
     */
    threatIntel: (domain) => `threatIntel:${domain}`,
    /**
     * Custom lists cache key (Phase 3C)
     */
    customLists: (userId) => `customLists:${userId}`,
    /**
     * Custom list stats cache key (Phase 3C)
     */
    customListStats: (userId) => `customListStats:${userId}`,
    /**
     * Custom list match cache key (Phase 3C)
     */
    customListMatch: (userId, value, type) => `customList:${userId}:${type}:${value}`,
    /**
     * Phishing check cache key (Phase 3C)
     */
    phishingCheck: (identifier) => `phishing:${identifier}`,
    /**
     * OTX threat analysis cache key (Phase 3C)
     */
    otxDomain: (domain) => `otx:domain:${domain}`,
    /**
     * OTX email threat analysis cache key (Phase 3C)
     */
    otxEmail: (email) => `otx:email:${email}`,
    /**
     * OTX IP threat analysis cache key (Phase 3C)
     */
    otxIp: (ip) => `otx:ip:${ip}`,
    /**
     * OTX threat feed statistics cache key (Phase 3C)
     */
    otxStats: () => `otx:stats`,
    /**
     * Phishing reports statistics cache key (Phase 3C)
     */
    phishingStats: () => `phishing:stats`,
    /**
     * User reputation cache key (Phase 3C)
     */
    userReputation: (userId, sender) => `reputation:${userId}:${sender}`,
    /**
     * ML model cache key (Phase 3D)
     */
    mlModel: () => `ml:model`,
    /**
     * ML classification cache key (Phase 3D)
     */
    mlClassification: (identifier) => `ml:classification:${identifier}`,
};
/**
 * Log Redis status on startup
 */
function logRedisStatus() {
    if (exports.redis) {
        console.log('✅ Redis: Connected (Upstash)');
    }
    else {
        console.log('⚠️  Redis: Not configured (using in-memory fallback)');
    }
}
