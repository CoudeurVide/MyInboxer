"use strict";
/**
 * Application configuration
 * Loads and validates environment variables
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
exports.config = void 0;
exports.logConfig = logConfig;
const zod_1 = require("zod");
const dotenv = __importStar(require("dotenv"));
const path = __importStar(require("path"));
// Load environment variables from root .env
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
/**
 * Environment variable schema
 */
const envSchema = zod_1.z.object({
    // Application
    NODE_ENV: zod_1.z.enum(['development', 'staging', 'production', 'test']).default('development'),
    PORT: zod_1.z.string().default('53001'),
    HOST: zod_1.z.string().default('0.0.0.0'),
    API_URL: zod_1.z.string().url().default('http://localhost:53001'),
    FRONTEND_URL: zod_1.z.string().url().default('http://localhost:53000'),
    FORCE_HTTPS: zod_1.z.enum(['true', 'false']).default('false'),
    // Database
    DATABASE_URL: zod_1.z.string().url(),
    // JWT — minimum 64 chars (512 bits) required for OWASP A02 / CASA compliance
    JWT_ACCESS_SECRET: zod_1.z.string().min(64, 'JWT_ACCESS_SECRET must be at least 64 characters'),
    JWT_REFRESH_SECRET: zod_1.z.string().min(64, 'JWT_REFRESH_SECRET must be at least 64 characters'),
    // Encryption
    MASTER_ENCRYPTION_KEY: zod_1.z.string().length(64), // 32 bytes in hex (64 hex chars)
    // OAuth - Gmail (required for OAuth flow)
    GOOGLE_CLIENT_ID: zod_1.z.string().min(1, 'Google Client ID is required'),
    GOOGLE_CLIENT_SECRET: zod_1.z.string().min(1, 'Google Client Secret is required'),
    GOOGLE_REDIRECT_URI: zod_1.z.string().url('Google Redirect URI must be a valid URL'),
    // OAuth - Microsoft
    MICROSOFT_CLIENT_ID: zod_1.z.string().optional(),
    MICROSOFT_CLIENT_SECRET: zod_1.z.string().optional(),
    MICROSOFT_REDIRECT_URI: zod_1.z.string().url().optional(),
    // OAuth - Yahoo
    YAHOO_CLIENT_ID: zod_1.z.string().optional(),
    YAHOO_CLIENT_SECRET: zod_1.z.string().optional(),
    YAHOO_REDIRECT_URI: zod_1.z.string().url().optional(),
    // Redis
    UPSTASH_REDIS_URL: zod_1.z.string().url().optional(),
    UPSTASH_REDIS_TOKEN: zod_1.z.string().optional(),
    // Email Service
    POSTMARK_API_KEY: zod_1.z.string().optional(),
    POSTMARK_FROM_EMAIL: zod_1.z.string().email().optional(),
    RESEND_API_KEY: zod_1.z.string().optional(),
    EMAIL_FROM: zod_1.z.string().email().optional(),
    // SMS Service
    TWILIO_ACCOUNT_SID: zod_1.z.string().optional(),
    TWILIO_AUTH_TOKEN: zod_1.z.string().optional(),
    TWILIO_PHONE_NUMBER: zod_1.z.string().optional(),
    // AI Services
    OLLAMA_API_URL: zod_1.z.string().url().default('http://localhost:11434'),
    OPENAI_API_KEY: zod_1.z.string().optional(),
    MISTRAL_API_KEY: zod_1.z.string().optional(),
    MISTRAL_MODEL: zod_1.z.string().optional().default('mistral-small-latest'),
    // SMTP Email
    SMTP_HOST: zod_1.z.string().optional(),
    SMTP_PORT: zod_1.z.string().optional(),
    SMTP_SECURE: zod_1.z.string().optional(),
    SMTP_USER: zod_1.z.string().optional(),
    SMTP_PASS: zod_1.z.string().optional(),
    SMTP_FROM: zod_1.z.string().optional(),
    APP_URL: zod_1.z.string().url().default('http://localhost:3000'),
    // Monitoring
    SENTRY_DSN: zod_1.z.string().url().optional(),
    // Stripe
    STRIPE_SECRET_KEY: zod_1.z.string().optional(),
    STRIPE_PUBLISHABLE_KEY: zod_1.z.string().optional(),
    STRIPE_WEBHOOK_SECRET: zod_1.z.string().optional(),
    // Stripe Price IDs
    STRIPE_PRICE_STARTER_MONTHLY: zod_1.z.string().optional(),
    STRIPE_PRICE_STARTER_YEARLY: zod_1.z.string().optional(),
    STRIPE_PRICE_GROWTH_MONTHLY: zod_1.z.string().optional(),
    STRIPE_PRICE_GROWTH_YEARLY: zod_1.z.string().optional(),
    STRIPE_PRICE_BUSINESS_MONTHLY: zod_1.z.string().optional(),
    STRIPE_PRICE_BUSINESS_YEARLY: zod_1.z.string().optional(),
});
/**
 * Validate and parse environment variables
 */
function validateEnv() {
    try {
        return envSchema.parse(process.env);
    }
    catch (error) {
        if (error instanceof zod_1.z.ZodError) {
            console.error('❌ Invalid environment variables:');
            console.error(error.errors);
            process.exit(1);
        }
        throw error;
    }
}
const env = validateEnv();
/**
 * Application configuration
 */
exports.config = {
    env: env.NODE_ENV,
    port: parseInt(env.PORT, 10),
    host: env.HOST,
    apiUrl: env.API_URL,
    frontendUrl: env.FRONTEND_URL,
    forceHttps: env.FORCE_HTTPS === 'true',
    database: {
        url: env.DATABASE_URL,
    },
    jwt: {
        accessSecret: env.JWT_ACCESS_SECRET,
        refreshSecret: env.JWT_REFRESH_SECRET,
        accessTokenExpiry: '2h',
        refreshTokenExpiry: '7d',
    },
    encryption: {
        masterKey: Buffer.from(env.MASTER_ENCRYPTION_KEY, 'hex'),
    },
    oauth: {
        google: {
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            redirectUri: env.GOOGLE_REDIRECT_URI,
        },
        microsoft: {
            clientId: env.MICROSOFT_CLIENT_ID,
            clientSecret: env.MICROSOFT_CLIENT_SECRET,
            redirectUri: env.MICROSOFT_REDIRECT_URI,
        },
        yahoo: {
            clientId: env.YAHOO_CLIENT_ID,
            clientSecret: env.YAHOO_CLIENT_SECRET,
            redirectUri: env.YAHOO_REDIRECT_URI,
        },
    },
    redis: {
        url: env.UPSTASH_REDIS_URL,
        token: env.UPSTASH_REDIS_TOKEN,
    },
    email: {
        postmark: {
            apiKey: env.POSTMARK_API_KEY,
            fromEmail: env.POSTMARK_FROM_EMAIL,
        },
        resend: {
            apiKey: env.RESEND_API_KEY,
            fromEmail: env.EMAIL_FROM,
        },
    },
    sms: {
        twilio: {
            accountSid: env.TWILIO_ACCOUNT_SID,
            authToken: env.TWILIO_AUTH_TOKEN,
            phoneNumber: env.TWILIO_PHONE_NUMBER,
        },
    },
    ai: {
        ollama: {
            apiUrl: env.OLLAMA_API_URL,
        },
        openai: {
            apiKey: env.OPENAI_API_KEY,
        },
        mistral: {
            apiKey: env.MISTRAL_API_KEY,
            model: env.MISTRAL_MODEL,
        },
    },
    smtp: {
        host: env.SMTP_HOST,
        port: env.SMTP_PORT ? parseInt(env.SMTP_PORT, 10) : 587,
        secure: env.SMTP_SECURE === 'true',
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
        from: env.SMTP_FROM || 'noreply@myinboxer.com',
    },
    appUrl: env.APP_URL,
    monitoring: {
        sentryDsn: env.SENTRY_DSN,
    },
    stripe: {
        secretKey: env.STRIPE_SECRET_KEY,
        publishableKey: env.STRIPE_PUBLISHABLE_KEY,
        webhookSecret: env.STRIPE_WEBHOOK_SECRET,
        priceIds: {
            starter_monthly: env.STRIPE_PRICE_STARTER_MONTHLY,
            starter_yearly: env.STRIPE_PRICE_STARTER_YEARLY,
            growth_monthly: env.STRIPE_PRICE_GROWTH_MONTHLY,
            growth_yearly: env.STRIPE_PRICE_GROWTH_YEARLY,
            business_monthly: env.STRIPE_PRICE_BUSINESS_MONTHLY,
            business_yearly: env.STRIPE_PRICE_BUSINESS_YEARLY,
        },
    },
    cors: {
        origins: [env.FRONTEND_URL],
    },
};
/**
 * Log configuration on startup (hide secrets)
 */
function logConfig() {
    console.log('📋 Configuration loaded:');
    console.log(`  Environment: ${exports.config.env}`);
    console.log(`  Port: ${exports.config.port}`);
    console.log(`  API URL: ${exports.config.apiUrl}`);
    console.log(`  Frontend URL: ${exports.config.frontendUrl}`);
    console.log(`  Force HTTPS: ${exports.config.forceHttps ? '✓' : '✗'}`);
    console.log(`  Database: ${exports.config.database.url.split('@')[1] || 'configured'}`);
    console.log(`  JWT: ${exports.config.jwt.accessSecret ? '✓' : '✗'}`);
    console.log(`  Encryption: ${exports.config.encryption.masterKey ? '✓' : '✗'}`);
    console.log(`  Google OAuth: ${exports.config.oauth.google.clientId ? '✓' : '✗'}`);
    console.log(`  Redis: ${exports.config.redis.url ? '✓' : '✗'}`);
    console.log(`  Postmark: ${exports.config.email.postmark.apiKey ? '✓' : '✗'}`);
    console.log(`  Resend: ${exports.config.email.resend.apiKey ? '✓' : '✗'}`);
    console.log(`  SMTP: ${exports.config.smtp.host ? '✓' : '✗'}`);
    console.log(`  Ollama: ${exports.config.ai.ollama.apiUrl}`);
    console.log(`  OpenAI: ${exports.config.ai.openai.apiKey ? '✓' : '✗'}`);
    console.log(`  Stripe: ${exports.config.stripe.secretKey ? '✓' : '✗'}`);
}
