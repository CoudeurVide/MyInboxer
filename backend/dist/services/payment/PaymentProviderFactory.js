"use strict";
/**
 * Payment Provider Factory
 * Manages initialization and retrieval of payment provider instances
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
exports.PaymentProviderFactory = void 0;
const logger_1 = require("../../lib/logger");
class PaymentProviderFactory {
    static providers = new Map();
    static initialized = false;
    /**
     * Initialize payment providers based on environment configuration
     * This should be called once on server startup
     */
    static async initialize() {
        if (this.initialized) {
            logger_1.logger.warn('PaymentProviderFactory already initialized');
            return;
        }
        logger_1.logger.info('Initializing Payment Provider Factory...');
        try {
            // Initialize Stripe if credentials are available
            if (process.env.STRIPE_SECRET_KEY) {
                logger_1.logger.info('Stripe credentials found, initializing Stripe provider...');
                const { StripeProvider } = await Promise.resolve().then(() => __importStar(require('./providers/StripeProvider')));
                const stripeProvider = new StripeProvider();
                this.providers.set('stripe', stripeProvider);
                logger_1.logger.info('Stripe provider initialized successfully');
            }
            else {
                logger_1.logger.warn('Stripe credentials not found, Stripe provider not initialized');
            }
            // Initialize LemonSqueezy if credentials are available
            if (process.env.LEMONSQUEEZY_API_KEY && process.env.LEMONSQUEEZY_STORE_ID) {
                logger_1.logger.info('LemonSqueezy credentials found, initializing LemonSqueezy provider...');
                const { LemonSqueezyProvider } = await Promise.resolve().then(() => __importStar(require('./providers/LemonSqueezyProvider')));
                const lemonSqueezyProvider = new LemonSqueezyProvider();
                this.providers.set('lemonsqueezy', lemonSqueezyProvider);
                logger_1.logger.info('LemonSqueezy provider initialized successfully');
            }
            else {
                logger_1.logger.warn('LemonSqueezy credentials not found, LemonSqueezy provider not initialized');
            }
            this.initialized = true;
            // Log summary
            const availableProviders = Array.from(this.providers.keys());
            logger_1.logger.info(`Payment providers initialized: ${availableProviders.join(', ')}`);
            if (availableProviders.length === 0) {
                logger_1.logger.error('No payment providers initialized! Check your environment variables.');
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to initialize payment providers:', error);
            throw error;
        }
    }
    /**
     * Get a specific payment provider by type
     * @param providerType The provider type (stripe, lemonsqueezy)
     * @returns The payment provider instance
     * @throws Error if provider is not available
     */
    static getProvider(providerType) {
        if (!this.initialized) {
            throw new Error('PaymentProviderFactory not initialized. Call initialize() first on server startup.');
        }
        const provider = this.providers.get(providerType);
        if (!provider) {
            const availableProviders = Array.from(this.providers.keys());
            throw new Error(`Payment provider '${providerType}' is not available. ` +
                `Available providers: ${availableProviders.join(', ')}. ` +
                `Check your environment variables.`);
        }
        return provider;
    }
    /**
     * Get list of available provider types
     * @returns Array of available provider names
     */
    static getAvailableProviders() {
        if (!this.initialized) {
            return [];
        }
        return Array.from(this.providers.keys());
    }
    /**
     * Check if a specific provider is available
     * @param providerType The provider type to check
     * @returns True if the provider is available
     */
    static isProviderAvailable(providerType) {
        return this.providers.has(providerType);
    }
    /**
     * Get the default payment provider
     * Priority: environment variable > Stripe (for backwards compatibility) > first available
     * @returns The default payment provider
     * @throws Error if no providers are available
     */
    static getDefaultProvider() {
        if (!this.initialized) {
            throw new Error('PaymentProviderFactory not initialized. Call initialize() first on server startup.');
        }
        // Check environment variable for default provider
        const defaultProviderEnv = process.env.DEFAULT_PAYMENT_PROVIDER;
        if (defaultProviderEnv && this.providers.has(defaultProviderEnv)) {
            logger_1.logger.debug(`Using default provider from environment: ${defaultProviderEnv}`);
            return this.providers.get(defaultProviderEnv);
        }
        // Fallback to Stripe for backwards compatibility
        if (this.providers.has('stripe')) {
            logger_1.logger.debug('Using Stripe as default provider (backwards compatibility)');
            return this.providers.get('stripe');
        }
        // Use first available provider
        const firstProvider = this.providers.values().next();
        if (!firstProvider.done) {
            logger_1.logger.debug(`Using first available provider: ${firstProvider.value.providerName}`);
            return firstProvider.value;
        }
        throw new Error('No payment providers available. Check your environment variables and ensure at least one provider is configured.');
    }
    /**
     * Get default provider type
     * @returns The default provider type
     */
    static getDefaultProviderType() {
        return this.getDefaultProvider().providerName;
    }
    /**
     * Reset the factory (mainly for testing)
     */
    static reset() {
        this.providers.clear();
        this.initialized = false;
        logger_1.logger.info('PaymentProviderFactory reset');
    }
}
exports.PaymentProviderFactory = PaymentProviderFactory;
