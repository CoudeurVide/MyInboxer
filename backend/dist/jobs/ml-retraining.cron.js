"use strict";
/**
 * ML Retraining Cron Job
 * Automatically checks and triggers model retraining
 * Run this every hour
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupMLRetrainingCron = setupMLRetrainingCron;
exports.runRetrainingWorkerManual = runRetrainingWorkerManual;
const node_cron_1 = __importDefault(require("node-cron"));
const ml_retraining_scheduler_service_1 = require("../services/ml-retraining-scheduler.service");
/**
 * Setup automatic retraining cron job
 * Runs every hour to check if retraining should be triggered
 */
function setupMLRetrainingCron() {
    // Run every hour (at minute 0)
    node_cron_1.default.schedule('0 * * * *', async () => {
        console.log('[ML Cron] Running retraining worker...');
        try {
            await (0, ml_retraining_scheduler_service_1.retrainingWorker)();
            console.log('[ML Cron] Retraining worker completed');
        }
        catch (error) {
            console.error('[ML Cron] Retraining worker failed:', error);
        }
    });
    console.log('[ML Cron] ✅ Automatic retraining cron job scheduled (every hour)');
}
/**
 * Run worker manually (for testing)
 */
async function runRetrainingWorkerManual() {
    console.log('[ML Cron] Running retraining worker manually...');
    try {
        await (0, ml_retraining_scheduler_service_1.retrainingWorker)();
        console.log('[ML Cron] ✅ Manual retraining worker completed');
    }
    catch (error) {
        console.error('[ML Cron] ❌ Manual retraining worker failed:', error);
        throw error;
    }
}
