"use strict";
/**
 * VirusTotal Integration Service
 * Phase 3B: Advanced malware detection using VirusTotal API
 *
 * This service provides:
 * - File hash reputation checking
 * - Real-time file scanning
 * - Malware detection with industry-standard engines
 * - Result caching to minimize API usage
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.virusTotalService = void 0;
exports.checkFileHash = checkFileHash;
exports.scanAttachment = scanAttachment;
exports.isVirusTotalAvailable = isVirusTotalAvailable;
const crypto_1 = __importDefault(require("crypto"));
const redis_1 = require("../lib/redis");
/**
 * VirusTotal API Client
 * Requires VIRUSTOTAL_API_KEY environment variable
 */
class VirusTotalService {
    apiKey;
    baseUrl = 'https://www.virustotal.com/api/v3';
    cacheTTL = 86400; // 24 hours
    constructor() {
        this.apiKey = process.env.VIRUSTOTAL_API_KEY || '';
        if (!this.apiKey) {
            console.warn('[VirusTotal] API key not configured - malware scanning disabled');
        }
    }
    /**
     * Check if VirusTotal is available
     */
    isAvailable() {
        return this.apiKey.length > 0;
    }
    /**
     * Calculate file hash (SHA-256)
     */
    calculateHash(content) {
        return crypto_1.default
            .createHash('sha256')
            .update(content)
            .digest('hex');
    }
    /**
     * Check file hash reputation (fastest method - uses hash only)
     */
    async checkFileHash(fileHash, fileName = 'unknown') {
        if (!this.isAvailable()) {
            return {
                hash: fileHash,
                reputation: 'unknown',
                sources: [],
                confidence: 0,
            };
        }
        // Try cache first
        const cacheKey = `virustotal:hash:${fileHash}`;
        const cached = await (0, redis_1.getFromCache)(cacheKey);
        if (cached) {
            console.log(`[VirusTotal] Cache hit for hash ${fileHash.substring(0, 8)}...`);
            return cached;
        }
        try {
            // Query VirusTotal API for file hash
            const response = await fetch(`${this.baseUrl}/files/${fileHash}`, {
                headers: {
                    'x-apikey': this.apiKey,
                },
            });
            if (response.status === 404) {
                // Hash not found in VirusTotal database
                const result = {
                    hash: fileHash,
                    reputation: 'unknown',
                    sources: [],
                    confidence: 0,
                };
                // Cache unknown results for shorter time (1 hour)
                await (0, redis_1.setInCache)(cacheKey, result, 3600);
                return result;
            }
            if (!response.ok) {
                throw new Error(`VirusTotal API error: ${response.status} ${response.statusText}`);
            }
            const data = await response.json();
            const stats = data.data.attributes.last_analysis_stats;
            const results = data.data.attributes.last_analysis_results;
            const malicious = stats.malicious || 0;
            const suspicious = stats.suspicious || 0;
            const undetected = stats.undetected || 0;
            // Determine reputation
            let reputation;
            let confidence;
            if (malicious >= 3) {
                reputation = 'malicious';
                confidence = Math.min(1, malicious / 10); // 3 engines = 0.3, 10+ = 1.0
            }
            else if (malicious >= 1 || suspicious >= 2) {
                reputation = 'suspicious';
                confidence = 0.5 + (malicious + suspicious * 0.5) / 10;
            }
            else {
                reputation = 'clean';
                confidence = Math.min(1, undetected / 50); // More engines = higher confidence
            }
            // Extract engine names that detected it
            const sources = [];
            if (results) {
                Object.entries(results).forEach(([engine, result]) => {
                    if (result.category === 'malicious' || result.category === 'suspicious') {
                        sources.push(engine);
                    }
                });
            }
            const result = {
                hash: fileHash,
                reputation,
                sources,
                confidence,
            };
            // Cache result for 24 hours
            await (0, redis_1.setInCache)(cacheKey, result, this.cacheTTL);
            console.log(`[VirusTotal] Hash ${fileHash.substring(0, 8)}... - ${reputation} (${malicious}/${stats.malicious + stats.suspicious + stats.undetected} engines)`);
            return result;
        }
        catch (error) {
            console.error('[VirusTotal] API request failed:', error);
            // Return unknown on error
            return {
                hash: fileHash,
                reputation: 'unknown',
                sources: [],
                confidence: 0,
            };
        }
    }
    /**
     * Scan attachment using VirusTotal
     * Note: This requires file content and consumes API quota
     */
    async scanAttachment(attachment, fileContent) {
        if (!this.isAvailable()) {
            throw new Error('VirusTotal API key not configured');
        }
        // Calculate file hash
        const fileHash = this.calculateHash(fileContent);
        // First, check if hash exists in VT database
        const hashResult = await this.checkFileHash(fileHash, attachment.filename);
        if (hashResult.reputation !== 'unknown') {
            // Convert hash result to full analysis
            const malicious = hashResult.reputation === 'malicious' ? hashResult.sources.length : 0;
            const suspicious = hashResult.reputation === 'suspicious' ? hashResult.sources.length : 0;
            return {
                fileHash,
                fileName: attachment.filename,
                malicious,
                suspicious,
                undetected: 0,
                totalEngines: hashResult.sources.length + (hashResult.reputation === 'clean' ? 50 : 0),
                isMalware: hashResult.reputation === 'malicious',
                isSuspicious: hashResult.reputation === 'suspicious' || hashResult.reputation === 'malicious',
                threatNames: hashResult.sources,
                scanDate: new Date(),
                permalink: `https://www.virustotal.com/gui/file/${fileHash}`,
            };
        }
        // If hash not found, upload file for scanning (consumes API quota)
        console.log(`[VirusTotal] Uploading file for scan: ${attachment.filename}`);
        try {
            // Upload file
            const formData = new FormData();
            formData.append('file', new Blob([fileContent]), attachment.filename);
            const uploadResponse = await fetch(`${this.baseUrl}/files`, {
                method: 'POST',
                headers: {
                    'x-apikey': this.apiKey,
                },
                body: formData,
            });
            if (!uploadResponse.ok) {
                throw new Error(`Upload failed: ${uploadResponse.status}`);
            }
            const uploadData = await uploadResponse.json();
            const analysisId = uploadData.data.id;
            // Poll for results (wait up to 30 seconds)
            let attempts = 0;
            const maxAttempts = 6; // 6 attempts * 5 seconds = 30 seconds
            while (attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
                const analysisResponse = await fetch(`${this.baseUrl}/analyses/${analysisId}`, {
                    headers: {
                        'x-apikey': this.apiKey,
                    },
                });
                if (!analysisResponse.ok)
                    continue;
                const analysisData = await analysisResponse.json();
                const status = analysisData.data.attributes.status;
                if (status === 'completed') {
                    const stats = analysisData.data.attributes.stats;
                    const results = analysisData.data.attributes.results;
                    const malicious = stats.malicious || 0;
                    const suspicious = stats.suspicious || 0;
                    const undetected = stats.undetected || 0;
                    const total = Object.keys(stats).reduce((sum, key) => sum + stats[key], 0);
                    // Extract threat names
                    const threatNames = [];
                    if (results) {
                        Object.values(results).forEach((result) => {
                            if (result.category === 'malicious' && result.result) {
                                threatNames.push(result.result);
                            }
                        });
                    }
                    return {
                        fileHash,
                        fileName: attachment.filename,
                        malicious,
                        suspicious,
                        undetected,
                        totalEngines: total,
                        isMalware: malicious >= 3,
                        isSuspicious: suspicious >= 2 || malicious >= 1,
                        threatNames,
                        scanDate: new Date(),
                        permalink: `https://www.virustotal.com/gui/file/${fileHash}`,
                    };
                }
                attempts++;
            }
            // Timeout - return pending status
            console.warn('[VirusTotal] Scan timeout - results not ready');
            return {
                fileHash,
                fileName: attachment.filename,
                malicious: 0,
                suspicious: 0,
                undetected: 0,
                totalEngines: 0,
                isMalware: false,
                isSuspicious: false,
                threatNames: ['Scan pending - check later'],
                scanDate: new Date(),
                permalink: `https://www.virustotal.com/gui/file/${fileHash}`,
            };
        }
        catch (error) {
            console.error('[VirusTotal] Scan failed:', error);
            throw error;
        }
    }
    /**
     * Batch check multiple file hashes
     */
    async batchCheckHashes(hashes) {
        const results = new Map();
        // Check all hashes in parallel (respect rate limits)
        const chunks = [];
        const chunkSize = 4; // VirusTotal free tier: 4 req/min
        for (let i = 0; i < hashes.length; i += chunkSize) {
            chunks.push(hashes.slice(i, i + chunkSize));
        }
        for (const chunk of chunks) {
            const promises = chunk.map(({ hash, fileName }) => this.checkFileHash(hash, fileName).then(result => {
                results.set(hash, result);
            }));
            await Promise.all(promises);
            // Wait 1 minute between chunks (rate limit)
            if (chunks.indexOf(chunk) < chunks.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 60000));
            }
        }
        return results;
    }
}
// Export singleton instance
exports.virusTotalService = new VirusTotalService();
/**
 * Main export: Check file hash reputation
 */
async function checkFileHash(fileHash, fileName) {
    return exports.virusTotalService.checkFileHash(fileHash, fileName);
}
/**
 * Scan attachment for malware
 */
async function scanAttachment(attachment, fileContent) {
    return exports.virusTotalService.scanAttachment(attachment, fileContent);
}
/**
 * Check if VirusTotal is available
 */
function isVirusTotalAvailable() {
    return exports.virusTotalService.isAvailable();
}
