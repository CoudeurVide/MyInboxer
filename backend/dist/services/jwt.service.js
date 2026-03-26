"use strict";
/**
 * JWT Service
 * Handles token generation and verification
 * Based on SECURITY.md specifications
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.jwtService = exports.JWTService = void 0;
class JWTService {
    /**
     * Generate access token payload
     * Short-lived (15 minutes)
     */
    generateAccessTokenPayload(user) {
        return {
            userId: user.id,
            email: user.email,
            role: user.role,
        };
    }
    /**
     * Generate refresh token payload
     * Long-lived (7 days)
     */
    generateRefreshTokenPayload(user) {
        return {
            userId: user.id,
        };
    }
    /**
     * Verify token payload structure
     */
    isValidAccessToken(payload) {
        return (payload &&
            typeof payload.userId === 'string' &&
            typeof payload.email === 'string' &&
            typeof payload.role === 'string');
    }
}
exports.JWTService = JWTService;
// Export singleton instance
exports.jwtService = new JWTService();
