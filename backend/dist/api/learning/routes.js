"use strict";
/**
 * Learning Analytics Routes
 * GET /api/learning/insights - Get learning insights and correction analysis
 * GET /api/learning/accuracy - Get classification accuracy statistics
 * POST /api/learning/apply-reputations - Apply sender reputations from learning
 * GET /api/learning/keywords - Get misclassified keywords
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.learningRoutes = void 0;
const feedback_learning_service_1 = require("../../services/feedback-learning.service");
const learningRoutes = async (app) => {
    /**
     * Get learning insights
     * GET /api/learning/insights
     */
    app.get('/insights', async (request, reply) => {
        try {
            const userId = request.user?.userId;
            if (!userId) {
                return reply.status(401).send({
                    success: false,
                    error: 'Authentication required',
                });
            }
            const { since } = request.query;
            const sinceDate = since ? new Date(since) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Default: last 30 days
            const insights = await (0, feedback_learning_service_1.analyzeUserCorrections)(userId, {
                sinceDate,
            });
            return reply.send({
                success: true,
                data: insights,
            });
        }
        catch (error) {
            app.log.error('Learning insights error:', error);
            return reply.status(500).send({
                success: false,
                error: 'Failed to get learning insights',
            });
        }
    });
    /**
     * Get accuracy statistics
     * GET /api/learning/accuracy
     */
    app.get('/accuracy', async (request, reply) => {
        try {
            const userId = request.user?.userId;
            if (!userId) {
                return reply.status(401).send({
                    success: false,
                    error: 'Authentication required',
                });
            }
            const { since } = request.query;
            const sinceDate = since ? new Date(since) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
            const stats = await (0, feedback_learning_service_1.getAccuracyStats)(userId, {
                sinceDate,
            });
            return reply.send({
                success: true,
                data: stats,
            });
        }
        catch (error) {
            app.log.error('Accuracy stats error:', error);
            return reply.status(500).send({
                success: false,
                error: 'Failed to get accuracy statistics',
            });
        }
    });
    /**
     * Apply sender reputations from learning
     * POST /api/learning/apply-reputations
     */
    app.post('/apply-reputations', async (request, reply) => {
        try {
            const userId = request.user?.userId;
            if (!userId) {
                return reply.status(401).send({
                    success: false,
                    error: 'Authentication required',
                });
            }
            const { autoApply } = request.body;
            const result = await (0, feedback_learning_service_1.applySenderReputations)(userId, autoApply || false);
            return reply.send({
                success: true,
                data: result,
                message: `Applied ${result.applied} sender reputations, ${result.suggested} suggested`,
            });
        }
        catch (error) {
            app.log.error('Apply reputations error:', error);
            return reply.status(500).send({
                success: false,
                error: 'Failed to apply sender reputations',
            });
        }
    });
    /**
     * Get misclassified keywords
     * GET /api/learning/keywords
     */
    app.get('/keywords', async (request, reply) => {
        try {
            const userId = request.user?.userId;
            if (!userId) {
                return reply.status(401).send({
                    success: false,
                    error: 'Authentication required',
                });
            }
            const { limit } = request.query;
            const keywords = await (0, feedback_learning_service_1.getMisclassifiedKeywords)(userId, limit ? parseInt(limit, 10) : 20);
            return reply.send({
                success: true,
                data: keywords,
            });
        }
        catch (error) {
            app.log.error('Misclassified keywords error:', error);
            return reply.status(500).send({
                success: false,
                error: 'Failed to get misclassified keywords',
            });
        }
    });
};
exports.learningRoutes = learningRoutes;
