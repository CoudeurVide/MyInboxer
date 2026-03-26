"use strict";
/**
 * HTTPS Enforcement Middleware
 * Ensures all requests are served over HTTPS in production
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.httpsEnforcementMiddleware = httpsEnforcementMiddleware;
exports.requireHttps = requireHttps;
/**
 * Middleware to enforce HTTPS based on configuration
 */
async function httpsEnforcementMiddleware(request, reply) {
    // Check if request is secure
    const isSecure = request.headers['x-forwarded-proto'] === 'https' ||
        request.headers['x-forwarded-protocol'] === 'https' ||
        request.headers['x-forwarded-ssl'] === 'on' ||
        request.headers['x-url-scheme'] === 'https' ||
        request.protocol === 'https' ||
        request.secure;
    if (!isSecure) {
        // Redirect to HTTPS version
        const host = request.headers.host;
        if (host) {
            const httpsUrl = `https://${host}${request.url}`;
            request.log.info(`HTTPS redirect: ${request.url} -> ${httpsUrl}`);
            reply.redirect(301, httpsUrl);
        }
        else {
            // If no host header, send 400 error
            request.log.warn('Request without host header rejected for HTTPS enforcement');
            reply.status(400).send({
                success: false,
                error: 'HTTPS required',
                message: 'All requests must be served over HTTPS. Missing host header.'
            });
        }
    }
}
/**
 * Convenience function to register HTTPS enforcement on specific routes that require it
 */
function requireHttps() {
    return httpsEnforcementMiddleware;
}
