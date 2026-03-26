"use strict";
/**
 * Application logger
 * Simple console-based logger with level control
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
const config_1 = require("./config");
// Helper function to create logger instances with bindings
const createLoggerInstance = (bindings = {}) => {
    return {
        fatal: (msg, ...args) => {
            console.error(`[FATAL] ${bindings.label || ''} ${msg}`, ...args);
        },
        info: (msg, ...args) => {
            if (config_1.config.env !== 'production') {
                console.log(`[INFO] ${bindings.label || ''} ${msg}`, ...args);
            }
        },
        warn: (msg, ...args) => {
            if (config_1.config.env !== 'production') {
                console.warn(`[WARN] ${bindings.label || ''} ${msg}`, ...args);
            }
        },
        error: (msg, ...args) => {
            console.error(`[ERROR] ${bindings.label || ''} ${msg}`, ...args);
        },
        debug: (msg, ...args) => {
            if (config_1.config.env === 'development') {
                console.debug(`[DEBUG] ${bindings.label || ''} ${msg}`, ...args);
            }
        },
        trace: (msg, ...args) => {
            if (config_1.config.env === 'development') {
                console.trace(`[TRACE] ${bindings.label || ''} ${msg}`, ...args);
            }
        },
        child: (childBindings, opts) => {
            // Allow chaining child loggers with additional bindings
            const mergedBindings = { ...bindings, ...childBindings };
            return createLoggerInstance(mergedBindings);
        },
    };
};
// Export the default logger instance
exports.logger = createLoggerInstance();
