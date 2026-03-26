"use strict";
/**
 * Common types shared between frontend and backend
 * Based on ARCHITECTURE.md database schema
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubscriptionStatus = exports.SubscriptionPlan = exports.AlertStatus = exports.AlertChannel = exports.AlertType = exports.MessagePriority = exports.MessageVerdict = exports.ScanFrequency = exports.MailboxStatus = exports.EmailProvider = exports.Role = void 0;
// ============================================================================
// User & Authentication
// ============================================================================
var Role;
(function (Role) {
    Role["OWNER"] = "owner";
    Role["ADMIN"] = "admin";
    Role["MEMBER"] = "member";
    Role["READONLY"] = "readonly";
})(Role || (exports.Role = Role = {}));
// ============================================================================
// Mailbox & Email Provider
// ============================================================================
var EmailProvider;
(function (EmailProvider) {
    EmailProvider["GMAIL"] = "gmail";
    EmailProvider["OUTLOOK"] = "outlook";
})(EmailProvider || (exports.EmailProvider = EmailProvider = {}));
var MailboxStatus;
(function (MailboxStatus) {
    MailboxStatus["ACTIVE"] = "active";
    MailboxStatus["PAUSED"] = "paused";
    MailboxStatus["DISCONNECTED"] = "disconnected";
    MailboxStatus["ERROR"] = "error";
})(MailboxStatus || (exports.MailboxStatus = MailboxStatus = {}));
var ScanFrequency;
(function (ScanFrequency) {
    ScanFrequency["HOURLY"] = "hourly";
    ScanFrequency["EVERY_6_HOURS"] = "every_6_hours";
    ScanFrequency["DAILY"] = "daily";
    ScanFrequency["WEEKLY"] = "weekly";
})(ScanFrequency || (exports.ScanFrequency = ScanFrequency = {}));
// ============================================================================
// Message & Classification
// ============================================================================
var MessageVerdict;
(function (MessageVerdict) {
    MessageVerdict["LEAD"] = "lead";
    MessageVerdict["SPAM"] = "spam";
    MessageVerdict["PROMOTION"] = "promotion";
    MessageVerdict["CLEAN"] = "clean";
})(MessageVerdict || (exports.MessageVerdict = MessageVerdict = {}));
var MessagePriority;
(function (MessagePriority) {
    MessagePriority["HIGH"] = "high";
    MessagePriority["MEDIUM"] = "medium";
    MessagePriority["LOW"] = "low";
})(MessagePriority || (exports.MessagePriority = MessagePriority = {}));
// ============================================================================
// Alert & Notification
// ============================================================================
var AlertType;
(function (AlertType) {
    AlertType["NEW_LEAD"] = "new_lead";
    AlertType["SCAN_COMPLETE"] = "scan_complete";
    AlertType["SCAN_ERROR"] = "scan_error";
    AlertType["MAILBOX_DISCONNECTED"] = "mailbox_disconnected";
})(AlertType || (exports.AlertType = AlertType = {}));
var AlertChannel;
(function (AlertChannel) {
    AlertChannel["EMAIL"] = "email";
    AlertChannel["SMS"] = "sms";
    AlertChannel["WEBHOOK"] = "webhook";
})(AlertChannel || (exports.AlertChannel = AlertChannel = {}));
var AlertStatus;
(function (AlertStatus) {
    AlertStatus["PENDING"] = "pending";
    AlertStatus["SENT"] = "sent";
    AlertStatus["FAILED"] = "failed";
})(AlertStatus || (exports.AlertStatus = AlertStatus = {}));
// ============================================================================
// Subscription & Billing
// ============================================================================
var SubscriptionPlan;
(function (SubscriptionPlan) {
    SubscriptionPlan["FREE"] = "free";
    SubscriptionPlan["STARTER"] = "starter";
    SubscriptionPlan["GROWTH"] = "growth";
    SubscriptionPlan["BUSINESS"] = "business";
})(SubscriptionPlan || (exports.SubscriptionPlan = SubscriptionPlan = {}));
var SubscriptionStatus;
(function (SubscriptionStatus) {
    SubscriptionStatus["ACTIVE"] = "active";
    SubscriptionStatus["CANCELLED"] = "cancelled";
    SubscriptionStatus["PAST_DUE"] = "past_due";
    SubscriptionStatus["TRIALING"] = "trialing";
})(SubscriptionStatus || (exports.SubscriptionStatus = SubscriptionStatus = {}));
