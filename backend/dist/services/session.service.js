"use strict";
/**
 * Server-Side Session Management
 * Tracks active user sessions and enables proper session invalidation
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SessionService = void 0;
const redis_1 = require("../lib/redis");
const crypto_1 = __importDefault(require("crypto"));
class SessionService {
    static SESSION_PREFIX = 'session';
    static USER_SESSIONS_PREFIX = 'user_sessions';
    /**
     * Create a new session
     * @param userId The user ID
     * @param token The JWT token
     * @param userAgent Optional user agent string
     * @param ipAddress Optional IP address
     * @returns Session ID
     */
    static async createSession(userId, token, userAgent, ipAddress) {
        if (!userId || !token) {
            throw new Error('Cannot create session: missing userId or token');
        }
        // Create a unique session ID
        const sessionId = crypto_1.default.randomBytes(32).toString('hex');
        // Hash the token for storage (don't store the actual token)
        const tokenHash = crypto_1.default.createHash('sha256').update(token).digest('hex');
        // Calculate expiration time (same as JWT expiration)
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 2); // Matches default JWT expiration
        const sessionData = {
            id: sessionId,
            userId,
            tokenHash,
            createdAt: new Date(),
            expiresAt,
            userAgent,
            ipAddress
        };
        // Store session data in Redis with expiration
        const key = `${this.SESSION_PREFIX}:${sessionId}`;
        await redis_1.redis.setex(key, 7200, JSON.stringify(sessionData)); // 2 hours in seconds
        // Track user's sessions
        const userSessionsKey = `${this.USER_SESSIONS_PREFIX}:${userId}`;
        await redis_1.redis.sadd(userSessionsKey, sessionId);
        await redis_1.redis.expire(userSessionsKey, 7200); // 2 hours
        return sessionId;
    }
    /**
     * Validate if a session is active
     * @param sessionId The session ID
     * @param token The JWT token to validate against
     * @returns True if session is valid, false otherwise
     */
    static async validateSession(sessionId, token) {
        if (!sessionId || !token) {
            return false;
        }
        const key = `${this.SESSION_PREFIX}:${sessionId}`;
        const sessionDataStr = await redis_1.redis.get(key);
        if (!sessionDataStr) {
            return false; // Session doesn't exist
        }
        const sessionData = JSON.parse(sessionDataStr);
        const tokenHash = crypto_1.default.createHash('sha256').update(token).digest('hex');
        // Check if the token matches and the session hasn't expired
        return sessionData.tokenHash === tokenHash &&
            new Date() < new Date(sessionData.expiresAt);
    }
    /**
     * Invalidate a specific session
     * @param sessionId The session ID to invalidate
     */
    static async invalidateSession(sessionId) {
        if (!sessionId) {
            console.warn('Cannot invalidate session: missing sessionId');
            return;
        }
        const key = `${this.SESSION_PREFIX}:${sessionId}`;
        const sessionDataStr = await redis_1.redis.get(key);
        if (!sessionDataStr) {
            return; // Session doesn't exist
        }
        const sessionData = JSON.parse(sessionDataStr);
        // Remove the session
        await redis_1.redis.del(key);
        // Remove from user's session set
        const userSessionsKey = `${this.USER_SESSIONS_PREFIX}:${sessionData.userId}`;
        await redis_1.redis.srem(userSessionsKey, sessionId);
    }
    /**
     * Invalidate all sessions for a user
     * @param userId The user ID
     */
    static async invalidateAllUserSessions(userId) {
        const userSessionsKey = `${this.USER_SESSIONS_PREFIX}:${userId}`;
        const sessionIds = await redis_1.redis.smembers(userSessionsKey);
        if (sessionIds.length > 0) {
            // Delete all session records
            const sessionKeys = sessionIds.map(id => `${this.SESSION_PREFIX}:${id}`);
            await redis_1.redis.del(...sessionKeys);
            // Delete the user session set
            await redis_1.redis.del(userSessionsKey);
        }
    }
    /**
     * Get all active sessions for a user
     * @param userId The user ID
     */
    static async getUserSessions(userId) {
        if (!userId) {
            console.warn('Cannot get sessions: missing userId');
            return [];
        }
        const userSessionsKey = `${this.USER_SESSIONS_PREFIX}:${userId}`;
        const sessionIds = await redis_1.redis.smembers(userSessionsKey);
        const sessions = [];
        for (const sessionId of sessionIds) {
            const key = `${this.SESSION_PREFIX}:${sessionId}`;
            const sessionDataStr = await redis_1.redis.get(key);
            if (sessionDataStr) {
                const sessionData = JSON.parse(sessionDataStr);
                // Only include non-expired sessions
                if (new Date() < new Date(sessionData.expiresAt)) {
                    sessions.push(sessionData);
                }
            }
        }
        return sessions;
    }
}
exports.SessionService = SessionService;
