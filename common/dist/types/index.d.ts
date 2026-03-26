/**
 * Common types shared between frontend and backend
 * Based on ARCHITECTURE.md database schema
 */
export declare enum Role {
    OWNER = "owner",
    ADMIN = "admin",
    MEMBER = "member",
    READONLY = "readonly"
}
export interface User {
    id: string;
    email: string;
    password_hash: string;
    role: Role;
    mfa_enabled: boolean;
    mfa_secret: string | null;
    mfa_verified_at: Date | null;
    created_at: Date;
    updated_at: Date;
}
export interface TokenPayload {
    userId: string;
    email: string;
    role: Role;
}
export declare enum EmailProvider {
    GMAIL = "gmail",
    OUTLOOK = "outlook"
}
export declare enum MailboxStatus {
    ACTIVE = "active",
    PAUSED = "paused",
    DISCONNECTED = "disconnected",
    ERROR = "error"
}
export declare enum ScanFrequency {
    HOURLY = "hourly",
    EVERY_6_HOURS = "every_6_hours",
    DAILY = "daily",
    WEEKLY = "weekly"
}
export interface Mailbox {
    id: string;
    user_id: string;
    provider: EmailProvider;
    email_address: string;
    access_token_encrypted: string;
    refresh_token_encrypted: string;
    tokens_updated_at: Date;
    status: MailboxStatus;
    scan_frequency: ScanFrequency;
    last_scan_at: Date | null;
    notification_enabled: boolean;
    auto_whitelist_enabled: boolean;
    created_at: Date;
    updated_at: Date;
}
export declare enum MessageVerdict {
    LEAD = "lead",
    SPAM = "spam",
    PROMOTION = "promotion",
    CLEAN = "clean"
}
export declare enum MessagePriority {
    HIGH = "high",
    MEDIUM = "medium",
    LOW = "low"
}
export interface Message {
    id: string;
    mailbox_id: string;
    provider_message_id: string;
    subject: string;
    sender_email: string;
    sender_name: string | null;
    recipient_email: string;
    body_text: string;
    body_html: string | null;
    verdict: MessageVerdict;
    priority: MessagePriority;
    confidence_score: number;
    classification_reason: string;
    user_verdict: MessageVerdict | null;
    reviewed_at: Date | null;
    received_at: Date;
    created_at: Date;
}
export declare enum AlertType {
    NEW_LEAD = "new_lead",
    SCAN_COMPLETE = "scan_complete",
    SCAN_ERROR = "scan_error",
    MAILBOX_DISCONNECTED = "mailbox_disconnected"
}
export declare enum AlertChannel {
    EMAIL = "email",
    SMS = "sms",
    WEBHOOK = "webhook"
}
export declare enum AlertStatus {
    PENDING = "pending",
    SENT = "sent",
    FAILED = "failed"
}
export interface Alert {
    id: string;
    mailbox_id: string;
    type: AlertType;
    channel: AlertChannel;
    status: AlertStatus;
    payload: Record<string, any>;
    sent_at: Date | null;
    created_at: Date;
}
export interface Webhook {
    id: string;
    user_id: string;
    url: string;
    secret: string;
    events: string[];
    enabled: boolean;
    created_at: Date;
    updated_at: Date;
}
export declare enum SubscriptionPlan {
    FREE = "free",
    STARTER = "starter",
    GROWTH = "growth",
    BUSINESS = "business"
}
export declare enum SubscriptionStatus {
    ACTIVE = "active",
    CANCELLED = "cancelled",
    PAST_DUE = "past_due",
    TRIALING = "trialing"
}
export interface Subscription {
    id: string;
    user_id: string;
    plan: SubscriptionPlan;
    status: SubscriptionStatus;
    current_period_start: Date;
    current_period_end: Date;
    cancel_at: Date | null;
    created_at: Date;
    updated_at: Date;
}
export interface AuditLog {
    id: string;
    user_id: string | null;
    action: string;
    resource: string;
    resource_id: string | null;
    details: Record<string, any> | null;
    ip_address: string;
    user_agent: string;
    status: 'success' | 'failure';
    timestamp: Date;
}
export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    error?: {
        code: string;
        message: string;
        details?: any;
    };
}
export interface PaginatedResponse<T> {
    items: T[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
}
export interface CreateMailboxRequest {
    provider: EmailProvider;
    email_address: string;
    access_token: string;
    refresh_token: string;
}
export interface UpdateMailboxRequest {
    scan_frequency?: ScanFrequency;
    notification_enabled?: boolean;
    auto_whitelist_enabled?: boolean;
}
export interface ReviewMessageRequest {
    user_verdict: MessageVerdict;
}
export interface LoginRequest {
    email: string;
    password: string;
}
export interface LoginResponse {
    access_token: string;
    refresh_token: string;
    user: {
        id: string;
        email: string;
        role: Role;
    };
}
export interface RegisterRequest {
    email: string;
    password: string;
}
//# sourceMappingURL=index.d.ts.map