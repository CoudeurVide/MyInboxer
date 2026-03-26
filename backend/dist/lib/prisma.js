"use strict";
/**
 * Prisma Client singleton
 * Ensures single instance across application
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("@prisma/client");
const config_1 = require("./config");
/**
 * Create or reuse Prisma client with optimized connection pooling
 */
exports.prisma = global.prisma || new client_1.PrismaClient({
    datasources: {
        db: {
            url: buildDatabaseUrl(),
        },
    },
    log: config_1.config.env === 'development'
        ? ['query', 'error', 'warn']
        : ['error'],
}).$extends({
    query: {
        $allOperations({ operation, model, args, query }) {
            // Add connection timeout handling
            return query(args);
        },
    },
});
/**
 * Build database URL with connection pooling parameters
 * Optimized for production scalability and reliability
 */
function buildDatabaseUrl() {
    const baseUrl = config_1.config.database.url;
    // Default connection pool settings
    const poolSettings = {
        // Maximum number of connections in the pool
        // Supabase pooler has limits, so we keep this conservative
        connection_limit: parseInt(process.env.DATABASE_CONNECTION_LIMIT || '10'),
        // Time to wait for a connection from the pool (in seconds)
        // If no connection available after this time, query fails
        pool_timeout: parseInt(process.env.DATABASE_POOL_TIMEOUT || '10'),
        // Enable connection pooling mode (if using Supabase pooler)
        // 'transaction' mode is recommended for serverless/API applications
        pgbouncer: process.env.DATABASE_POOLING_MODE === 'pgbouncer' ? 'true' : undefined,
    };
    // Build query string from settings
    const params = new URLSearchParams();
    Object.entries(poolSettings).forEach(([key, value]) => {
        if (value !== undefined) {
            params.append(key, value.toString());
        }
    });
    // Check if URL already has query parameters
    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}${params.toString()}`;
}
if (config_1.config.env !== 'production') {
    global.prisma = exports.prisma;
}
/**
 * Graceful disconnect on process exit
 */
process.on('beforeExit', async () => {
    await exports.prisma.$disconnect();
});
