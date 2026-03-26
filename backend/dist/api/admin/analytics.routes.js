"use strict";
/**
 * Admin Analytics Routes
 * Provides analytics and metrics for admin dashboard
 */
Object.defineProperty(exports, "__esModule", { value: true });
const prisma_1 = require("../../lib/prisma");
const admin_middleware_1 = require("../../middleware/admin.middleware");
const AdminAnalyticsRoutes = async (fastify) => {
    /**
     * GET /api/admin/analytics
     * Get dashboard analytics (admin only)
     */
    fastify.get('/analytics', {
        onRequest: [admin_middleware_1.adminMiddleware],
    }, async (request, reply) => {
        try {
            // Get current date and date 30 days ago
            const now = new Date();
            const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
            // ===== TOTAL USERS =====
            const totalUsers = await prisma_1.prisma.user.count();
            const usersLastMonth = await prisma_1.prisma.user.count({
                where: {
                    created_at: {
                        lt: thirtyDaysAgo,
                    },
                },
            });
            const totalUsersChange = usersLastMonth > 0
                ? Math.round(((totalUsers - usersLastMonth) / usersLastMonth) * 100)
                : 0;
            // ===== PAYING CUSTOMERS =====
            const payingCustomers = await prisma_1.prisma.subscription.count({
                where: {
                    plan: {
                        not: 'free',
                    },
                    status: {
                        in: ['active', 'trialing'],
                    },
                },
            });
            const payingCustomersLastMonth = await prisma_1.prisma.subscription.count({
                where: {
                    plan: {
                        not: 'free',
                    },
                    status: {
                        in: ['active', 'trialing'],
                    },
                    created_at: {
                        lt: thirtyDaysAgo,
                    },
                },
            });
            const payingCustomersChange = payingCustomersLastMonth > 0
                ? Math.round(((payingCustomers - payingCustomersLastMonth) / payingCustomersLastMonth) * 100)
                : 0;
            // ===== MONTHLY RECURRING REVENUE (MRR) =====
            // Get all active subscriptions with their plan prices
            const activeSubs = await prisma_1.prisma.subscription.findMany({
                where: {
                    status: {
                        in: ['active', 'trialing'],
                    },
                    plan: {
                        not: 'free',
                    },
                },
                include: {
                    plan_config: true,
                },
            });
            // Calculate current MRR
            const currentMRR = activeSubs.reduce((total, sub) => {
                if (!sub.plan_config)
                    return total;
                // If yearly, divide by 12 to get monthly equivalent
                if (sub.billing_cycle === 'yearly' && sub.plan_config.price_yearly) {
                    return total + Math.round(sub.plan_config.price_yearly / 12);
                }
                return total + (sub.plan_config.price_monthly || 0);
            }, 0);
            // Calculate MRR from 30 days ago
            const activeSubsLastMonth = await prisma_1.prisma.subscription.findMany({
                where: {
                    status: {
                        in: ['active', 'trialing'],
                    },
                    plan: {
                        not: 'free',
                    },
                    created_at: {
                        lt: thirtyDaysAgo,
                    },
                },
                include: {
                    plan_config: true,
                },
            });
            const lastMonthMRR = activeSubsLastMonth.reduce((total, sub) => {
                if (!sub.plan_config)
                    return total;
                if (sub.billing_cycle === 'yearly' && sub.plan_config.price_yearly) {
                    return total + Math.round(sub.plan_config.price_yearly / 12);
                }
                return total + (sub.plan_config.price_monthly || 0);
            }, 0);
            const mrrChange = lastMonthMRR > 0
                ? Math.round(((currentMRR - lastMonthMRR) / lastMonthMRR) * 100)
                : 0;
            // ===== CHURN RATE =====
            // Churn rate = (Customers at start - Customers at end) / Customers at start
            const cancelledThisMonth = await prisma_1.prisma.subscription.count({
                where: {
                    status: 'cancelled',
                    canceled_at: {
                        gte: thirtyDaysAgo,
                    },
                },
            });
            const activeAtStartOfMonth = payingCustomersLastMonth;
            const churnRate = activeAtStartOfMonth > 0
                ? (cancelledThisMonth / activeAtStartOfMonth) * 100
                : 0;
            // Calculate churn for previous period
            const cancelledPreviousMonth = await prisma_1.prisma.subscription.count({
                where: {
                    status: 'cancelled',
                    canceled_at: {
                        gte: sixtyDaysAgo,
                        lt: thirtyDaysAgo,
                    },
                },
            });
            const activeAtStartOfPreviousMonth = await prisma_1.prisma.subscription.count({
                where: {
                    plan: {
                        not: 'free',
                    },
                    status: {
                        in: ['active', 'trialing'],
                    },
                    created_at: {
                        lt: sixtyDaysAgo,
                    },
                },
            });
            const previousChurnRate = activeAtStartOfPreviousMonth > 0
                ? (cancelledPreviousMonth / activeAtStartOfPreviousMonth) * 100
                : 0;
            const churnRateChange = previousChurnRate > 0
                ? Math.round(((churnRate - previousChurnRate) / previousChurnRate) * 100)
                : 0;
            // ===== RECENT SUBSCRIPTIONS =====
            const recentSubscriptions = await prisma_1.prisma.subscription.findMany({
                where: {
                    plan: {
                        not: 'free',
                    },
                },
                include: {
                    user: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                        },
                    },
                    plan_config: {
                        select: {
                            price_monthly: true,
                            price_yearly: true,
                        },
                    },
                },
                orderBy: {
                    created_at: 'desc',
                },
                take: 10,
            });
            const formattedRecentSubscriptions = recentSubscriptions.map((sub) => ({
                id: sub.id,
                userName: sub.user.name || 'Unknown',
                userEmail: sub.user.email,
                plan: sub.plan,
                status: sub.status,
                createdAt: sub.created_at.toISOString(),
                amount: sub.billing_cycle === 'yearly'
                    ? (sub.plan_config?.price_yearly || 0)
                    : (sub.plan_config?.price_monthly || 0),
            }));
            // ===== PLAN DISTRIBUTION =====
            const planDistribution = await prisma_1.prisma.subscription.groupBy({
                by: ['plan'],
                _count: {
                    plan: true,
                },
                where: {
                    status: {
                        in: ['active', 'trialing'],
                    },
                },
            });
            const totalActiveSubscriptions = planDistribution.reduce((sum, item) => sum + item._count.plan, 0);
            const formattedPlanDistribution = planDistribution.map((item) => ({
                plan: item.plan,
                count: item._count.plan,
                percentage: totalActiveSubscriptions > 0
                    ? (item._count.plan / totalActiveSubscriptions) * 100
                    : 0,
            }));
            // ===== REVENUE DATA (last 6 months) =====
            // BATCH OPTIMIZATION: Fetch all subscriptions ONCE instead of 6 separate queries
            const sixMonthsAgo = new Date(now);
            sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
            const sixMonthsAgoStart = new Date(sixMonthsAgo.getFullYear(), sixMonthsAgo.getMonth(), 1);
            const allActiveSubs = await prisma_1.prisma.subscription.findMany({
                where: {
                    status: {
                        in: ['active', 'trialing'],
                    },
                    plan: {
                        not: 'free',
                    },
                    created_at: {
                        lte: now,
                    },
                },
                include: {
                    plan_config: true,
                },
            });
            // Calculate revenue for each month by filtering in memory
            const revenueData = [];
            for (let i = 5; i >= 0; i--) {
                const monthDate = new Date(now);
                monthDate.setMonth(monthDate.getMonth() - i);
                const monthEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
                // Filter subscriptions that existed at the end of this month (in memory - no DB query!)
                const monthSubs = allActiveSubs.filter(sub => sub.created_at <= monthEnd);
                const monthRevenue = monthSubs.reduce((total, sub) => {
                    if (!sub.plan_config)
                        return total;
                    if (sub.billing_cycle === 'yearly' && sub.plan_config.price_yearly) {
                        return total + Math.round(sub.plan_config.price_yearly / 12);
                    }
                    return total + (sub.plan_config.price_monthly || 0);
                }, 0);
                revenueData.push({
                    month: monthDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
                    revenue: monthRevenue,
                });
            }
            return reply.status(200).send({
                success: true,
                data: {
                    metrics: {
                        totalUsers,
                        totalUsersChange,
                        payingCustomers,
                        payingCustomersChange,
                        monthlyRecurringRevenue: currentMRR,
                        mrrChange,
                        churnRate: Number(churnRate.toFixed(1)),
                        churnRateChange,
                    },
                    recentSubscriptions: formattedRecentSubscriptions,
                    planDistribution: formattedPlanDistribution,
                    revenueData,
                },
            });
        }
        catch (error) {
            console.error('[Admin Analytics] Error fetching analytics:', error);
            return reply.status(500).send({
                success: false,
                error: {
                    code: 'ANALYTICS_ERROR',
                    message: 'Failed to fetch analytics data',
                },
            });
        }
    });
};
exports.default = AdminAnalyticsRoutes;
