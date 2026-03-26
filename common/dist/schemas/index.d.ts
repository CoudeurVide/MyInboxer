/**
 * Zod validation schemas for API requests
 * Based on PRD.md API specifications
 */
import { z } from 'zod';
import { EmailProvider, MessageVerdict, ScanFrequency } from '../types';
export declare const RegisterSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
    password: string;
}, {
    email: string;
    password: string;
}>;
export declare const LoginSchema: z.ZodObject<{
    email: z.ZodString;
    password: z.ZodString;
}, "strip", z.ZodTypeAny, {
    email: string;
    password: string;
}, {
    email: string;
    password: string;
}>;
export declare const RefreshTokenSchema: z.ZodObject<{
    refresh_token: z.ZodString;
}, "strip", z.ZodTypeAny, {
    refresh_token: string;
}, {
    refresh_token: string;
}>;
export declare const CreateMailboxSchema: z.ZodObject<{
    provider: z.ZodNativeEnum<typeof EmailProvider>;
    email_address: z.ZodString;
    access_token: z.ZodString;
    refresh_token: z.ZodString;
}, "strip", z.ZodTypeAny, {
    refresh_token: string;
    provider: EmailProvider;
    email_address: string;
    access_token: string;
}, {
    refresh_token: string;
    provider: EmailProvider;
    email_address: string;
    access_token: string;
}>;
export declare const UpdateMailboxSchema: z.ZodObject<{
    scan_frequency: z.ZodOptional<z.ZodNativeEnum<typeof ScanFrequency>>;
    notification_enabled: z.ZodOptional<z.ZodBoolean>;
    auto_whitelist_enabled: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    scan_frequency?: ScanFrequency | undefined;
    notification_enabled?: boolean | undefined;
    auto_whitelist_enabled?: boolean | undefined;
}, {
    scan_frequency?: ScanFrequency | undefined;
    notification_enabled?: boolean | undefined;
    auto_whitelist_enabled?: boolean | undefined;
}>;
export declare const ReviewMessageSchema: z.ZodObject<{
    user_verdict: z.ZodNativeEnum<typeof MessageVerdict>;
}, "strip", z.ZodTypeAny, {
    user_verdict: MessageVerdict;
}, {
    user_verdict: MessageVerdict;
}>;
export declare const ListMessagesQuerySchema: z.ZodObject<{
    mailbox_id: z.ZodOptional<z.ZodString>;
    verdict: z.ZodOptional<z.ZodNativeEnum<typeof MessageVerdict>>;
    reviewed: z.ZodOptional<z.ZodEnum<["true", "false"]>>;
    page: z.ZodDefault<z.ZodOptional<z.ZodString>>;
    limit: z.ZodDefault<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    page: string;
    limit: string;
    mailbox_id?: string | undefined;
    verdict?: MessageVerdict | undefined;
    reviewed?: "true" | "false" | undefined;
}, {
    mailbox_id?: string | undefined;
    verdict?: MessageVerdict | undefined;
    reviewed?: "true" | "false" | undefined;
    page?: string | undefined;
    limit?: string | undefined;
}>;
export declare const CreateWebhookSchema: z.ZodObject<{
    url: z.ZodString;
    events: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    url: string;
    events: string[];
}, {
    url: string;
    events: string[];
}>;
export declare const UpdateWebhookSchema: z.ZodObject<{
    url: z.ZodOptional<z.ZodString>;
    events: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    enabled: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    url?: string | undefined;
    events?: string[] | undefined;
    enabled?: boolean | undefined;
}, {
    url?: string | undefined;
    events?: string[] | undefined;
    enabled?: boolean | undefined;
}>;
export declare const UpdateUserSchema: z.ZodObject<{
    email: z.ZodOptional<z.ZodString>;
    password: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    email?: string | undefined;
    password?: string | undefined;
}, {
    email?: string | undefined;
    password?: string | undefined;
}>;
export declare const schemas: {
    auth: {
        register: z.ZodObject<{
            email: z.ZodString;
            password: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            email: string;
            password: string;
        }, {
            email: string;
            password: string;
        }>;
        login: z.ZodObject<{
            email: z.ZodString;
            password: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            email: string;
            password: string;
        }, {
            email: string;
            password: string;
        }>;
        refreshToken: z.ZodObject<{
            refresh_token: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            refresh_token: string;
        }, {
            refresh_token: string;
        }>;
    };
    mailbox: {
        create: z.ZodObject<{
            provider: z.ZodNativeEnum<typeof EmailProvider>;
            email_address: z.ZodString;
            access_token: z.ZodString;
            refresh_token: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            refresh_token: string;
            provider: EmailProvider;
            email_address: string;
            access_token: string;
        }, {
            refresh_token: string;
            provider: EmailProvider;
            email_address: string;
            access_token: string;
        }>;
        update: z.ZodObject<{
            scan_frequency: z.ZodOptional<z.ZodNativeEnum<typeof ScanFrequency>>;
            notification_enabled: z.ZodOptional<z.ZodBoolean>;
            auto_whitelist_enabled: z.ZodOptional<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            scan_frequency?: ScanFrequency | undefined;
            notification_enabled?: boolean | undefined;
            auto_whitelist_enabled?: boolean | undefined;
        }, {
            scan_frequency?: ScanFrequency | undefined;
            notification_enabled?: boolean | undefined;
            auto_whitelist_enabled?: boolean | undefined;
        }>;
    };
    message: {
        review: z.ZodObject<{
            user_verdict: z.ZodNativeEnum<typeof MessageVerdict>;
        }, "strip", z.ZodTypeAny, {
            user_verdict: MessageVerdict;
        }, {
            user_verdict: MessageVerdict;
        }>;
        listQuery: z.ZodObject<{
            mailbox_id: z.ZodOptional<z.ZodString>;
            verdict: z.ZodOptional<z.ZodNativeEnum<typeof MessageVerdict>>;
            reviewed: z.ZodOptional<z.ZodEnum<["true", "false"]>>;
            page: z.ZodDefault<z.ZodOptional<z.ZodString>>;
            limit: z.ZodDefault<z.ZodOptional<z.ZodString>>;
        }, "strip", z.ZodTypeAny, {
            page: string;
            limit: string;
            mailbox_id?: string | undefined;
            verdict?: MessageVerdict | undefined;
            reviewed?: "true" | "false" | undefined;
        }, {
            mailbox_id?: string | undefined;
            verdict?: MessageVerdict | undefined;
            reviewed?: "true" | "false" | undefined;
            page?: string | undefined;
            limit?: string | undefined;
        }>;
    };
    webhook: {
        create: z.ZodObject<{
            url: z.ZodString;
            events: z.ZodArray<z.ZodString, "many">;
        }, "strip", z.ZodTypeAny, {
            url: string;
            events: string[];
        }, {
            url: string;
            events: string[];
        }>;
        update: z.ZodObject<{
            url: z.ZodOptional<z.ZodString>;
            events: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
            enabled: z.ZodOptional<z.ZodBoolean>;
        }, "strip", z.ZodTypeAny, {
            url?: string | undefined;
            events?: string[] | undefined;
            enabled?: boolean | undefined;
        }, {
            url?: string | undefined;
            events?: string[] | undefined;
            enabled?: boolean | undefined;
        }>;
    };
    user: {
        update: z.ZodObject<{
            email: z.ZodOptional<z.ZodString>;
            password: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            email?: string | undefined;
            password?: string | undefined;
        }, {
            email?: string | undefined;
            password?: string | undefined;
        }>;
    };
};
//# sourceMappingURL=index.d.ts.map