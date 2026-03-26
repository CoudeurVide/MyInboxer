"use strict";
/**
 * Waitlist Routes
 * Public endpoint for pre-launch email collection
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = waitlistRoutes;
const zod_1 = require("zod");
const prisma_1 = require("../../lib/prisma");
// Validation schema
const waitlistSchema = zod_1.z.object({
    name: zod_1.z.string().min(2, 'Name must be at least 2 characters').max(100),
    email: zod_1.z.string().email('Invalid email address').toLowerCase(),
    utmSource: zod_1.z.string().optional(),
    utmMedium: zod_1.z.string().optional(),
    utmCampaign: zod_1.z.string().optional(),
    referrer: zod_1.z.string().optional(),
});
// Rate limiting: Store signup attempts per IP
const rateLimitStore = new Map();
// Clean up old rate limit entries every 10 minutes
setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of rateLimitStore.entries()) {
        if (now > data.resetAt) {
            rateLimitStore.delete(ip);
        }
    }
}, 10 * 60 * 1000);
function checkRateLimit(ip) {
    const now = Date.now();
    const limit = rateLimitStore.get(ip);
    if (!limit || now > limit.resetAt) {
        // Reset or create new limit (3 signups per hour per IP)
        rateLimitStore.set(ip, {
            count: 1,
            resetAt: now + 60 * 60 * 1000, // 1 hour
        });
        return true;
    }
    if (limit.count >= 3) {
        return false; // Rate limit exceeded
    }
    limit.count++;
    return true;
}
async function waitlistRoutes(app) {
    /**
     * Submit waitlist signup
     * POST /api/waitlist
     */
    app.post('/', async (request, reply) => {
        try {
            // Get client info
            const ip = request.headers['x-forwarded-for']?.split(',')[0] ||
                request.socket.remoteAddress ||
                'unknown';
            // Check rate limit
            if (!checkRateLimit(ip)) {
                return reply.status(429).send({
                    success: false,
                    error: 'Too many signup attempts. Please try again later.',
                });
            }
            // Validate request body
            const validation = waitlistSchema.safeParse(request.body);
            if (!validation.success) {
                return reply.status(400).send({
                    success: false,
                    error: validation.error.errors[0].message,
                });
            }
            const { name, email, utmSource, utmMedium, utmCampaign, referrer } = validation.data;
            // Check if email already exists
            const existing = await prisma_1.prisma.waitlistSignup.findUnique({
                where: { email },
            });
            if (existing) {
                // Don't reveal that email exists (security best practice)
                return reply.status(200).send({
                    success: true,
                    message: 'Thank you for joining our waitlist!',
                });
            }
            // Create waitlist signup
            await prisma_1.prisma.waitlistSignup.create({
                data: {
                    name,
                    email,
                    ip_address: ip,
                    user_agent: request.headers['user-agent'] || null,
                    referrer: referrer || request.headers.referer || null,
                    utm_source: utmSource || null,
                    utm_medium: utmMedium || null,
                    utm_campaign: utmCampaign || null,
                },
            });
            console.log(`✅ New waitlist signup: ${email}`);
            return reply.status(201).send({
                success: true,
                message: 'Thank you for joining our waitlist!',
            });
        }
        catch (error) {
            console.error('❌ Waitlist signup error:', error);
            // Don't expose internal errors
            return reply.status(500).send({
                success: false,
                error: 'Something went wrong. Please try again.',
            });
        }
    });
    /**
     * Get waitlist stats (admin only - requires authentication)
     * GET /api/waitlist/stats
     */
    app.get('/stats', {
        onRequest: [app.authenticate]
    }, async (request, reply) => {
        try {
            const [total, today] = await Promise.all([
                prisma_1.prisma.waitlistSignup.count(),
                prisma_1.prisma.waitlistSignup.count({
                    where: {
                        created_at: {
                            gte: new Date(new Date().setHours(0, 0, 0, 0)),
                        },
                    },
                }),
            ]);
            return reply.send({
                total,
                today,
            });
        }
        catch (error) {
            console.error('❌ Waitlist stats error:', error);
            return reply.status(500).send({ error: 'Failed to get stats' });
        }
    });
}
