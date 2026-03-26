"use strict";
/**
 * MFA (Multi-Factor Authentication) Service
 * Handles TOTP-based 2FA using Google Authenticator / Microsoft Authenticator
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateMFASecret = generateMFASecret;
exports.verifyMFASetup = verifyMFASetup;
exports.verifyMFALogin = verifyMFALogin;
exports.disableMFA = disableMFA;
exports.isMFAEnabled = isMFAEnabled;
exports.regenerateBackupCodes = regenerateBackupCodes;
const speakeasy_1 = __importDefault(require("speakeasy"));
const qrcode_1 = __importDefault(require("qrcode"));
const crypto_1 = __importDefault(require("crypto"));
const prisma_1 = require("../lib/prisma");
const encryption_service_1 = require("./encryption.service");
const APP_NAME = 'MyInboxer';
/**
 * Generate MFA secret and QR code for user setup
 */
async function generateMFASecret(userId, userEmail) {
    // Generate secret
    const secret = speakeasy_1.default.generateSecret({
        name: `${APP_NAME} (${userEmail})`,
        issuer: APP_NAME,
        length: 32,
    });
    if (!secret.otpauth_url || !secret.base32) {
        throw new Error('Failed to generate MFA secret');
    }
    // Generate QR code
    const qrCodeUrl = await qrcode_1.default.toDataURL(secret.otpauth_url);
    // Generate 10 backup codes (8 characters each)
    const backupCodes = Array.from({ length: 10 }, () => crypto_1.default.randomBytes(4).toString('hex').toUpperCase());
    // Encrypt and store secret (but don't enable MFA yet - wait for verification)
    const encryptedSecret = encryption_service_1.encryptionService.encryptField(secret.base32);
    const encryptedBackupCodes = backupCodes.map(code => encryption_service_1.encryptionService.encryptField(code));
    await prisma_1.prisma.user.update({
        where: { id: userId },
        data: {
            mfa_secret: encryptedSecret,
            // Store backup codes in a separate table or JSON field
            // For now, we'll add them when MFA is verified
        },
    });
    return {
        secret: secret.base32,
        qrCodeUrl,
        backupCodes,
        manualEntryKey: secret.base32,
    };
}
/**
 * Verify TOTP code during MFA setup
 */
async function verifyMFASetup(userId, token) {
    const user = await prisma_1.prisma.user.findUnique({
        where: { id: userId },
        select: { mfa_secret: true, mfa_enabled: true },
    });
    if (!user || !user.mfa_secret) {
        throw new Error('MFA not set up for this user');
    }
    if (user.mfa_enabled) {
        throw new Error('MFA already enabled');
    }
    // Decrypt secret
    const secret = encryption_service_1.encryptionService.decryptField(user.mfa_secret);
    // Verify token
    const verified = speakeasy_1.default.totp.verify({
        secret,
        encoding: 'base32',
        token,
        window: 2, // Allow 2 time steps before/after for clock drift
    });
    if (verified) {
        // Enable MFA
        await prisma_1.prisma.user.update({
            where: { id: userId },
            data: {
                mfa_enabled: true,
                mfa_verified_at: new Date(),
            },
        });
    }
    return verified;
}
/**
 * Verify TOTP code during login
 */
async function verifyMFALogin(userId, token) {
    const user = await prisma_1.prisma.user.findUnique({
        where: { id: userId },
        select: { mfa_secret: true, mfa_enabled: true },
    });
    if (!user || !user.mfa_enabled || !user.mfa_secret) {
        throw new Error('MFA not enabled for this user');
    }
    // Decrypt secret
    const secret = encryption_service_1.encryptionService.decryptField(user.mfa_secret);
    // Verify token
    const verified = speakeasy_1.default.totp.verify({
        secret,
        encoding: 'base32',
        token,
        window: 2,
    });
    return {
        valid: verified,
    };
}
/**
 * Disable MFA for user (requires password or backup code)
 */
async function disableMFA(userId) {
    await prisma_1.prisma.user.update({
        where: { id: userId },
        data: {
            mfa_enabled: false,
            mfa_secret: null,
            mfa_verified_at: null,
        },
    });
}
/**
 * Check if user has MFA enabled
 */
async function isMFAEnabled(userId) {
    const user = await prisma_1.prisma.user.findUnique({
        where: { id: userId },
        select: { mfa_enabled: true },
    });
    return user?.mfa_enabled || false;
}
/**
 * Generate new backup codes (requires current MFA verification)
 */
async function regenerateBackupCodes(userId) {
    // Generate 10 new backup codes
    const backupCodes = Array.from({ length: 10 }, () => crypto_1.default.randomBytes(4).toString('hex').toUpperCase());
    // TODO: Store encrypted backup codes in database
    // For now, return them to be displayed once to user
    return backupCodes;
}
