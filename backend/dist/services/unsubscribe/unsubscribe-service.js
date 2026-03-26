"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnsubscribeService = void 0;
class UnsubscribeService {
    config;
    unsubscriptionStatuses = new Map();
    constructor(config) {
        this.config = {
            ...config,
            requestTimeout: config.requestTimeout || 60000, // Default to 60 seconds
        };
    }
    async unsubscribe(request, aiProvider) {
        const { url } = request;
        // Validate the URL first
        if (!this.isValidUrl(url)) {
            return {
                success: false,
                confirmationFound: false,
                message: 'Invalid unsubscribe URL',
                processingTime: 0,
                url: url
            };
        }
        // Create a unique ID for this operation
        const operationId = this.generateOperationId();
        const startTime = Date.now();
        try {
            // Update status to processing
            this.updateStatus(operationId, {
                id: operationId,
                url,
                status: 'processing',
                createdAt: new Date(),
                updatedAt: new Date()
            });
            // Try to call the external unsubscriber service if configured
            // Otherwise, fall back to a simple simulation
            let result;
            // Check if unsubscriber service is available
            const useExternalService = this.config.unsubscriberApiUrl &&
                this.config.unsubscriberApiUrl.startsWith('http');
            if (useExternalService) {
                // External service is configured - try to use it
                try {
                    const requestBody = { url };
                    if (aiProvider) {
                        requestBody.aiProvider = aiProvider;
                    }
                    const response = await fetch(`${this.config.unsubscriberApiUrl}/unsubscribe`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify(requestBody),
                        signal: AbortSignal.timeout(this.config.requestTimeout)
                    });
                    if (!response.ok) {
                        throw new Error(`Unsubscribe API returned status: ${response.status}`);
                    }
                    result = await response.json();
                }
                catch (externalError) {
                    // External service unreachable — fall back to direct HTTP GET
                    console.warn(`[Unsubscribe] External service failed (${externalError.message}), falling back to direct HTTP GET for: ${url}`);
                    result = await this.directUnsubscribe(url);
                }
            }
            else {
                // No external service configured — use direct HTTP GET
                console.log(`[Unsubscribe] No external service configured, using direct HTTP GET for: ${url}`);
                result = await this.directUnsubscribe(url);
            }
            const processingTime = Date.now() - startTime;
            const finalResult = {
                ...result,
                processingTime
            };
            // Update status with result
            this.updateStatus(operationId, {
                id: operationId,
                url,
                status: result.success ? 'success' : 'failed',
                result: finalResult,
                createdAt: new Date(),
                updatedAt: new Date()
            });
            return finalResult;
        }
        catch (error) {
            const processingTime = Date.now() - startTime;
            const errorResult = {
                success: false,
                confirmationFound: false,
                message: error instanceof Error ? error.message : 'Unknown error occurred',
                processingTime,
                url: url
            };
            // Update status with error
            this.updateStatus(operationId, {
                id: operationId,
                url,
                status: 'failed',
                result: errorResult,
                createdAt: new Date(),
                updatedAt: new Date()
            });
            return errorResult;
        }
    }
    async batchUnsubscribe(request, aiProvider) {
        const promises = request.urls.map(url => this.unsubscribe({ url }, aiProvider));
        const results = await Promise.allSettled(promises);
        const processedResults = results.map((result, index) => {
            if (result.status === 'fulfilled') {
                return result.value;
            }
            else {
                return {
                    success: false,
                    confirmationFound: false,
                    message: result.reason?.message || 'Unknown error',
                    processingTime: 0,
                    url: request.urls[index]
                };
            }
        });
        const successful = processedResults.filter(r => r.success).length;
        const failed = processedResults.length - successful;
        return {
            results: processedResults,
            summary: {
                total: processedResults.length,
                successful,
                failed
            }
        };
    }
    async validateUrl(url) {
        try {
            new URL(url);
            // Additional validation can go here
            return url.includes('unsubscribe') || url.includes('optout') || url.includes('cancel');
        }
        catch {
            return false;
        }
    }
    async getStatus(id) {
        return this.unsubscriptionStatuses.get(id) || null;
    }
    /**
     * Direct HTTP GET/POST fallback for unsubscribe URLs.
     * Most email unsubscribe links work with a simple GET request (clicking the link).
     * This is used when the external browser-automation service is unavailable.
     */
    async directUnsubscribe(url) {
        const startTime = Date.now();
        // SSRF guard — re-validate before any network request
        if (!this.validateSsrfSafeUrl(url)) {
            return {
                success: false,
                confirmationFound: false,
                message: 'URL not allowed: blocked for security reasons',
                processingTime: 0,
                url,
            };
        }
        try {
            // First try GET (most common for unsubscribe links)
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; MyInboxer/1.0; +https://myinboxer.com)',
                    'Accept': 'text/html,application/xhtml+xml,*/*',
                },
                redirect: 'follow',
                signal: AbortSignal.timeout(15000), // 15s timeout for direct requests
            });
            const processingTime = Date.now() - startTime;
            const statusOk = response.status >= 200 && response.status < 400;
            // Read a portion of the body to check for confirmation keywords
            const body = await response.text().catch(() => '');
            const bodyLower = body.toLowerCase().substring(0, 5000);
            const confirmationFound = statusOk && (bodyLower.includes('unsubscribed') ||
                bodyLower.includes('successfully') ||
                bodyLower.includes('removed') ||
                bodyLower.includes('opted out') ||
                bodyLower.includes('preferences updated') ||
                bodyLower.includes('you have been'));
            if (statusOk) {
                return {
                    success: true,
                    confirmationFound,
                    message: confirmationFound
                        ? 'Successfully unsubscribed (confirmation detected)'
                        : 'Unsubscribe request sent successfully',
                    processingTime,
                    url,
                };
            }
            else {
                return {
                    success: false,
                    confirmationFound: false,
                    message: `Unsubscribe page returned HTTP ${response.status}`,
                    processingTime,
                    url,
                };
            }
        }
        catch (error) {
            return {
                success: false,
                confirmationFound: false,
                message: `Direct unsubscribe failed: ${error.message}`,
                processingTime: Date.now() - startTime,
                url,
            };
        }
    }
    /**
     * Checks if a hostname resolves to a private/internal IP range (SSRF protection).
     * Blocks requests to localhost, RFC1918 ranges, link-local, and cloud metadata endpoints.
     */
    isPrivateHostname(hostname) {
        const privatePatterns = [
            /^localhost$/i,
            /^127\.\d+\.\d+\.\d+$/,
            /^10\.\d+\.\d+\.\d+$/,
            /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
            /^192\.168\.\d+\.\d+$/,
            /^169\.254\.\d+\.\d+$/, // link-local / AWS metadata
            /^::1$/,
            /^fc[0-9a-f]{2}:/i, // IPv6 ULA
            /^0\.0\.0\.0$/,
            /^metadata\.google\.internal$/i,
            /^169\.254\.169\.254$/, // AWS/GCP/Azure metadata
        ];
        return privatePatterns.some(p => p.test(hostname));
    }
    /**
     * Validates that a URL is safe to fetch (SSRF guard):
     * - Must be http or https
     * - Must not resolve to a private/internal address
     */
    validateSsrfSafeUrl(url) {
        try {
            const parsed = new URL(url);
            if (!['http:', 'https:'].includes(parsed.protocol))
                return false;
            if (this.isPrivateHostname(parsed.hostname))
                return false;
            return true;
        }
        catch {
            return false;
        }
    }
    isValidUrl(url) {
        return this.validateSsrfSafeUrl(url);
    }
    generateOperationId() {
        return `unsubscribe_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    updateStatus(id, status) {
        this.unsubscriptionStatuses.set(id, status);
    }
}
exports.UnsubscribeService = UnsubscribeService;
