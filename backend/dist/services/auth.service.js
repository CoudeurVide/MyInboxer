"use strict";
/**
 * Authentication Service
 * Handles user registration, login, and token management
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.authService = exports.AuthService = void 0;
const prisma_1 = require("../lib/prisma");
const password_service_1 = require("./password.service");
const jwt_service_1 = require("./jwt.service");
const client_1 = require("@prisma/client");
class AuthService {
    /**
     * Register new user
     * @param input - Registration data (email, password)
     * @returns Created user and auth tokens
     */
    async register(input, request) {
        // Validate password strength
        password_service_1.passwordService.validatePasswordStrength(input.password);
        // Check if user already exists
        const existingUser = await prisma_1.prisma.user.findUnique({
            where: { email: input.email.toLowerCase() },
        });
        if (existingUser) {
            throw new Error('USER_ALREADY_EXISTS');
        }
        // Hash password
        const passwordHash = await password_service_1.passwordService.hashPassword(input.password);
        // Create user
        const user = await prisma_1.prisma.user.create({
            data: {
                email: input.email.toLowerCase(),
                password_hash: passwordHash,
                role: client_1.Role.owner, // First user is always owner
            },
        });
        // Generate tokens
        const tokens = await this.generateTokens(user, request);
        // Remove password hash from response
        const { password_hash, ...userWithoutPassword } = user;
        return {
            user: userWithoutPassword,
            tokens,
        };
    }
    /**
     * Login user
     * @param input - Login credentials (email, password)
     * @returns User and auth tokens
     */
    async login(input, request) {
        // Find user by email
        const user = await prisma_1.prisma.user.findUnique({
            where: { email: input.email.toLowerCase() },
        });
        if (!user) {
            throw new Error('INVALID_CREDENTIALS');
        }
        // Verify password
        const isPasswordValid = await password_service_1.passwordService.comparePassword(input.password, user.password_hash);
        if (!isPasswordValid) {
            throw new Error('INVALID_CREDENTIALS');
        }
        // Generate tokens
        const tokens = await this.generateTokens(user, request);
        // Remove password hash from response
        const { password_hash, ...userWithoutPassword } = user;
        return {
            user: userWithoutPassword,
            tokens,
        };
    }
    /**
     * Refresh access token
     * @param refreshToken - Refresh token from cookie
     * @returns New access token
     */
    async refreshAccessToken(refreshToken, request) {
        try {
            // Verify refresh token
            const decoded = request.server.jwt.verify(refreshToken);
            // Find user
            const user = await prisma_1.prisma.user.findUnique({
                where: { id: decoded.userId },
            });
            if (!user) {
                throw new Error('USER_NOT_FOUND');
            }
            // Generate new access token
            const accessTokenPayload = jwt_service_1.jwtService.generateAccessTokenPayload(user);
            const accessToken = request.server.jwt.sign(accessTokenPayload);
            // Rotate refresh token — issue a new one to invalidate the old token
            const refreshTokenPayload = jwt_service_1.jwtService.generateRefreshTokenPayload(user);
            const newRefreshToken = request.server.jwt.sign(refreshTokenPayload, { expiresIn: '7d' });
            return { accessToken, refreshToken: newRefreshToken };
        }
        catch (error) {
            throw new Error('INVALID_REFRESH_TOKEN');
        }
    }
    /**
     * Generate access and refresh tokens
     * @private
     */
    async generateTokens(user, request) {
        // Generate access token (15 minutes)
        const accessTokenPayload = jwt_service_1.jwtService.generateAccessTokenPayload(user);
        const accessToken = request.server.jwt.sign(accessTokenPayload);
        // Generate refresh token (7 days)
        const refreshTokenPayload = jwt_service_1.jwtService.generateRefreshTokenPayload(user);
        const refreshToken = request.server.jwt.sign(refreshTokenPayload, {
            expiresIn: '7d',
        });
        return {
            accessToken,
            refreshToken,
        };
    }
    /**
     * Get current user from request
     */
    async getCurrentUser(request) {
        await request.jwtVerify();
        const payload = request.user;
        const user = await prisma_1.prisma.user.findUnique({
            where: { id: payload.userId },
        });
        if (!user) {
            throw new Error('USER_NOT_FOUND');
        }
        const { password_hash, ...userWithoutPassword } = user;
        return userWithoutPassword;
    }
}
exports.AuthService = AuthService;
// Export singleton instance
exports.authService = new AuthService();
