"use strict";
/**
 * Password Service
 * Handles password hashing and validation with bcrypt
 * Based on SECURITY.md specifications
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.passwordService = exports.PasswordService = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
class PasswordService {
    SALT_ROUNDS = 12; // bcrypt work factor (~300ms on modern CPU)
    /**
     * Hash password with bcrypt (12 rounds)
     * @param plainPassword - Plain text password
     * @returns Hashed password
     */
    async hashPassword(plainPassword) {
        return bcryptjs_1.default.hash(plainPassword, this.SALT_ROUNDS);
    }
    /**
     * Compare password with hash (constant-time comparison)
     * @param plainPassword - Plain text password
     * @param hashedPassword - Hashed password from database
     * @returns True if password matches
     */
    async comparePassword(plainPassword, hashedPassword) {
        return bcryptjs_1.default.compare(plainPassword, hashedPassword);
    }
    /**
     * Validate password strength
     * Requirements:
     * - Minimum 12 characters
     * - At least one uppercase letter
     * - At least one lowercase letter
     * - At least one number
     *
     * @param password - Password to validate
     * @throws Error if password doesn't meet requirements
     */
    validatePasswordStrength(password) {
        if (password.length < 12) {
            throw new Error('Password must be at least 12 characters');
        }
        if (!/[A-Z]/.test(password)) {
            throw new Error('Password must contain at least one uppercase letter');
        }
        if (!/[a-z]/.test(password)) {
            throw new Error('Password must contain at least one lowercase letter');
        }
        if (!/[0-9]/.test(password)) {
            throw new Error('Password must contain at least one number');
        }
    }
}
exports.PasswordService = PasswordService;
// Export singleton instance
exports.passwordService = new PasswordService();
