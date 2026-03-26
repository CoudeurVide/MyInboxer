"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnsubscribeServiceFactory = void 0;
// backend/src/services/unsubscribe/unsubscribe-service-factory.ts
const unsubscribe_service_1 = require("./unsubscribe-service");
class UnsubscribeServiceFactory {
    static create(config) {
        return new unsubscribe_service_1.UnsubscribeService({
            unsubscriberApiUrl: config.unsubscriberApiUrl,
            requestTimeout: config.requestTimeout || 60000
        });
    }
}
exports.UnsubscribeServiceFactory = UnsubscribeServiceFactory;
