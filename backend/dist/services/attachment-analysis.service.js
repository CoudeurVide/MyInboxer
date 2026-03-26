"use strict";
/**
 * Attachment Analysis Service
 * Phase 2 Enhancement: Malware prevention and attachment risk scoring
 *
 * This service analyzes email attachments to:
 * - Detect dangerous file extensions (executables, scripts)
 * - Identify macro-enabled documents (Office files with macros)
 * - Check for password-protected files (evades scanning)
 * - Detect large attachments (>10MB, unusual for legitimate business)
 * - Find mismatched extensions (obfuscation techniques like file.pdf.exe)
 * - Calculate risk score (0-100) and provide verdict overrides
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.attachmentAnalyzer = void 0;
exports.analyzeAttachments = analyzeAttachments;
exports.applyAttachmentAnalysis = applyAttachmentAnalysis;
exports.getAttachmentStats = getAttachmentStats;
/**
 * Attachment Analysis Service
 * Detects malicious attachments and calculates risk scores
 */
class AttachmentAnalyzer {
    // Dangerous executable extensions (high risk)
    DANGEROUS_EXTENSIONS = new Set([
        // Windows executables
        '.exe', '.scr', '.bat', '.cmd', '.com', '.pif', '.msi', '.msp',
        '.vbs', '.vbe', '.js', '.jse', '.wsf', '.wsh', '.ps1', '.psm1',
        // Cross-platform executables
        '.app', '.deb', '.rpm', '.dmg', '.pkg',
        // Scripts and code
        '.jar', '.py', '.rb', '.sh', '.bash', '.zsh',
        // Other dangerous
        '.hta', '.cpl', '.scf', '.lnk', '.inf', '.reg'
    ]);
    // Macro-enabled Office documents (medium-high risk)
    MACRO_EXTENSIONS = new Set([
        '.docm', '.dotm', // Word with macros
        '.xlsm', '.xltm', '.xlam', // Excel with macros
        '.pptm', '.potm', '.ppam', '.ppsm', // PowerPoint with macros
        '.xlsb' // Excel binary with macros
    ]);
    // Archive file extensions (can contain dangerous files)
    ARCHIVE_EXTENSIONS = new Set([
        '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz',
        '.tar.gz', '.tgz', '.tar.bz2', '.tbz2'
    ]);
    // Suspicious double extensions (obfuscation technique)
    COMMON_SAFE_EXTENSIONS = new Set([
        '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
        '.txt', '.jpg', '.jpeg', '.png', '.gif', '.bmp'
    ]);
    // Large attachment threshold (10MB)
    LARGE_ATTACHMENT_THRESHOLD = 10 * 1024 * 1024; // 10MB in bytes
    /**
     * Extract file extension from filename
     */
    getExtension(filename) {
        const normalized = filename.toLowerCase().trim();
        // Handle double extensions (e.g., .tar.gz)
        const doubleExtMatch = normalized.match(/\.(tar\.gz|tar\.bz2|tar\.xz)$/);
        if (doubleExtMatch) {
            return doubleExtMatch[1];
        }
        // Single extension
        const lastDot = normalized.lastIndexOf('.');
        if (lastDot === -1)
            return '';
        return normalized.substring(lastDot);
    }
    /**
     * Detect dangerous file extensions
     */
    detectDangerousExtension(attachment) {
        const extension = this.getExtension(attachment.filename);
        if (this.DANGEROUS_EXTENSIONS.has(extension)) {
            return {
                detected: true,
                reason: `Dangerous executable file: ${attachment.filename} (${extension})`
            };
        }
        return { detected: false, reason: '' };
    }
    /**
     * Detect macro-enabled documents
     */
    detectMacroDocument(attachment) {
        const extension = this.getExtension(attachment.filename);
        if (this.MACRO_EXTENSIONS.has(extension)) {
            return {
                detected: true,
                reason: `Macro-enabled document: ${attachment.filename} (${extension})`
            };
        }
        return { detected: false, reason: '' };
    }
    /**
     * Detect password-protected files (evades scanning)
     */
    detectPasswordProtected(attachment) {
        if (attachment.isPasswordProtected) {
            return {
                detected: true,
                reason: `Password-protected file: ${attachment.filename} (evades antivirus scanning)`
            };
        }
        return { detected: false, reason: '' };
    }
    /**
     * Detect large attachments (>10MB unusual for legitimate business)
     */
    detectLargeAttachment(attachment) {
        if (attachment.size && attachment.size > this.LARGE_ATTACHMENT_THRESHOLD) {
            const sizeMB = (attachment.size / (1024 * 1024)).toFixed(2);
            return {
                detected: true,
                reason: `Large attachment: ${attachment.filename} (${sizeMB}MB)`
            };
        }
        return { detected: false, reason: '' };
    }
    /**
     * Detect mismatched/double extensions (obfuscation technique)
     * Example: file.pdf.exe (looks like PDF but is executable)
     */
    detectMismatchedExtension(attachment) {
        const filename = attachment.filename.toLowerCase();
        // Check for multiple dots (double extension pattern)
        const parts = filename.split('.');
        if (parts.length >= 3) {
            // Get second-to-last extension (e.g., "pdf" in "file.pdf.exe")
            const penultimateExt = '.' + parts[parts.length - 2];
            const finalExt = '.' + parts[parts.length - 1];
            // If penultimate looks safe but final is dangerous, it's obfuscation
            if (this.COMMON_SAFE_EXTENSIONS.has(penultimateExt) &&
                this.DANGEROUS_EXTENSIONS.has(finalExt)) {
                return {
                    detected: true,
                    reason: `Mismatched extension: ${attachment.filename} (disguised ${penultimateExt} but actually ${finalExt})`
                };
            }
        }
        return { detected: false, reason: '' };
    }
    /**
     * Detect archives that might contain executables
     * Note: We can't actually inspect archive contents without extracting,
     * but we can flag suspicious patterns
     */
    detectArchiveWithExecutable(attachment) {
        const extension = this.getExtension(attachment.filename);
        const filename = attachment.filename.toLowerCase();
        if (this.ARCHIVE_EXTENSIONS.has(extension)) {
            // Suspicious archive names that suggest executable content
            const suspiciousPatterns = [
                /setup/i, /install/i, /update/i, /patch/i,
                /crack/i, /keygen/i, /loader/i, /activat/i
            ];
            const hasSuspiciousName = suspiciousPatterns.some(pattern => pattern.test(filename));
            if (hasSuspiciousName) {
                return {
                    detected: true,
                    reason: `Suspicious archive: ${attachment.filename} (likely contains executable)`
                };
            }
            // Archives are medium risk even without suspicious names
            // (can't scan contents without extraction)
            return {
                detected: false,
                reason: '' // Don't flag all archives, just note for risk scoring
            };
        }
        return { detected: false, reason: '' };
    }
    /**
     * Analyze all attachments in an email
     */
    async analyzeAttachments(email) {
        const attachments = email.attachments || [];
        const reasons = [];
        let riskScore = 0;
        // If no attachments, return safe analysis
        if (attachments.length === 0) {
            return {
                hasDangerousExtension: false,
                hasMacroDocument: false,
                hasPasswordProtected: false,
                hasLargeAttachment: false,
                hasMismatchedExtension: false,
                hasArchiveWithExecutable: false,
                totalAttachments: 0,
                totalSize: 0,
                riskScore: 0,
                riskLevel: 'none',
                shouldOverrideVerdict: false,
                reasons: ['No attachments']
            };
        }
        // Track detection flags
        let hasDangerousExtension = false;
        let hasMacroDocument = false;
        let hasPasswordProtected = false;
        let hasLargeAttachment = false;
        let hasMismatchedExtension = false;
        let hasArchiveWithExecutable = false;
        // Calculate total size
        const totalSize = attachments.reduce((sum, att) => sum + (att.size || 0), 0);
        // Analyze each attachment
        for (const attachment of attachments) {
            // Check dangerous extension
            const dangerousExt = this.detectDangerousExtension(attachment);
            if (dangerousExt.detected) {
                hasDangerousExtension = true;
                riskScore += 60; // Critical risk
                reasons.push(dangerousExt.reason);
            }
            // Check macro document
            const macroDoc = this.detectMacroDocument(attachment);
            if (macroDoc.detected) {
                hasMacroDocument = true;
                riskScore += 40; // High risk
                reasons.push(macroDoc.reason);
            }
            // Check password protected
            const passwordProtected = this.detectPasswordProtected(attachment);
            if (passwordProtected.detected) {
                hasPasswordProtected = true;
                riskScore += 35; // High risk (evades scanning)
                reasons.push(passwordProtected.reason);
            }
            // Check large attachment
            const largeAttachment = this.detectLargeAttachment(attachment);
            if (largeAttachment.detected) {
                hasLargeAttachment = true;
                riskScore += 20; // Medium risk
                reasons.push(largeAttachment.reason);
            }
            // Check mismatched extension
            const mismatchedExt = this.detectMismatchedExtension(attachment);
            if (mismatchedExt.detected) {
                hasMismatchedExtension = true;
                riskScore += 50; // Critical risk (obfuscation)
                reasons.push(mismatchedExt.reason);
            }
            // Check archive with executable
            const archiveExe = this.detectArchiveWithExecutable(attachment);
            if (archiveExe.detected) {
                hasArchiveWithExecutable = true;
                riskScore += 45; // High risk
                reasons.push(archiveExe.reason);
            }
            // Medium risk for plain archives (not flagged above)
            const extension = this.getExtension(attachment.filename);
            if (this.ARCHIVE_EXTENSIONS.has(extension) && !archiveExe.detected) {
                riskScore += 15; // Small penalty for archives
                reasons.push(`Archive file: ${attachment.filename} (cannot scan contents)`);
            }
        }
        // Additional risk: Multiple attachments (spam pattern)
        if (attachments.length > 5) {
            riskScore += 10;
            reasons.push(`Excessive attachments: ${attachments.length} files (spam pattern)`);
        }
        // Normalize risk score to 0-100
        riskScore = Math.min(100, riskScore);
        // Determine risk level
        let riskLevel;
        if (riskScore >= 80)
            riskLevel = 'critical';
        else if (riskScore >= 60)
            riskLevel = 'high';
        else if (riskScore >= 40)
            riskLevel = 'medium';
        else if (riskScore >= 20)
            riskLevel = 'low';
        else
            riskLevel = 'none';
        // Should override verdict to spam if risk >= 60 (high or critical)
        const shouldOverrideVerdict = riskScore >= 60;
        if (reasons.length === 0) {
            reasons.push(`${attachments.length} attachment(s) analyzed - no threats detected`);
        }
        return {
            hasDangerousExtension,
            hasMacroDocument,
            hasPasswordProtected,
            hasLargeAttachment,
            hasMismatchedExtension,
            hasArchiveWithExecutable,
            totalAttachments: attachments.length,
            totalSize,
            riskScore,
            riskLevel,
            shouldOverrideVerdict,
            reasons
        };
    }
    /**
     * Apply attachment analysis to classification verdict
     * This should be called AFTER base classification
     */
    applyAttachmentAnalysis(baseVerdict, baseConfidence, attachmentAnalysis) {
        let adjustedVerdict = baseVerdict;
        let adjustedConfidence = baseConfidence;
        // CRITICAL OVERRIDE: High-risk or critical attachments = force spam
        if (attachmentAnalysis.shouldOverrideVerdict) {
            adjustedVerdict = 'spam';
            adjustedConfidence = Math.max(0.85, baseConfidence); // High confidence in malware detection
            console.log(`[Attachment] Overriding ${baseVerdict} → spam (risk score: ${attachmentAnalysis.riskScore})`);
        }
        // DANGEROUS EXTENSION: Always spam
        else if (attachmentAnalysis.hasDangerousExtension) {
            adjustedVerdict = 'spam';
            adjustedConfidence = Math.max(0.90, baseConfidence); // Very high confidence
            console.log(`[Attachment] Overriding ${baseVerdict} → spam (dangerous executable detected)`);
        }
        // MISMATCHED EXTENSION: Always spam (obfuscation technique)
        else if (attachmentAnalysis.hasMismatchedExtension) {
            adjustedVerdict = 'spam';
            adjustedConfidence = Math.max(0.88, baseConfidence);
            console.log(`[Attachment] Overriding ${baseVerdict} → spam (mismatched extension obfuscation)`);
        }
        // MEDIUM RISK: Adjust confidence downward for legit
        else if (attachmentAnalysis.riskScore >= 40 && baseVerdict === 'legit') {
            adjustedConfidence -= 0.15; // Reduce confidence in legit classification
            console.log(`[Attachment] Reducing legit confidence due to medium-risk attachments`);
        }
        // LOW RISK: Small adjustment
        else if (attachmentAnalysis.riskScore >= 20) {
            adjustedConfidence -= 0.05; // Small penalty
        }
        // Normalize confidence
        adjustedConfidence = Math.min(1, Math.max(0, adjustedConfidence));
        return {
            verdict: adjustedVerdict,
            confidence: adjustedConfidence,
            reason: attachmentAnalysis.reasons.join('; ')
        };
    }
    /**
     * Get detailed attachment statistics for a message
     * Useful for analytics and debugging
     */
    getAttachmentStats(email) {
        const attachments = email.attachments || [];
        const types = {};
        let largestFile = null;
        let largestSize = 0;
        attachments.forEach(att => {
            const ext = this.getExtension(att.filename) || 'unknown';
            types[ext] = (types[ext] || 0) + 1;
            if (att.size && att.size > largestSize) {
                largestSize = att.size;
                largestFile = att.filename;
            }
        });
        const totalSize = attachments.reduce((sum, att) => sum + (att.size || 0), 0);
        return {
            count: attachments.length,
            totalSizeMB: totalSize / (1024 * 1024),
            types,
            largestFile,
            largestSizeMB: largestSize / (1024 * 1024)
        };
    }
}
// Export singleton instance
exports.attachmentAnalyzer = new AttachmentAnalyzer();
/**
 * Main export: Analyze attachments in an email
 */
async function analyzeAttachments(email) {
    return exports.attachmentAnalyzer.analyzeAttachments(email);
}
/**
 * Apply attachment analysis to classification verdict
 */
function applyAttachmentAnalysis(baseVerdict, baseConfidence, attachmentAnalysis) {
    return exports.attachmentAnalyzer.applyAttachmentAnalysis(baseVerdict, baseConfidence, attachmentAnalysis);
}
/**
 * Get attachment statistics
 */
function getAttachmentStats(email) {
    return exports.attachmentAnalyzer.getAttachmentStats(email);
}
