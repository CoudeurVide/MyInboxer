"use strict";
/**
 * Authentication Routes
 * POST /api/auth/register - Register new user
 * POST /api/auth/login - Login user
 * POST /api/auth/refresh - Refresh access token
 * GET /api/auth/me - Get current user
 * POST /api/auth/logout - Logout user
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRoutes = void 0;
const auth_service_1 = require("../../services/auth.service");
const auth_schemas_1 = require("../../schemas/auth.schemas");
const googleapis_1 = require("googleapis");
const config_1 = require("../../lib/config");
const mailboxService = __importStar(require("../../services/mailbox.service"));
const prisma_1 = require("../../lib/prisma");
const crypto_1 = __importDefault(require("crypto"));
const redis_1 = require("../../lib/redis");
const session_service_1 = require("../../services/session.service");
const usage_service_1 = require("../../services/usage.service");
const email_service_1 = require("../../services/email.service");
const mfaService = __importStar(require("../../services/mfa.service"));
const account_lockout_service_1 = require("../../services/account-lockout.service");
const security_event_service_1 = require("../../services/security-event.service");
// OAuth State Management
// Function to generate a random state value and store the associated userId
async function generateOAuthState(userId) {
    if (!userId) {
        throw new Error('Cannot generate OAuth state: userId is required');
    }
    const state = crypto_1.default.randomBytes(32).toString('hex'); // 64 character random string
    const cacheKey = `oauth_state:${state}`;
    // Store the state with the userId for 10 minutes (600 seconds)
    await redis_1.redis.setex(cacheKey, 600, userId); // Expire after 10 minutes using setex
    return state;
}
// Function to validate the state and retrieve the userId
async function validateOAuthState(state) {
    if (!state) {
        return null;
    }
    try {
        const cacheKey = `oauth_state:${state}`;
        const userId = await redis_1.redis.get(cacheKey);
        if (userId) {
            // Clean up immediately after use
            await redis_1.redis.del(cacheKey);
            return userId;
        }
    }
    catch (error) {
        console.error('Error validating OAuth state:', error);
        // Don't throw error, just return null
    }
    return null; // State not found or already used/expired
}
// One-time auth code for OAuth redirects (CASA compliance: tokens must not appear in URLs)
async function generateAuthCode(accessToken) {
    const code = crypto_1.default.randomBytes(32).toString('hex');
    const cacheKey = `auth_code:${code}`;
    // Store for 60 seconds — just enough time for the frontend to exchange it
    await redis_1.redis.setex(cacheKey, 60, accessToken);
    return code;
}
async function exchangeAuthCode(code) {
    if (!code)
        return null;
    try {
        const cacheKey = `auth_code:${code}`;
        const accessToken = await redis_1.redis.get(cacheKey);
        if (accessToken) {
            // Delete immediately — one-time use only
            await redis_1.redis.del(cacheKey);
            return accessToken;
        }
    }
    catch (error) {
        console.error('Error exchanging auth code:', error);
    }
    return null;
}
const authRoutes = async (app) => {
    /**
     * Register new user
     * POST /api/auth/register
     */
    app.post('/register', {
        config: {
            rateLimit: {
                max: 3, // 3 attempts
                timeWindow: '5 minutes', // per 5 minutes (prevent spam registrations)
                // Custom message for rate limit exceeded
                errorResponseBuilder: (req, context) => {
                    return {
                        statusCode: 429,
                        error: 'Too Many Requests',
                        message: `Too many registration attempts, please try again after ${context.after}`,
                        timeToReset: context.ttl,
                    };
                }
            }
        }
    }, async (request, reply) => {
        try {
            // Validate request body
            const body = auth_schemas_1.RegisterSchema.parse(request.body);
            // Register user
            const { user, tokens } = await auth_service_1.authService.register(body, request);
            // Set refresh token as httpOnly cookie
            reply.setCookie('refreshToken', tokens.refreshToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax', // Allow OAuth redirects
                maxAge: 7 * 24 * 60 * 60, // 7 days
                path: '/',
            });
            // Also set access token in httpOnly cookie (more secure)
            reply.setCookie('accessToken', tokens.accessToken, {
                httpOnly: true, // Prevent XSS from accessing token
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax', // Allow OAuth redirects
                maxAge: process.env.NODE_ENV === 'production' ? 2 * 60 * 60 : 24 * 60 * 60, // Production: 2 hours, Dev: 24 hours
                path: '/',
            });
            // Create server-side session for proper session management
            const sessionId = await session_service_1.SessionService.createSession(user.id, tokens.accessToken, request.headers['user-agent'], request.ip);
            // Send welcome email (async, don't wait for it)
            (0, email_service_1.sendWelcomeEmailAsync)({
                email: user.email,
                name: user.name,
                dashboardUrl: `${config_1.config.frontendUrl}/dashboard`,
            });
            return reply.status(201).send({
                success: true,
                data: {
                    user,
                    accessToken: tokens.accessToken,
                    sessionId, // Include session ID in response if needed
                },
            });
        }
        catch (error) {
            if (error.message === 'USER_ALREADY_EXISTS') {
                return reply.status(409).send({
                    success: false,
                    error: {
                        code: 'USER_ALREADY_EXISTS',
                        message: 'A user with this email already exists',
                    },
                });
            }
            if (error.name === 'ZodError') {
                return reply.status(400).send({
                    success: false,
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'Invalid request data',
                        details: error.errors,
                    },
                });
            }
            throw error;
        }
    });
    /**
     * Login user
     * POST /api/auth/login
     */
    app.post('/login', {
        config: {
            rateLimit: {
                max: 5, // 5 attempts
                timeWindow: '1 minute', // per 1 minute
                // Custom message for rate limit exceeded
                errorResponseBuilder: (req, context) => {
                    return {
                        statusCode: 429,
                        error: 'Too Many Requests',
                        message: `Too many login attempts, please try again after ${context.after}`,
                        timeToReset: context.ttl,
                    };
                }
            }
        }
    }, async (request, reply) => {
        try {
            // Validate request body
            const body = auth_schemas_1.LoginSchema.parse(request.body);
            const { mfaToken } = request.body;
            // Check account lockout before attempting login
            const lockStatus = await (0, account_lockout_service_1.isAccountLocked)(body.email);
            if (lockStatus.locked) {
                await (0, security_event_service_1.logSecurityEvent)({
                    eventType: 'login_locked',
                    ipAddress: request.ip,
                    userAgent: request.headers['user-agent'] || '',
                    details: { email: body.email, retryAfterSeconds: lockStatus.retryAfterSeconds },
                    status: 'failure',
                });
                return reply.status(429).send({
                    success: false,
                    error: {
                        code: 'ACCOUNT_LOCKED',
                        message: `Too many failed login attempts. Please try again in ${Math.ceil((lockStatus.retryAfterSeconds || 900) / 60)} minutes.`,
                        retryAfterSeconds: lockStatus.retryAfterSeconds,
                    },
                });
            }
            // Login user (verify password)
            const { user, tokens } = await auth_service_1.authService.login(body, request);
            // Check if user has MFA enabled
            const mfaEnabled = await mfaService.isMFAEnabled(user.id);
            if (mfaEnabled) {
                // MFA is enabled - require MFA token
                if (!mfaToken) {
                    // No MFA token provided - return response indicating MFA is required
                    return reply.status(200).send({
                        success: true,
                        data: {
                            mfaRequired: true,
                            userId: user.id,
                            message: 'MFA verification required. Please provide your 6-digit code.',
                        },
                    });
                }
                // Verify MFA token
                const mfaVerification = await mfaService.verifyMFALogin(user.id, mfaToken);
                if (!mfaVerification.valid) {
                    return reply.status(401).send({
                        success: false,
                        error: {
                            code: 'INVALID_MFA_TOKEN',
                            message: 'Invalid MFA code. Please try again.',
                        },
                    });
                }
                // MFA verification successful - proceed with login
            }
            // Clear failed attempts on successful login
            await (0, account_lockout_service_1.clearFailedAttempts)(body.email);
            // Log successful login
            await (0, security_event_service_1.logSecurityEvent)({
                eventType: 'login_success',
                userId: user.id,
                ipAddress: request.ip,
                userAgent: request.headers['user-agent'] || '',
            });
            // Track last login time
            await prisma_1.prisma.user.update({
                where: { id: user.id },
                data: { last_login_at: new Date() },
            });
            // Set refresh token as httpOnly cookie
            reply.setCookie('refreshToken', tokens.refreshToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax', // Allow OAuth redirects
                maxAge: 7 * 24 * 60 * 60, // 7 days
                path: '/',
            });
            // Also set access token in httpOnly cookie (more secure)
            reply.setCookie('accessToken', tokens.accessToken, {
                httpOnly: true, // Prevent XSS from accessing token
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax', // Allow OAuth redirects
                maxAge: process.env.NODE_ENV === 'production' ? 2 * 60 * 60 : 24 * 60 * 60, // Production: 2 hours, Dev: 24 hours
                path: '/',
            });
            // Create server-side session for proper session management
            const sessionId = await session_service_1.SessionService.createSession(user.id, tokens.accessToken, request.headers['user-agent'], request.ip);
            return reply.status(200).send({
                success: true,
                data: {
                    user,
                    accessToken: tokens.accessToken,
                    sessionId, // Include session ID in response if needed
                },
            });
        }
        catch (error) {
            if (error.message === 'INVALID_CREDENTIALS') {
                // Record failed attempt and check for lockout
                const email = request.body?.email || '';
                const lockResult = await (0, account_lockout_service_1.recordFailedAttempt)(email);
                await (0, security_event_service_1.logSecurityEvent)({
                    eventType: 'login_failed',
                    ipAddress: request.ip,
                    userAgent: request.headers['user-agent'] || '',
                    details: { email, attempts: lockResult.attempts, locked: lockResult.locked },
                    status: 'failure',
                });
                if (lockResult.locked) {
                    return reply.status(429).send({
                        success: false,
                        error: {
                            code: 'ACCOUNT_LOCKED',
                            message: 'Too many failed login attempts. Your account has been locked for 15 minutes.',
                        },
                    });
                }
                return reply.status(401).send({
                    success: false,
                    error: {
                        code: 'INVALID_CREDENTIALS',
                        message: 'Invalid email or password',
                    },
                });
            }
            if (error.name === 'ZodError') {
                return reply.status(400).send({
                    success: false,
                    error: {
                        code: 'VALIDATION_ERROR',
                        message: 'Invalid request data',
                        details: error.errors,
                    },
                });
            }
            throw error;
        }
    });
    /**
     * Refresh access token
     * POST /api/auth/refresh
     */
    app.post('/refresh', {
        config: {
            rateLimit: {
                max: 10, // 10 attempts
                timeWindow: '1 minute', // per 1 minute
                // Custom message for rate limit exceeded
                errorResponseBuilder: (req, context) => {
                    return {
                        statusCode: 429,
                        error: 'Too Many Requests',
                        message: `Too many refresh attempts, please try again after ${context.after}`,
                        timeToReset: context.ttl,
                    };
                }
            }
        }
    }, async (request, reply) => {
        try {
            const refreshToken = request.cookies.refreshToken;
            if (!refreshToken) {
                return reply.status(401).send({
                    success: false,
                    error: {
                        code: 'NO_REFRESH_TOKEN',
                        message: 'No refresh token provided',
                    },
                });
            }
            // Refresh access token and rotate refresh token
            const { accessToken, refreshToken: newRefreshToken } = await auth_service_1.authService.refreshAccessToken(refreshToken, request);
            // Rotate refresh token cookie — old token is discarded
            reply.setCookie('refreshToken', newRefreshToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                path: '/',
                maxAge: 60 * 60 * 24 * 7, // 7 days
            });
            return reply.status(200).send({
                success: true,
                data: {
                    accessToken,
                },
            });
        }
        catch (error) {
            if (error.message === 'INVALID_REFRESH_TOKEN' || error.message === 'USER_NOT_FOUND') {
                return reply.status(401).send({
                    success: false,
                    error: {
                        code: 'INVALID_REFRESH_TOKEN',
                        message: 'Invalid or expired refresh token',
                    },
                });
            }
            throw error;
        }
    });
    /**
     * Get current user
     * GET /api/auth/me
     */
    app.get('/me', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const user = await auth_service_1.authService.getCurrentUser(request);
            return reply.status(200).send({
                success: true,
                data: {
                    user,
                },
            });
        }
        catch (error) {
            if (error.message === 'USER_NOT_FOUND') {
                return reply.status(404).send({
                    success: false,
                    error: {
                        code: 'USER_NOT_FOUND',
                        message: 'User not found',
                    },
                });
            }
            throw error;
        }
    });
    /**
     * Logout user
     * POST /api/auth/logout
     */
    app.post('/logout', {
        preHandler: [app.authenticate], // Require authentication to logout
    }, async (request, reply) => {
        // Clear refresh token cookie
        reply.clearCookie('refreshToken', {
            path: '/',
        });
        // Also clear access token cookie
        reply.clearCookie('accessToken', {
            path: '/',
        });
        // Invalidate server-side session
        try {
            const userId = request.user.userId;
            await session_service_1.SessionService.invalidateAllUserSessions(userId);
            await (0, security_event_service_1.logSecurityEvent)({
                eventType: 'logout',
                userId,
                ipAddress: request.ip,
                userAgent: request.headers['user-agent'] || '',
            });
        }
        catch (error) {
            // Log the error but don't fail the logout process
            app.log.error(`Error invalidating server-side session: ${error?.message || error}`);
        }
        return reply.status(200).send({
            success: true,
            data: {
                message: 'Logged out successfully',
            },
        });
    });
    /**
     * Exchange one-time auth code for access token
     * POST /api/auth/exchange-code
     * Used after OAuth redirects — the redirect URL contains a short-lived code instead of the JWT
     */
    app.post('/exchange-code', {
        config: {
            rateLimit: {
                max: 10,
                timeWindow: '1 minute',
            }
        }
    }, async (request, reply) => {
        try {
            const { code } = request.body;
            if (!code) {
                return reply.status(400).send({ success: false, error: 'Missing code parameter' });
            }
            const accessToken = await exchangeAuthCode(code);
            if (!accessToken) {
                return reply.status(401).send({ success: false, error: 'Invalid or expired code' });
            }
            return reply.status(200).send({
                success: true,
                data: { accessToken },
            });
        }
        catch (error) {
            app.log.error(`Auth code exchange error: ${error?.message || error}`);
            return reply.status(500).send({ success: false, error: 'Code exchange failed' });
        }
    });
    /**
     * Magic Link Verification
     * POST /api/auth/magic-link/verify
     * Used for email action links to auto-authenticate users
     */
    app.post('/magic-link/verify', async (request, reply) => {
        try {
            const { token } = request.body;
            if (!token) {
                return reply.status(400).send({
                    success: false,
                    error: 'Token is required',
                });
            }
            // Verify the magic link token (it's a JWT signed by the backend)
            let decoded;
            try {
                decoded = app.jwt.verify(token);
            }
            catch (jwtError) {
                return reply.status(401).send({
                    success: false,
                    error: jwtError.message === 'jwt expired' ? 'Link has expired' : 'Invalid link',
                });
            }
            // Check if it's a valid magic link token
            if (decoded.type !== 'magic_link' || !decoded.userId) {
                return reply.status(401).send({
                    success: false,
                    error: 'Invalid magic link token',
                });
            }
            // Get the user
            const user = await prisma_1.prisma.user.findUnique({
                where: { id: decoded.userId },
                select: {
                    id: true,
                    email: true,
                    name: true,
                    plan_id: true,
                },
            });
            if (!user) {
                return reply.status(404).send({
                    success: false,
                    error: 'User not found',
                });
            }
            // Generate new access and refresh tokens
            const accessToken = app.jwt.sign({ userId: user.id, email: user.email }, { expiresIn: process.env.NODE_ENV === 'production' ? '2h' : '24h' });
            const refreshToken = app.jwt.sign({ userId: user.id, type: 'refresh' }, { expiresIn: '7d' });
            // Set tokens as cookies
            reply.setCookie('accessToken', accessToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: process.env.NODE_ENV === 'production' ? 2 * 60 * 60 : 24 * 60 * 60,
                path: '/',
            });
            reply.setCookie('refreshToken', refreshToken, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax',
                maxAge: 7 * 24 * 60 * 60,
                path: '/',
            });
            // Create server-side session
            await session_service_1.SessionService.createSession(user.id, accessToken, request.headers['user-agent'], request.ip);
            return reply.status(200).send({
                success: true,
                data: {
                    user: {
                        id: user.id,
                        email: user.email,
                        name: user.name,
                    },
                    accessToken,
                    refreshToken,
                },
            });
        }
        catch (error) {
            app.log.error(`Magic link verification error: ${error?.message || error}`);
            return reply.status(500).send({
                success: false,
                error: 'Authentication failed',
            });
        }
    });
    /**
     * Google OAuth - User Login/Signup
     * GET /api/auth/google?state=<encoded_redirect_info>
     */
    app.get('/google', async (request, reply) => {
        try {
            // Validate OAuth configuration
            if (!config_1.config.oauth.google.clientId || !config_1.config.oauth.google.clientSecret) {
                app.log.error('Google OAuth not configured');
                return reply.redirect(`${config_1.config.frontendUrl}/auth/login?error=oauth_not_configured`);
            }
            const oauth2Client = new googleapis_1.google.auth.OAuth2(config_1.config.oauth.google.clientId, config_1.config.oauth.google.clientSecret, `${config_1.config.apiUrl}/api/auth/google/callback` // Different callback for login
            );
            const scopes = [
                'https://www.googleapis.com/auth/userinfo.email',
                'https://www.googleapis.com/auth/userinfo.profile',
            ];
            // Get state from query params (contains redirect and plan info from frontend)
            const { state } = request.query;
            const oauthState = state || 'login'; // Default to 'login' if no state provided
            // Get authorization URL
            const authUrl = oauth2Client.generateAuthUrl({
                access_type: 'offline',
                scope: scopes,
                prompt: 'consent',
                state: oauthState, // Pass the state parameter through
            });
            app.log.info('Redirecting to Google OAuth for user login');
            return reply.redirect(authUrl);
        }
        catch (error) {
            app.log.error(`Google OAuth start error: ${error?.message || error}`);
            return reply.redirect(`${config_1.config.frontendUrl}/auth/login?error=oauth_failed`);
        }
    });
    /**
     * Google OAuth - Handle Login/Signup Callback
     * GET /api/auth/google/callback
     */
    app.get('/google/callback', {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        try {
            const { code, error, state } = request.query;
            if (error) {
                app.log.warn('User denied Google OAuth:', error);
                return reply.redirect(`${config_1.config.frontendUrl}/auth/login?error=oauth_denied`);
            }
            if (!code) {
                app.log.error('No authorization code from Google');
                return reply.redirect(`${config_1.config.frontendUrl}/auth/login?error=missing_code`);
            }
            // Validate OAuth configuration
            if (!config_1.config.oauth.google.clientId || !config_1.config.oauth.google.clientSecret) {
                app.log.error('Google OAuth not configured');
                return reply.redirect(`${config_1.config.frontendUrl}/auth/login?error=oauth_not_configured`);
            }
            // Exchange code for tokens
            const oauth2Client = new googleapis_1.google.auth.OAuth2(config_1.config.oauth.google.clientId, config_1.config.oauth.google.clientSecret, `${config_1.config.apiUrl}/api/auth/google/callback`);
            app.log.info('Exchanging code for tokens...');
            const { tokens } = await oauth2Client.getToken(code);
            oauth2Client.setCredentials(tokens);
            // Get user info
            app.log.info('Fetching user info from Google...');
            const oauth2 = googleapis_1.google.oauth2({ version: 'v2', auth: oauth2Client });
            const userInfo = await oauth2.userinfo.get();
            if (!userInfo.data.email) {
                app.log.error('No email in Google user info');
                return reply.redirect(`${config_1.config.frontendUrl}/auth/login?error=missing_email`);
            }
            app.log.info(`Google OAuth successful for email: ${userInfo.data.email}`);
            // Determine if this is a login/signup flow or mailbox connection flow
            // Try to decode state as base64 JSON first (signup flow from SignupModal)
            let isSignupFlow = false;
            let signupStateData = null;
            if (state && state !== 'login') {
                try {
                    const decoded = Buffer.from(state, 'base64').toString('utf-8');
                    const parsed = JSON.parse(decoded);
                    // If it has redirect or plan properties, it's a signup flow from the frontend
                    if (parsed.redirect || parsed.plan) {
                        isSignupFlow = true;
                        signupStateData = parsed;
                        app.log.info(`[Google OAuth] Detected signup flow with state:`, signupStateData);
                    }
                }
                catch (e) {
                    // Not a base64 JSON - could be a mailbox connection state
                    app.log.info(`[Google OAuth] State is not base64 JSON, checking for mailbox connection flow`);
                }
            }
            // Check if this is a mailbox connection flow based on state parameter
            // If state is 'login' or isSignupFlow, it's a regular login/signup flow
            // Otherwise, it might be a mailbox connection with a Redis-stored state
            if (state && state !== 'login' && !isSignupFlow) {
                // This is a mailbox connection - validate the state and retrieve userId
                const userId = await validateOAuthState(state);
                if (!userId) {
                    app.log.error('Invalid or expired OAuth state parameter');
                    return reply.redirect(`${config_1.config.frontendUrl}/dashboard?error=oauth_failed&message=Invalid+or+expired+state`);
                }
                // Verify user exists
                const user = await prisma_1.prisma.user.findUnique({
                    where: { id: userId },
                });
                if (!user) {
                    app.log.error(`User not found for ID: ${userId}`);
                    return reply.redirect(`${config_1.config.frontendUrl}/dashboard?error=auth_required&message=User+not+found`);
                }
                // Calculate token expiry
                const expiresAt = tokens.expiry_date ? new Date(tokens.expiry_date) : undefined;
                // Check mailbox limit before creating
                app.log.info('Checking mailbox limit for user:', userId);
                const limitCheck = await usage_service_1.usageService.checkLimitExceeded(userId, 'mailboxes');
                if (limitCheck.exceeded) {
                    app.log.warn(`Mailbox limit exceeded for user ${userId}: ${limitCheck.currentUsage}/${limitCheck.limit}`);
                    // Get suggested plan for upgrade
                    const currentPlan = await prisma_1.prisma.subscription.findUnique({
                        where: { user_id: userId },
                        include: { plan_config: true },
                    });
                    const suggestedPlan = currentPlan?.plan_config?.name === 'free' ? 'starter' :
                        currentPlan?.plan_config?.name === 'starter' ? 'growth' : 'business';
                    return reply.redirect(`${config_1.config.frontendUrl}/dashboard?error=mailbox_limit_exceeded` +
                        `&current=${limitCheck.currentUsage}&limit=${limitCheck.limit}` +
                        `&suggestedPlan=${suggestedPlan}`);
                }
                // Store mailbox with encrypted tokens
                app.log.info('Storing mailbox credentials...');
                await mailboxService.createOrUpdateMailbox({
                    userId,
                    provider: 'gmail',
                    email: userInfo.data.email,
                    accessToken: tokens.access_token,
                    refreshToken: tokens.refresh_token,
                    expiresAt,
                });
                // Update mailbox count
                await usage_service_1.usageService.updateMailboxesCount(userId);
                app.log.info(`Mailbox count updated for user ${userId}`);
                app.log.info(`Gmail account ${userInfo.data.email} successfully connected for user ${userId}`);
                await (0, security_event_service_1.logSecurityEvent)({
                    eventType: 'mailbox_connected',
                    userId,
                    ipAddress: request.ip,
                    userAgent: request.headers['user-agent'] || '',
                    details: { provider: 'gmail', email: userInfo.data.email },
                });
                // After mailbox connection, trigger initial scan asynchronously
                app.log.info(`[Google] Scheduling initial scan in 2 seconds for ${userInfo.data.email}`);
                setTimeout(async () => {
                    app.log.info(`[Google] Timer fired - starting initial scan for ${userInfo.data.email}`);
                    try {
                        const { scanMailbox } = await Promise.resolve().then(() => __importStar(require('../../services/scanner.service')));
                        // Get the mailbox from the database to make sure it's saved
                        const mailbox = await prisma_1.prisma.mailbox.findFirst({
                            where: {
                                user_id: userId,
                                email_address: userInfo.data.email,
                                provider: 'gmail'
                            }
                        });
                        if (mailbox) {
                            app.log.info(`[Google] Found mailbox ${mailbox.id} - triggering initial scan for: ${userInfo.data.email}`);
                            const scanResult = await scanMailbox(mailbox.id, userId, {
                                maxResults: 50, // Scan first 50 messages in spam folder
                                afterDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
                            });
                            app.log.info(`[Google] Initial scan completed for ${userInfo.data.email}. Results:`, {
                                scannedCount: scanResult.scannedCount,
                                newMessages: scanResult.newMessages,
                                legitFound: scanResult.legitFound
                            });
                        }
                        else {
                            app.log.error(`[Google] Could not find created mailbox for user ${userId} and email ${userInfo.data.email}`);
                        }
                    }
                    catch (scanError) {
                        app.log.error(`[Google] Failed to perform initial scan after Gmail connection: ${scanError?.message || scanError}`);
                        // Don't fail the connection if initial scan fails
                    }
                }, 2000); // 2 second delay to ensure mailbox is saved before scanning
                // Redirect to dashboard with success
                return reply.redirect(`${config_1.config.frontendUrl}/dashboard?success=gmail_connected&email=${encodeURIComponent(userInfo.data.email)}`);
            }
            else {
                // This is a regular user authentication flow (login/signup)
                // Check if user exists
                const existingUser = await prisma_1.prisma.user.findUnique({
                    where: { email: userInfo.data.email },
                });
                let user;
                let isNewUser = false;
                if (existingUser) {
                    // User exists - login
                    user = existingUser;
                    app.log.info(`Existing user logging in: ${user.id}`);
                }
                else {
                    // New user - create account
                    isNewUser = true;
                    app.log.info(`Creating new user for: ${userInfo.data.email}`);
                    user = await prisma_1.prisma.user.create({
                        data: {
                            email: userInfo.data.email,
                            password_hash: '', // No password for OAuth users
                            role: 'member', // Explicitly set role to member (not owner/admin)
                            onboarding_completed: false, // New users need onboarding
                        },
                    });
                    // Grant trial subscription to new user
                    app.log.info(`Granting trial subscription to new user: ${user.id}`);
                    // Don't auto-grant trial - user will select plan first
                }
                // Use the already-decoded signupStateData if available
                const stateData = signupStateData;
                if (stateData) {
                    app.log.info(`[Google OAuth] Using signup state data:`, stateData);
                }
                // Determine redirect path: plan selection -> onboarding -> dashboard
                // Only require plan selection for truly new users who haven't selected a plan
                // Existing users with subscriptions or completed onboarding should skip plan selection
                const hasCompletedOnboarding = user.onboarding_completed === true;
                const hasPlanSelected = user.plan_selected === true;
                const needsPlanSelection = isNewUser && !hasPlanSelected;
                const needsOnboarding = !hasCompletedOnboarding && !hasPlanSelected;
                let redirectPath = '/dashboard';
                // If state has redirect/plan info, use that
                if (stateData?.redirect) {
                    redirectPath = stateData.redirect;
                    // Add plan parameter if provided
                    if (stateData.plan) {
                        redirectPath += `${redirectPath.includes('?') ? '&' : '?'}plan=${stateData.plan}`;
                    }
                }
                else if (needsPlanSelection) {
                    redirectPath = '/select-plan';
                }
                else if (needsOnboarding) {
                    redirectPath = '/onboarding';
                }
                app.log.info(`[Google OAuth] User ${user.id}: isNewUser=${isNewUser}, plan_selected=${user.plan_selected}, onboarding_completed=${user.onboarding_completed}, redirectPath=${redirectPath}`);
                // Track last login time
                await prisma_1.prisma.user.update({
                    where: { id: user.id },
                    data: { last_login_at: new Date() },
                });
                // Generate JWT tokens
                const accessToken = app.jwt.sign({ userId: user.id, email: user.email }, { expiresIn: config_1.config.jwt.accessTokenExpiry });
                const refreshToken = app.jwt.sign({ userId: user.id, email: user.email }, { expiresIn: config_1.config.jwt.refreshTokenExpiry });
                // Set cookies
                reply.setCookie('refreshToken', refreshToken, {
                    httpOnly: true,
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'lax',
                    maxAge: 7 * 24 * 60 * 60, // 7 days
                    path: '/',
                });
                reply.setCookie('accessToken', accessToken, {
                    httpOnly: true, // Prevent XSS from accessing token
                    secure: process.env.NODE_ENV === 'production',
                    sameSite: 'lax',
                    maxAge: 2 * 60 * 60, // 2 hours
                    path: '/',
                });
                // Create server-side session for proper session management
                // We need to await this to ensure the session is created before redirecting
                await session_service_1.SessionService.createSession(user.id, accessToken, request.headers['user-agent'], request.ip);
                app.log.info(`User ${user.id} authenticated successfully via Google`);
                // NOTE: Do NOT auto-connect Gmail mailbox during Google Login.
                // The login OAuth flow only requests userinfo.email + userinfo.profile scopes,
                // which are insufficient for Gmail API access (gmail.modify is required).
                // Auto-connecting with these tokens causes "Insufficient Permission" errors
                // when the scanner tries to read spam/promotions folders.
                // Users must explicitly connect Gmail via Dashboard > "Add Mailbox" flow,
                // which requests the correct gmail.modify scope.
                // Redirect based on onboarding status
                const separator = redirectPath.includes('?') ? '&' : '?';
                app.log.info(`[Google OAuth] Redirecting user ${user.id} to ${redirectPath} (needsOnboarding: ${needsOnboarding})`);
                const authCode = await generateAuthCode(accessToken);
                return reply.redirect(`${config_1.config.frontendUrl}${redirectPath}${separator}success=google_login&code=${encodeURIComponent(authCode)}&email=${encodeURIComponent(userInfo.data.email)}`);
            }
        }
        catch (error) {
            app.log.error(`Google OAuth callback error: ${error?.message || error}`);
            return reply.redirect(`${config_1.config.frontendUrl}/auth/login?error=oauth_failed&message=${encodeURIComponent(error.message)}`);
        }
    });
    /**
     * Gmail OAuth - Start authentication flow (for connecting mailbox)
     * GET /api/auth/gmail?token=...
     */
    app.get('/gmail', async (request, reply) => {
        try {
            // Validate OAuth configuration
            if (!config_1.config.oauth.google.clientId || !config_1.config.oauth.google.clientSecret || !config_1.config.oauth.google.redirectUri) {
                app.log.error('Gmail OAuth not configured - missing credentials');
                return reply.redirect(`${config_1.config.frontendUrl}/dashboard?error=oauth_not_configured&message=Gmail+OAuth+is+not+configured+on+the+server`);
            }
            const { token } = request.query;
            // Verify the token and get user ID
            if (!token) {
                app.log.warn('No token provided in Gmail OAuth start');
                return reply.redirect(`${config_1.config.frontendUrl}/auth/login?error=auth_required&message=Please+log+in+first+to+connect+Gmail`);
            }
            let userId;
            try {
                const decoded = app.jwt.verify(token);
                userId = decoded.userId;
                if (!userId) {
                    app.log.error('Token verified but no userId found');
                    return reply.redirect(`${config_1.config.frontendUrl}/auth/login?error=auth_required&message=Invalid+authentication+token`);
                }
                app.log.info('Gmail OAuth start - user authenticated:', userId);
            }
            catch (error) {
                app.log.error(`Invalid token in Gmail OAuth start: ${error.message}`);
                return reply.redirect(`${config_1.config.frontendUrl}/auth/login?error=auth_required&message=Please+log+in+first+to+connect+Gmail`);
            }
            // IMPORTANT: Must use the Gmail-specific callback URL, NOT config.oauth.google.redirectUri
            // which points to /api/auth/google/callback (the login handler).
            // Using the wrong redirect URI causes Google to send users back to the login
            // handler, which never creates/updates the mailbox with gmail.modify tokens.
            const gmailCallbackUrl = `${config_1.config.apiUrl}/api/auth/gmail/callback`;
            const oauth2Client = new googleapis_1.google.auth.OAuth2(config_1.config.oauth.google.clientId, config_1.config.oauth.google.clientSecret, gmailCallbackUrl);
            const scopes = [
                'https://www.googleapis.com/auth/gmail.modify', // Read, modify, trash (no permanent delete)
                'https://www.googleapis.com/auth/userinfo.email',
                'https://www.googleapis.com/auth/userinfo.profile',
            ];
            // Generate random state and store userId in cache
            const state = await generateOAuthState(userId);
            // Get authorization URL with random state parameter
            const authUrl = oauth2Client.generateAuthUrl({
                access_type: 'offline',
                scope: scopes,
                prompt: 'consent', // Force consent screen to get refresh token AND gmail.modify scope
                state: state, // Pass random state parameter for security
                include_granted_scopes: true, // Include previously-granted scopes
            });
            // Debug: log the full auth URL to verify prompt=consent and gmail.modify scope are present
            app.log.info(`[Gmail OAuth] Auth URL generated: ${authUrl}`);
            app.log.info(`Redirecting to Google OAuth for user ${userId} with state: ${state}`);
            return reply.redirect(authUrl);
        }
        catch (error) {
            app.log.error(`Gmail OAuth start error: ${error?.message || error}`);
            return reply.redirect(`${config_1.config.frontendUrl}/dashboard?error=oauth_failed&message=Failed+to+start+Gmail+authentication`);
        }
    });
    /**
     * Gmail OAuth - Handle callback
     * GET /api/auth/gmail/callback
     */
    app.get('/gmail/callback', {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        try {
            const { code, error, state } = request.query;
            // Handle OAuth errors
            if (error) {
                app.log.warn('User denied Gmail OAuth:', error);
                return reply.redirect(`${config_1.config.frontendUrl}/dashboard?error=oauth_denied&message=You+denied+access+to+Gmail`);
            }
            if (!code) {
                app.log.error('No authorization code received from Google');
                return reply.redirect(`${config_1.config.frontendUrl}/dashboard?error=missing_code&message=No+authorization+code+received`);
            }
            // Get userId from OAuth state parameter (stored in Redis by /api/auth/gmail)
            const userId = await validateOAuthState(state);
            if (!userId) {
                app.log.error('Invalid or expired OAuth state parameter for Gmail callback');
                return reply.redirect(`${config_1.config.frontendUrl}/dashboard?error=oauth_failed&message=Invalid+or+expired+state.+Please+try+again`);
            }
            app.log.info('Gmail OAuth callback - processing for user:', userId);
            // Validate OAuth configuration
            if (!config_1.config.oauth.google.clientId || !config_1.config.oauth.google.clientSecret) {
                app.log.error('Gmail OAuth not configured during callback');
                return reply.redirect(`${config_1.config.frontendUrl}/dashboard?error=oauth_not_configured&message=Gmail+OAuth+is+not+configured+on+the+server`);
            }
            // IMPORTANT: Must match the redirect URI used in the /api/auth/gmail initiation
            const gmailCallbackUrl = `${config_1.config.apiUrl}/api/auth/gmail/callback`;
            // Exchange code for tokens
            const oauth2Client = new googleapis_1.google.auth.OAuth2(config_1.config.oauth.google.clientId, config_1.config.oauth.google.clientSecret, gmailCallbackUrl);
            app.log.info(`Exchanging authorization code for tokens using redirect URI: ${gmailCallbackUrl}`);
            const { tokens } = await oauth2Client.getToken(code);
            // Log granted scopes to verify gmail.modify was included
            app.log.info(`[Gmail OAuth] Token scopes granted: ${tokens.scope || 'none reported'}`);
            if (tokens.scope && !tokens.scope.includes('gmail.modify')) {
                app.log.error(`[Gmail OAuth] CRITICAL: gmail.modify scope NOT granted! Scopes: ${tokens.scope}`);
                return reply.redirect(`${config_1.config.frontendUrl}/dashboard?error=insufficient_scopes&message=Gmail+did+not+grant+mail+access+permission.+Please+try+again+and+accept+all+permissions.`);
            }
            if (!tokens.access_token) {
                app.log.error('No access token received from Google');
                return reply.redirect(`${config_1.config.frontendUrl}/dashboard?error=missing_tokens&message=Failed+to+get+access+token`);
            }
            if (!tokens.refresh_token) {
                app.log.error('No refresh token received from Google');
                return reply.redirect(`${config_1.config.frontendUrl}/dashboard?error=missing_tokens&message=Failed+to+get+refresh+token.+Try+disconnecting+and+reconnecting`);
            }
            // Set credentials
            oauth2Client.setCredentials(tokens);
            // Verify Gmail API access BEFORE storing the mailbox.
            // This catches: Gmail API not enabled, user unchecked Gmail permission on
            // consent screen (granular permissions), or scope not actually granted.
            app.log.info('[Gmail OAuth] Verifying Gmail API access with new tokens...');
            try {
                const testGmail = googleapis_1.google.gmail({ version: 'v1', auth: oauth2Client });
                await testGmail.users.labels.list({ userId: 'me' });
                app.log.info('[Gmail OAuth] Gmail API access verified successfully');
            }
            catch (gmailTestError) {
                app.log.error(`[Gmail OAuth] Gmail API access FAILED: ${gmailTestError.message}`);
                const isPermError = gmailTestError.message?.includes('Insufficient Permission') ||
                    gmailTestError.code === 403;
                if (isPermError) {
                    return reply.redirect(`${config_1.config.frontendUrl}/dashboard?error=insufficient_scopes&message=${encodeURIComponent('Gmail did not grant mail access permission. Please ensure the Gmail API is enabled in Google Cloud Console and you accepted all permissions on the consent screen.')}`);
                }
                // Non-permission error — log but continue (might be transient)
                app.log.warn(`[Gmail OAuth] Non-permission error during Gmail API test: ${gmailTestError.message}`);
            }
            // Get user info from Google
            app.log.info('Fetching user info from Google...');
            const oauth2 = googleapis_1.google.oauth2({ version: 'v2', auth: oauth2Client });
            const userInfo = await oauth2.userinfo.get();
            if (!userInfo.data.email) {
                app.log.error('No email in Google user info');
                return reply.redirect(`${config_1.config.frontendUrl}/dashboard?error=missing_email&message=Could+not+get+email+from+Google`);
            }
            app.log.info(`Gmail OAuth successful for email: ${userInfo.data.email}`);
            // Calculate token expiry
            const expiresAt = tokens.expiry_date ? new Date(tokens.expiry_date) : undefined;
            // Store mailbox with encrypted tokens
            app.log.info('Storing mailbox credentials...');
            await mailboxService.createOrUpdateMailbox({
                userId,
                provider: 'gmail',
                email: userInfo.data.email,
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                expiresAt,
            });
            app.log.info(`Gmail account ${userInfo.data.email} successfully connected for user ${userId}`);
            // Log security event for mailbox connection
            await (0, security_event_service_1.logSecurityEvent)({
                eventType: 'mailbox_connected',
                userId,
                ipAddress: request.ip,
                userAgent: request.headers['user-agent'] || '',
                details: { provider: 'gmail', email: userInfo.data.email },
            });
            // After mailbox connection, trigger initial scan asynchronously
            app.log.info(`[Gmail] Scheduling initial scan in 2 seconds for ${userInfo.data.email}`);
            setTimeout(async () => {
                app.log.info(`[Gmail] Timer fired - starting initial scan for ${userInfo.data.email}`);
                try {
                    const { scanMailbox } = await Promise.resolve().then(() => __importStar(require('../../services/scanner.service')));
                    // Get the mailbox from the database to make sure it's saved
                    const mailbox = await prisma_1.prisma.mailbox.findFirst({
                        where: {
                            user_id: userId,
                            email_address: userInfo.data.email,
                            provider: 'gmail'
                        }
                    });
                    if (mailbox) {
                        app.log.info(`[Gmail] Found mailbox ${mailbox.id} - triggering initial scan for: ${userInfo.data.email}`);
                        const scanResult = await scanMailbox(mailbox.id, userId, {
                            maxResults: 50, // Scan first 50 messages in spam folder
                            afterDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
                        });
                        app.log.info(`[Gmail] Initial scan completed for ${userInfo.data.email}. Results:`, {
                            scannedCount: scanResult.scannedCount,
                            newMessages: scanResult.newMessages,
                            legitFound: scanResult.legitFound
                        });
                    }
                    else {
                        app.log.error(`[Gmail] Could not find created mailbox for user ${userId} and email ${userInfo.data.email}`);
                    }
                }
                catch (scanError) {
                    app.log.error(`[Gmail] Failed to perform initial scan after Gmail connection: ${scanError?.message || scanError}`);
                    // Don't fail the connection if initial scan fails
                }
            }, 2000); // 2 second delay to ensure mailbox is saved before scanning
            // Redirect to dashboard with success
            return reply.redirect(`${config_1.config.frontendUrl}/dashboard?success=gmail_connected&email=${encodeURIComponent(userInfo.data.email)}`);
        }
        catch (error) {
            // Check if this is a mailbox limit error
            if (error.message?.includes('MAILBOX_LIMIT_REACHED')) {
                app.log.warn(`Mailbox limit reached during Gmail connect`);
                return reply.redirect(`${config_1.config.frontendUrl}/dashboard?error=mailbox_limit_exceeded`);
            }
            app.log.error(`Gmail OAuth callback error: ${error?.message || error}`);
            const errorMessage = error.message || 'Unknown error occurred';
            return reply.redirect(`${config_1.config.frontendUrl}/dashboard?error=oauth_failed&message=${encodeURIComponent(errorMessage)}`);
        }
    });
    /**
     * Microsoft OAuth - User Login/Signup
     * GET /api/auth/microsoft?state=<encoded_redirect_info>
     */
    app.get('/microsoft', async (request, reply) => {
        try {
            // Validate OAuth configuration
            if (!config_1.config.oauth.microsoft.clientId || !config_1.config.oauth.microsoft.clientSecret) {
                app.log.error('Microsoft OAuth not configured');
                return reply.redirect(`${config_1.config.frontendUrl}/auth/login?error=oauth_not_configured`);
            }
            // Microsoft OAuth 2.0 authorization endpoint
            const authUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
            // Get state from query params (contains redirect and plan info from frontend)
            const { state } = request.query;
            const oauthState = state || 'login'; // Default to 'login' if no state provided
            authUrl.searchParams.append('client_id', config_1.config.oauth.microsoft.clientId);
            authUrl.searchParams.append('response_type', 'code');
            authUrl.searchParams.append('redirect_uri', `${config_1.config.apiUrl}/api/auth/outlook/callback`);
            authUrl.searchParams.append('response_mode', 'query');
            authUrl.searchParams.append('scope', 'openid profile email User.Read Mail.Read offline_access');
            authUrl.searchParams.append('state', oauthState); // Pass the state parameter through
            app.log.info('Redirecting to Microsoft OAuth for user login');
            return reply.redirect(authUrl.toString());
        }
        catch (error) {
            app.log.error(`Microsoft OAuth start error: ${error?.message || error}`);
            return reply.redirect(`${config_1.config.frontendUrl}/auth/login?error=oauth_failed`);
        }
    });
    /**
     * Microsoft OAuth - Handle Login/Signup Callback
     * GET /api/auth/microsoft/callback
     */
    app.get('/microsoft/callback', {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        try {
            const { code, error, error_description, state } = request.query;
            if (error) {
                app.log.warn('User denied Microsoft OAuth:', error, error_description);
                return reply.redirect(`${config_1.config.frontendUrl}/auth/login?error=oauth_denied`);
            }
            if (!code) {
                app.log.error('No authorization code from Microsoft');
                return reply.redirect(`${config_1.config.frontendUrl}/auth/login?error=missing_code`);
            }
            // Validate OAuth configuration
            if (!config_1.config.oauth.microsoft.clientId || !config_1.config.oauth.microsoft.clientSecret) {
                app.log.error('Microsoft OAuth not configured');
                return reply.redirect(`${config_1.config.frontendUrl}/auth/login?error=oauth_not_configured`);
            }
            // Exchange code for tokens
            app.log.info('Exchanging code for Microsoft tokens...');
            const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
            const tokenParams = new URLSearchParams({
                client_id: config_1.config.oauth.microsoft.clientId,
                client_secret: config_1.config.oauth.microsoft.clientSecret,
                code,
                redirect_uri: `${config_1.config.apiUrl}/api/auth/outlook/callback`,
                grant_type: 'authorization_code',
            });
            const tokenResponse = await fetch(tokenUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: tokenParams.toString(),
            });
            if (!tokenResponse.ok) {
                const errorData = await tokenResponse.text();
                app.log.error(`Microsoft token exchange failed: ${errorData?.message || errorData}`);
                return reply.redirect(`${config_1.config.frontendUrl}/auth/login?error=token_exchange_failed`);
            }
            const tokens = await tokenResponse.json();
            // Get user info from Microsoft Graph
            app.log.info('Fetching user info from Microsoft Graph...');
            const userInfoResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
                headers: {
                    'Authorization': `Bearer ${tokens.access_token}`,
                },
            });
            if (!userInfoResponse.ok) {
                const errorText = await userInfoResponse.text();
                app.log.error('Failed to fetch Microsoft user info:', JSON.stringify({
                    status: userInfoResponse.status,
                    statusText: userInfoResponse.statusText,
                    error: errorText,
                }));
                return reply.redirect(`${config_1.config.frontendUrl}/auth/login?error=missing_user_info`);
            }
            const userInfo = await userInfoResponse.json();
            app.log.info('Microsoft user info received:', { email: userInfo.mail || userInfo.userPrincipalName });
            if (!userInfo.mail && !userInfo.userPrincipalName) {
                app.log.error('No email in Microsoft user info');
                return reply.redirect(`${config_1.config.frontendUrl}/auth/login?error=missing_email`);
            }
            const email = userInfo.mail || userInfo.userPrincipalName;
            app.log.info(`Microsoft OAuth successful for email: ${email}`);
            // Check if user exists
            const existingUser = await prisma_1.prisma.user.findUnique({
                where: { email },
            });
            let user;
            let isNewUser = false;
            if (existingUser) {
                // User exists - login
                user = existingUser;
                app.log.info(`Existing user logging in: ${user.id}`);
            }
            else {
                // New user - create account
                isNewUser = true;
                app.log.info(`Creating new user for: ${email}`);
                user = await prisma_1.prisma.user.create({
                    data: {
                        email,
                        password_hash: '', // No password for OAuth users
                        name: userInfo.displayName || undefined,
                        role: 'member', // Explicitly set role to member (not owner/admin)
                        onboarding_completed: false, // New users need onboarding
                    },
                });
                // Don't auto-grant trial - user will select plan first
            }
            // Check if state contains redirect/plan info from registration page
            let stateData = null;
            if (state && state !== 'login') {
                try {
                    // Decode state parameter (base64 encoded JSON from frontend)
                    const decoded = Buffer.from(state, 'base64').toString('utf-8');
                    stateData = JSON.parse(decoded);
                    app.log.info(`[Microsoft OAuth] Decoded state:`, stateData);
                }
                catch (e) {
                    app.log.warn(`[Microsoft OAuth] Failed to decode state parameter:`, e);
                }
            }
            // Determine redirect path: plan selection -> onboarding -> dashboard
            // Only require plan selection for truly new users who haven't selected a plan
            const hasCompletedOnboarding = user.onboarding_completed === true;
            const hasPlanSelected = user.plan_selected === true;
            const needsPlanSelection = isNewUser && !hasPlanSelected;
            const needsOnboarding = !hasCompletedOnboarding;
            let redirectPath = '/dashboard';
            // If state has redirect/plan info, use that
            if (stateData?.redirect) {
                redirectPath = stateData.redirect;
                // Add plan parameter if provided
                if (stateData.plan) {
                    redirectPath += `${redirectPath.includes('?') ? '&' : '?'}plan=${stateData.plan}`;
                }
            }
            else if (needsPlanSelection) {
                redirectPath = '/select-plan';
            }
            else if (needsOnboarding) {
                redirectPath = '/onboarding';
            }
            app.log.info(`[Microsoft OAuth] User ${user.id}: isNewUser=${isNewUser}, plan_selected=${user.plan_selected}, onboarding_completed=${user.onboarding_completed}, redirectPath=${redirectPath}`);
            // Generate JWT tokens
            const accessToken = app.jwt.sign({ userId: user.id, email: user.email }, { expiresIn: config_1.config.jwt.accessTokenExpiry });
            const refreshToken = app.jwt.sign({ userId: user.id, type: 'refresh' }, { expiresIn: '7d' });
            // Set tokens as httpOnly cookies
            reply.setCookie('accessToken', accessToken, {
                httpOnly: true, // Prevent XSS from accessing token
                secure: config_1.config.env === 'production',
                sameSite: 'lax',
                maxAge: 2 * 60 * 60,
                path: '/',
            });
            reply.setCookie('refreshToken', refreshToken, {
                httpOnly: true,
                secure: config_1.config.env === 'production',
                sameSite: 'lax',
                maxAge: 7 * 24 * 60 * 60,
                path: '/',
            });
            reply.setCookie('accessToken', accessToken, {
                httpOnly: true, // Prevent XSS from accessing token
                secure: config_1.config.env === 'production',
                sameSite: 'lax',
                maxAge: 2 * 60 * 60, // 2 hours
                path: '/',
            });
            // Create server-side session for proper session management
            await session_service_1.SessionService.createSession(user.id, accessToken, request.headers['user-agent'], request.ip);
            app.log.info(`User ${user.id} authenticated successfully via Microsoft`);
            // Create Outlook mailbox for the user
            try {
                const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000);
                await mailboxService.createOrUpdateMailbox({
                    userId: user.id,
                    provider: 'outlook',
                    email,
                    accessToken: tokens.access_token,
                    refreshToken: tokens.refresh_token,
                    expiresAt,
                });
                app.log.info(`Outlook mailbox created/updated for user ${user.id}: ${email}`);
                // Redirect based on onboarding status with auth code and auto-scan trigger
                const separator = redirectPath.includes('?') ? '&' : '?';
                app.log.info(`Redirecting user ${user.id} to ${redirectPath} (needsOnboarding: ${needsOnboarding})`);
                const authCode = await generateAuthCode(accessToken);
                return reply.redirect(`${config_1.config.frontendUrl}${redirectPath}${separator}success=microsoft_login&code=${encodeURIComponent(authCode)}&outlook_connected=true&email=${encodeURIComponent(email)}`);
            }
            catch (mailboxError) {
                // Check if this is a mailbox limit error
                if (mailboxError.message?.includes('MAILBOX_LIMIT_REACHED')) {
                    app.log.warn(`Mailbox limit reached for user ${user.id} during Outlook auto-connect`);
                    const separator = redirectPath.includes('?') ? '&' : '?';
                    const authCode2 = await generateAuthCode(accessToken);
                    return reply.redirect(`${config_1.config.frontendUrl}${redirectPath}${separator}success=microsoft_login&code=${encodeURIComponent(authCode2)}&error=mailbox_limit_exceeded`);
                }
                app.log.error(`Failed to create Outlook mailbox: ${mailboxError?.message || mailboxError}`);
                // Still redirect with login success, but without auto-scan
                const separator = redirectPath.includes('?') ? '&' : '?';
                const authCode3 = await generateAuthCode(accessToken);
                return reply.redirect(`${config_1.config.frontendUrl}${redirectPath}${separator}success=microsoft_login&code=${encodeURIComponent(authCode3)}&warning=mailbox_connection_failed`);
            }
        }
        catch (error) {
            app.log.error('Microsoft OAuth callback error:', error);
            return reply.redirect(`${config_1.config.frontendUrl}/auth/login?error=oauth_failed&message=${encodeURIComponent(error.message)}`);
        }
    });
    /**
     * Yahoo OAuth - User Login/Signup
     * GET /api/auth/yahoo
     */
    app.get('/yahoo', async (request, reply) => {
        try {
            // Validate OAuth configuration
            if (!config_1.config.oauth.yahoo.clientId || !config_1.config.oauth.yahoo.clientSecret) {
                app.log.error('Yahoo OAuth not configured');
                return reply.redirect(`${config_1.config.frontendUrl}/auth/login?error=oauth_not_configured`);
            }
            // Yahoo OAuth 2.0 authorization endpoint
            const authUrl = new URL('https://api.login.yahoo.com/oauth2/request_auth');
            authUrl.searchParams.append('client_id', config_1.config.oauth.yahoo.clientId);
            authUrl.searchParams.append('response_type', 'code');
            authUrl.searchParams.append('redirect_uri', config_1.config.oauth.yahoo.redirectUri);
            authUrl.searchParams.append('scope', 'openid email profile');
            authUrl.searchParams.append('state', 'login');
            app.log.info('Redirecting to Yahoo OAuth for user login');
            return reply.redirect(authUrl.toString());
        }
        catch (error) {
            app.log.error(`Yahoo OAuth start error: ${error?.message || error}`);
            return reply.redirect(`${config_1.config.frontendUrl}/auth/login?error=oauth_failed`);
        }
    });
    /**
     * Yahoo OAuth - Handle Login/Signup Callback
     * GET /api/auth/yahoo/callback
     */
    app.get('/yahoo/callback', {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        try {
            const { code, error, error_description } = request.query;
            if (error) {
                app.log.warn('User denied Yahoo OAuth:', error, error_description);
                return reply.redirect(`${config_1.config.frontendUrl}/auth/login?error=oauth_denied`);
            }
            if (!code) {
                app.log.error('No authorization code from Yahoo');
                return reply.redirect(`${config_1.config.frontendUrl}/auth/login?error=missing_code`);
            }
            // Validate OAuth configuration
            if (!config_1.config.oauth.yahoo.clientId || !config_1.config.oauth.yahoo.clientSecret) {
                app.log.error('Yahoo OAuth not configured');
                return reply.redirect(`${config_1.config.frontendUrl}/auth/login?error=oauth_not_configured`);
            }
            // Exchange code for tokens
            app.log.info('Exchanging code for Yahoo tokens...');
            const tokenUrl = 'https://api.login.yahoo.com/oauth2/get_token';
            // Yahoo requires Basic Auth with client credentials
            const credentials = Buffer.from(`${config_1.config.oauth.yahoo.clientId}:${config_1.config.oauth.yahoo.clientSecret}`).toString('base64');
            const tokenParams = new URLSearchParams({
                code,
                redirect_uri: config_1.config.oauth.yahoo.redirectUri,
                grant_type: 'authorization_code',
            });
            const tokenResponse = await fetch(tokenUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': `Basic ${credentials}`,
                },
                body: tokenParams.toString(),
            });
            if (!tokenResponse.ok) {
                const errorData = await tokenResponse.text();
                app.log.error(`Yahoo token exchange failed: ${errorData?.message || errorData}`);
                return reply.redirect(`${config_1.config.frontendUrl}/auth/login?error=token_exchange_failed`);
            }
            const tokens = await tokenResponse.json();
            // Get user info from Yahoo
            app.log.info('Fetching user info from Yahoo...');
            const userInfoResponse = await fetch('https://api.login.yahoo.com/openid/v1/userinfo', {
                headers: {
                    'Authorization': `Bearer ${tokens.access_token}`,
                },
            });
            if (!userInfoResponse.ok) {
                app.log.error('Failed to fetch Yahoo user info');
                return reply.redirect(`${config_1.config.frontendUrl}/auth/login?error=missing_user_info`);
            }
            const userInfo = await userInfoResponse.json();
            if (!userInfo.email) {
                app.log.error('No email in Yahoo user info');
                return reply.redirect(`${config_1.config.frontendUrl}/auth/login?error=missing_email`);
            }
            const email = userInfo.email;
            app.log.info(`Yahoo OAuth successful for email: ${email}`);
            // Check if user exists
            const existingUser = await prisma_1.prisma.user.findUnique({
                where: { email },
            });
            let user;
            if (existingUser) {
                // User exists - login
                user = existingUser;
                app.log.info(`Existing user logging in: ${user.id}`);
            }
            else {
                // New user - create account
                app.log.info(`Creating new user for: ${email}`);
                user = await prisma_1.prisma.user.create({
                    data: {
                        email,
                        password_hash: '', // No password for OAuth users
                        name: userInfo.name || userInfo.given_name || undefined,
                        role: 'member', // Explicitly set role to member (not owner/admin)
                    },
                });
                // Don't auto-grant trial - user will select plan first
            }
            // Determine redirect path: plan selection -> onboarding -> dashboard
            const isNewUser = !existingUser;
            const hasCompletedOnboarding = user.onboarding_completed === true;
            const hasPlanSelected = user.plan_selected === true;
            const needsPlanSelection = isNewUser && !hasPlanSelected;
            const needsOnboarding = !hasCompletedOnboarding;
            let redirectPath = '/dashboard';
            if (needsPlanSelection) {
                redirectPath = '/select-plan';
            }
            else if (needsOnboarding) {
                redirectPath = '/onboarding';
            }
            app.log.info(`[Yahoo OAuth] User ${user.id}: isNewUser=${isNewUser}, plan_selected=${user.plan_selected}, onboarding_completed=${user.onboarding_completed}, redirectPath=${redirectPath}`);
            // Generate JWT tokens
            const accessToken = app.jwt.sign({ userId: user.id, email: user.email }, { expiresIn: config_1.config.jwt.accessTokenExpiry });
            const refreshToken = app.jwt.sign({ userId: user.id, type: 'refresh' }, { expiresIn: '7d' });
            // Set tokens as httpOnly cookies
            reply.setCookie('accessToken', accessToken, {
                httpOnly: true, // Prevent XSS from accessing token
                secure: config_1.config.env === 'production',
                sameSite: 'lax',
                maxAge: 2 * 60 * 60,
                path: '/',
            });
            reply.setCookie('refreshToken', refreshToken, {
                httpOnly: true,
                secure: config_1.config.env === 'production',
                sameSite: 'lax',
                maxAge: 7 * 24 * 60 * 60,
                path: '/',
            });
            // Create server-side session for proper session management
            await session_service_1.SessionService.createSession(user.id, accessToken, request.headers['user-agent'], request.ip);
            app.log.info(`User ${user.id} authenticated successfully via Yahoo`);
            // Automatically connect the Yahoo mailbox during login
            try {
                // Note: Yahoo may not provide refresh tokens in all situations
                const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : undefined;
                await mailboxService.createOrUpdateMailbox({
                    userId: user.id,
                    provider: 'yahoo',
                    email,
                    accessToken: tokens.access_token,
                    refreshToken: tokens.refresh_token || null, // May not be provided
                    expiresAt,
                });
                app.log.info(`Yahoo account ${email} automatically connected for user ${user.id}`);
                // Redirect based on user status with auth code
                const authCode = await generateAuthCode(accessToken);
                return reply.redirect(`${config_1.config.frontendUrl}${redirectPath}?success=yahoo_login&code=${encodeURIComponent(authCode)}&yahoo_connected=true&email=${encodeURIComponent(email)}`);
            }
            catch (mailboxError) {
                // Check if this is a mailbox limit error
                if (mailboxError.message?.includes('MAILBOX_LIMIT_REACHED')) {
                    app.log.warn(`Mailbox limit reached for user ${user.id} during Yahoo auto-connect`);
                    const authCode2 = await generateAuthCode(accessToken);
                    return reply.redirect(`${config_1.config.frontendUrl}${redirectPath}?success=yahoo_login&code=${encodeURIComponent(authCode2)}&error=mailbox_limit_exceeded`);
                }
                app.log.error(`Failed to automatically connect Yahoo mailbox: ${mailboxError?.message || mailboxError}`);
                // Proceed with login even if mailbox connection fails
                const authCode3 = await generateAuthCode(accessToken);
                return reply.redirect(`${config_1.config.frontendUrl}${redirectPath}?success=logged_in&code=${encodeURIComponent(authCode3)}&warning=yahoo_connection_failed`);
            }
        }
        catch (error) {
            app.log.error(`Yahoo OAuth callback error: ${error?.message || error}`);
            return reply.redirect(`${config_1.config.frontendUrl}/auth/login?error=oauth_failed&message=${encodeURIComponent(error.message)}`);
        }
    });
    /**
     * Outlook OAuth - Start authentication flow (for connecting mailbox)
     * GET /api/auth/outlook?token=...
     */
    app.get('/outlook', async (request, reply) => {
        try {
            // Validate OAuth configuration
            if (!config_1.config.oauth.microsoft.clientId || !config_1.config.oauth.microsoft.clientSecret) {
                app.log.error('Outlook OAuth not configured');
                return reply.redirect(`${config_1.config.frontendUrl}/dashboard?error=oauth_not_configured&message=Outlook+OAuth+is+not+configured`);
            }
            const { token } = request.query;
            // Verify the token and get user ID
            if (!token) {
                app.log.warn('No token provided in Outlook OAuth start');
                return reply.redirect(`${config_1.config.frontendUrl}/auth/login?error=auth_required&message=Please+log+in+first`);
            }
            let userId;
            try {
                const decoded = app.jwt.verify(token);
                app.log.info('Decoded JWT payload:', JSON.stringify(decoded));
                userId = decoded.userId;
                if (!userId) {
                    app.log.error('Token verified but no userId found in payload');
                    app.log.error(`Available fields: ${Object.keys(decoded).join(', ')}`);
                    return reply.redirect(`${config_1.config.frontendUrl}/auth/login?error=auth_required&message=Invalid+token`);
                }
                app.log.info('Outlook OAuth start - user authenticated:', userId);
                app.log.info('userId type:', typeof userId, 'length:', userId.length);
            }
            catch (error) {
                app.log.error(`Invalid token in Outlook OAuth start: ${error.message}`);
                return reply.redirect(`${config_1.config.frontendUrl}/auth/login?error=auth_required&message=Please+log+in+first`);
            }
            // Generate random state and store userId in cache
            const state = await generateOAuthState(userId);
            // Microsoft OAuth 2.0 authorization endpoint
            const authUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
            authUrl.searchParams.append('client_id', config_1.config.oauth.microsoft.clientId);
            authUrl.searchParams.append('response_type', 'code');
            authUrl.searchParams.append('redirect_uri', `${config_1.config.apiUrl}/api/auth/outlook/callback`);
            authUrl.searchParams.append('response_mode', 'query');
            authUrl.searchParams.append('scope', 'openid profile email offline_access Mail.Read Mail.ReadWrite');
            authUrl.searchParams.append('state', state);
            authUrl.searchParams.append('prompt', 'consent');
            app.log.info(`Redirecting to Microsoft OAuth for Outlook mailbox - user ${userId} with state: ${state}`);
            return reply.redirect(authUrl.toString());
        }
        catch (error) {
            app.log.error(`Outlook OAuth start error: ${error?.message || error}`);
            return reply.redirect(`${config_1.config.frontendUrl}/dashboard?error=oauth_failed&message=Failed+to+start+Outlook+authentication`);
        }
    });
    /**
     * Outlook OAuth - Handle callback
     * GET /api/auth/outlook/callback
     */
    app.get('/outlook/callback', {
        config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
    }, async (request, reply) => {
        try {
            const { code, error, error_description, state } = request.query;
            // Handle OAuth errors
            if (error) {
                app.log.warn('User denied Outlook OAuth:', error, error_description);
                return reply.redirect(`${config_1.config.frontendUrl}/dashboard?error=oauth_denied&message=You+denied+access+to+Outlook`);
            }
            if (!code) {
                app.log.error('No authorization code from Outlook');
                return reply.redirect(`${config_1.config.frontendUrl}/dashboard?error=missing_code&message=No+authorization+code+received`);
            }
            if (!state) {
                app.log.error('No state parameter from Outlook');
                return reply.redirect(`${config_1.config.frontendUrl}/dashboard?error=missing_state&message=Missing+user+state`);
            }
            // Determine if this is a login/signup flow or mailbox connection flow
            // Try to decode state as base64 JSON first (signup flow from SignupModal)
            let isSignupFlow = false;
            let signupStateData = null;
            if (state && state !== 'login') {
                try {
                    const decoded = Buffer.from(state, 'base64').toString('utf-8');
                    const parsed = JSON.parse(decoded);
                    // If it has redirect or plan properties, it's a signup flow from the frontend
                    if (parsed.redirect || parsed.plan) {
                        isSignupFlow = true;
                        signupStateData = parsed;
                        app.log.info(`[Outlook OAuth] Detected signup flow with state:`, signupStateData);
                    }
                }
                catch (e) {
                    // Not a base64 JSON - could be a mailbox connection state
                    app.log.info(`[Outlook OAuth] State is not base64 JSON, checking for mailbox connection flow`);
                }
            }
            // Check if this is a login flow or mailbox connection flow
            const isLoginFlow = state === 'login' || isSignupFlow;
            // Validate the state and retrieve userId (only for mailbox connection)
            let userId = null;
            if (!isLoginFlow) {
                userId = await validateOAuthState(state);
                if (!userId) {
                    app.log.error('Invalid or expired OAuth state parameter');
                    return reply.redirect(`${config_1.config.frontendUrl}/dashboard?error=oauth_failed&message=Invalid+or+expired+state`);
                }
            }
            app.log.info('Outlook OAuth callback - received state:', state);
            if (!isLoginFlow && userId) {
                app.log.info('userId extracted from state:', userId);
                app.log.info('userId type:', typeof userId, 'length:', userId.length, 'first char:', userId[0]);
            }
            // Validate OAuth configuration
            if (!config_1.config.oauth.microsoft.clientId || !config_1.config.oauth.microsoft.clientSecret) {
                app.log.error('Outlook OAuth not configured');
                return reply.redirect(`${config_1.config.frontendUrl}/dashboard?error=oauth_not_configured`);
            }
            // Exchange code for tokens
            app.log.info('Exchanging code for Outlook tokens...');
            const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
            const tokenParams = new URLSearchParams({
                client_id: config_1.config.oauth.microsoft.clientId,
                client_secret: config_1.config.oauth.microsoft.clientSecret,
                code,
                redirect_uri: `${config_1.config.apiUrl}/api/auth/outlook/callback`,
                grant_type: 'authorization_code',
            });
            const tokenResponse = await fetch(tokenUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
                body: tokenParams.toString(),
            });
            if (!tokenResponse.ok) {
                const errorData = await tokenResponse.text();
                app.log.error(`Outlook token exchange failed: ${errorData?.message || errorData}`);
                return reply.redirect(`${config_1.config.frontendUrl}/dashboard?error=token_exchange_failed&message=Failed+to+get+access+token`);
            }
            const tokens = await tokenResponse.json();
            if (!tokens.refresh_token) {
                app.log.error('No refresh token received from Outlook');
                return reply.redirect(`${config_1.config.frontendUrl}/dashboard?error=missing_tokens&message=Failed+to+get+refresh+token`);
            }
            // Get user info from Microsoft Graph
            app.log.info('Fetching user info from Microsoft Graph...');
            const userInfoResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
                headers: {
                    'Authorization': `Bearer ${tokens.access_token}`,
                },
            });
            if (!userInfoResponse.ok) {
                app.log.error('Failed to fetch Outlook user info');
                return reply.redirect(`${config_1.config.frontendUrl}/dashboard?error=missing_user_info&message=Could+not+get+email+from+Outlook`);
            }
            const userInfo = await userInfoResponse.json();
            if (!userInfo.mail && !userInfo.userPrincipalName) {
                app.log.error('No email in Outlook user info');
                return reply.redirect(`${config_1.config.frontendUrl}/dashboard?error=missing_email&message=Could+not+get+email+from+Outlook`);
            }
            const email = userInfo.mail || userInfo.userPrincipalName;
            app.log.info(`Outlook OAuth successful for email: ${email}`);
            // ===== LOGIN FLOW =====
            if (isLoginFlow) {
                app.log.info('Processing Microsoft login flow');
                // Check if user exists
                const existingUser = await prisma_1.prisma.user.findUnique({
                    where: { email },
                });
                let user;
                let isNewUser = false;
                if (existingUser) {
                    // User exists - login
                    user = existingUser;
                    app.log.info(`Existing user logging in: ${user.id}`);
                }
                else {
                    // New user - create account
                    isNewUser = true;
                    app.log.info(`Creating new user for: ${email}`);
                    user = await prisma_1.prisma.user.create({
                        data: {
                            email,
                            password_hash: '', // No password for OAuth users
                            name: userInfo.displayName || undefined,
                            role: 'member',
                            onboarding_completed: false, // New users need onboarding
                        },
                    });
                    // Don't auto-grant trial - user will select plan first
                }
                // Use the already-decoded signupStateData if available
                const stateData = signupStateData;
                if (stateData) {
                    app.log.info(`[Outlook OAuth] Using signup state data:`, stateData);
                }
                // Determine redirect path: plan selection -> onboarding -> dashboard
                // Only require plan selection for truly new users who haven't selected a plan
                const hasCompletedOnboarding = user.onboarding_completed === true;
                const hasPlanSelected = user.plan_selected === true;
                const needsPlanSelection = isNewUser && !hasPlanSelected;
                const needsOnboarding = !hasCompletedOnboarding && !hasPlanSelected;
                let redirectPath = '/dashboard';
                // If state has redirect/plan info, use that
                if (stateData?.redirect) {
                    redirectPath = stateData.redirect;
                    // Add plan parameter if provided
                    if (stateData.plan) {
                        redirectPath += `${redirectPath.includes('?') ? '&' : '?'}plan=${stateData.plan}`;
                    }
                }
                else if (needsPlanSelection) {
                    redirectPath = '/select-plan';
                }
                else if (needsOnboarding) {
                    redirectPath = '/onboarding';
                }
                app.log.info(`[Outlook OAuth] User ${user.id}: isNewUser=${isNewUser}, plan_selected=${user.plan_selected}, onboarding_completed=${user.onboarding_completed}, redirectPath=${redirectPath}`);
                // Generate JWT tokens
                const accessToken = app.jwt.sign({ userId: user.id, email: user.email }, { expiresIn: config_1.config.jwt.accessTokenExpiry });
                const refreshToken = app.jwt.sign({ userId: user.id, type: 'refresh' }, { expiresIn: '7d' });
                // Set tokens as httpOnly cookies
                reply.setCookie('accessToken', accessToken, {
                    httpOnly: true,
                    secure: config_1.config.env === 'production',
                    sameSite: 'lax',
                    maxAge: 2 * 60 * 60,
                    path: '/',
                });
                reply.setCookie('refreshToken', refreshToken, {
                    httpOnly: true,
                    secure: config_1.config.env === 'production',
                    sameSite: 'lax',
                    maxAge: 7 * 24 * 60 * 60,
                    path: '/',
                });
                // Create server-side session
                await session_service_1.SessionService.createSession(user.id, accessToken, request.headers['user-agent'], request.ip);
                app.log.info(`User ${user.id} authenticated successfully via Microsoft`);
                // Create Outlook mailbox for the user
                try {
                    const expiresAt = new Date(Date.now() + (tokens.expires_in || 3600) * 1000);
                    await mailboxService.createOrUpdateMailbox({
                        userId: user.id,
                        provider: 'outlook',
                        email,
                        accessToken: tokens.access_token,
                        refreshToken: tokens.refresh_token,
                        expiresAt,
                    });
                    app.log.info(`Outlook mailbox created/updated for user ${user.id}: ${email}`);
                    // Redirect based on onboarding status
                    const separator = redirectPath.includes('?') ? '&' : '?';
                    app.log.info(`[Outlook OAuth] Redirecting user ${user.id} to ${redirectPath} (needsOnboarding: ${needsOnboarding})`);
                    const authCode = await generateAuthCode(accessToken);
                    return reply.redirect(`${config_1.config.frontendUrl}${redirectPath}${separator}success=microsoft_login&code=${encodeURIComponent(authCode)}&outlook_connected=true&email=${encodeURIComponent(email)}`);
                }
                catch (mailboxError) {
                    // Check if this is a mailbox limit error
                    if (mailboxError.message?.includes('MAILBOX_LIMIT_REACHED')) {
                        app.log.warn(`Mailbox limit reached for user ${user.id} during Outlook auto-connect`);
                        const separator = redirectPath.includes('?') ? '&' : '?';
                        const authCode2 = await generateAuthCode(accessToken);
                        return reply.redirect(`${config_1.config.frontendUrl}${redirectPath}${separator}success=microsoft_login&code=${encodeURIComponent(authCode2)}&error=mailbox_limit_exceeded`);
                    }
                    app.log.error(`Failed to create Outlook mailbox: ${mailboxError?.message || mailboxError}`);
                    // Still redirect with login success
                    const separator = redirectPath.includes('?') ? '&' : '?';
                    const authCode3 = await generateAuthCode(accessToken);
                    return reply.redirect(`${config_1.config.frontendUrl}${redirectPath}${separator}success=microsoft_login&code=${encodeURIComponent(authCode3)}&warning=mailbox_connection_failed`);
                }
            }
            // ===== MAILBOX CONNECTION FLOW =====
            // Calculate token expiry
            const expiresAt = tokens.expires_in
                ? new Date(Date.now() + tokens.expires_in * 1000)
                : undefined;
            // Check mailbox limit before creating
            app.log.info('Checking mailbox limit for user:', userId);
            const limitCheck = await usage_service_1.usageService.checkLimitExceeded(userId, 'mailboxes');
            if (limitCheck.exceeded) {
                app.log.warn(`Mailbox limit exceeded for user ${userId}: ${limitCheck.currentUsage}/${limitCheck.limit}`);
                // Get suggested plan for upgrade
                const currentPlan = await prisma_1.prisma.subscription.findUnique({
                    where: { user_id: userId },
                    include: { plan_config: true },
                });
                const suggestedPlan = currentPlan?.plan_config?.name === 'free' ? 'starter' :
                    currentPlan?.plan_config?.name === 'starter' ? 'growth' : 'business';
                return reply.redirect(`${config_1.config.frontendUrl}/dashboard?error=mailbox_limit_exceeded` +
                    `&current=${limitCheck.currentUsage}&limit=${limitCheck.limit}` +
                    `&suggestedPlan=${suggestedPlan}`);
            }
            // Store mailbox with encrypted tokens
            app.log.info('Storing Outlook mailbox credentials...');
            await mailboxService.createOrUpdateMailbox({
                userId: userId,
                provider: 'outlook',
                email,
                accessToken: tokens.access_token,
                refreshToken: tokens.refresh_token,
                expiresAt,
            });
            // Update mailbox count
            await usage_service_1.usageService.updateMailboxesCount(userId);
            app.log.info(`Mailbox count updated for user ${userId}`);
            app.log.info(`Outlook account ${email} successfully connected for user ${userId}`);
            await (0, security_event_service_1.logSecurityEvent)({
                eventType: 'mailbox_connected',
                userId: userId,
                ipAddress: request.ip,
                userAgent: request.headers['user-agent'] || '',
                details: { provider: 'outlook', email },
            });
            // After mailbox connection, trigger initial scan asynchronously
            app.log.info(`[Outlook] Scheduling initial scan in 2 seconds for ${email}`);
            setTimeout(async () => {
                app.log.info(`[Outlook] Timer fired - starting initial scan for ${email}`);
                try {
                    const { scanMailbox } = await Promise.resolve().then(() => __importStar(require('../../services/scanner.service')));
                    const mailbox = await prisma_1.prisma.mailbox.findFirst({
                        where: {
                            user_id: userId,
                            email_address: email,
                            provider: 'outlook'
                        }
                    });
                    if (mailbox) {
                        app.log.info(`[Outlook] Found mailbox ${mailbox.id} - triggering initial scan for: ${email}`);
                        const scanResult = await scanMailbox(mailbox.id, userId, {
                            maxResults: 50, // Scan first 50 messages in spam folder
                            afterDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Last 7 days
                        });
                        app.log.info(`[Outlook] Initial scan completed for ${email}. Results:`, {
                            scannedCount: scanResult.scannedCount,
                            newMessages: scanResult.newMessages,
                            legitFound: scanResult.legitFound
                        });
                    }
                    else {
                        app.log.error(`[Outlook] Could not find created mailbox for user ${userId} and email ${email}`);
                    }
                }
                catch (scanError) {
                    app.log.error(`[Outlook] Failed to perform initial scan after Outlook connection: ${scanError?.message || scanError}`);
                    // Don't fail the connection if initial scan fails
                }
            }, 2000); // 2 second delay to ensure mailbox is saved before scanning
            // Redirect to dashboard with success
            return reply.redirect(`${config_1.config.frontendUrl}/dashboard?success=outlook_connected&email=${encodeURIComponent(email)}`);
        }
        catch (error) {
            app.log.error(`Outlook OAuth callback error: ${error?.message || error}`);
            const errorMessage = error.message || 'Unknown error occurred';
            return reply.redirect(`${config_1.config.frontendUrl}/dashboard?error=oauth_failed&message=${encodeURIComponent(errorMessage)}`);
        }
    });
    // Custom authentication middleware that checks both JWT and server-side session
    const requireValidSession = async (request, reply) => {
        try {
            // First verify the JWT token
            await request.jwtVerify();
            // Then validate the server-side session
            const userId = request.user?.userId;
            // Note: To properly validate session, we'd need to pass the session ID
            // For now, this is a placeholder for future implementation
        }
        catch (err) {
            reply.status(401).send({
                success: false,
                error: {
                    code: 'UNAUTHORIZED',
                    message: 'Invalid or missing authentication token',
                },
            });
        }
    };
};
exports.authRoutes = authRoutes;
