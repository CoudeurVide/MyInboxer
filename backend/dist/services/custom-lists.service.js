"use strict";
/**
 * Custom Lists Service
 * User-managed blacklists and whitelists for threat intelligence
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.addToBlacklist = addToBlacklist;
exports.addToWhitelist = addToWhitelist;
exports.removeFromList = removeFromList;
exports.checkCustomLists = checkCustomLists;
exports.checkDomainCustomList = checkDomainCustomList;
exports.checkEmailCustomList = checkEmailCustomList;
exports.checkIpCustomList = checkIpCustomList;
exports.getUserCustomLists = getUserCustomLists;
exports.getCustomListStats = getCustomListStats;
exports.bulkImportCustomLists = bulkImportCustomLists;
exports.exportCustomLists = exportCustomLists;
exports.disableCustomListEntry = disableCustomListEntry;
exports.enableCustomListEntry = enableCustomListEntry;
exports.searchCustomLists = searchCustomLists;
const prisma_1 = require("../lib/prisma");
const redis_1 = require("../lib/redis");
/**
 * Add an entry to user's blacklist
 */
async function addToBlacklist(userId, entryType, value, options) {
    const entry = await prisma_1.prisma.customList.create({
        data: {
            user_id: userId,
            list_type: 'blacklist',
            entry_type: entryType,
            value: value.toLowerCase(),
            pattern: options?.pattern,
            reason: options?.reason,
            is_active: true,
        },
    });
    // Invalidate cache for this user
    await (0, redis_1.deleteFromCache)(redis_1.CacheKeys.customLists(userId));
    return {
        id: entry.id,
        userId: entry.user_id,
        listType: entry.list_type,
        entryType: entry.entry_type,
        value: entry.value,
        pattern: entry.pattern || undefined,
        reason: entry.reason || undefined,
        createdAt: entry.created_at,
        isActive: entry.is_active,
    };
}
/**
 * Add an entry to user's whitelist
 */
async function addToWhitelist(userId, entryType, value, options) {
    const entry = await prisma_1.prisma.customList.create({
        data: {
            user_id: userId,
            list_type: 'whitelist',
            entry_type: entryType,
            value: value.toLowerCase(),
            pattern: options?.pattern,
            reason: options?.reason,
            is_active: true,
        },
    });
    // Invalidate cache for this user
    await (0, redis_1.deleteFromCache)(redis_1.CacheKeys.customLists(userId));
    return {
        id: entry.id,
        userId: entry.user_id,
        listType: entry.list_type,
        entryType: entry.entry_type,
        value: entry.value,
        pattern: entry.pattern || undefined,
        reason: entry.reason || undefined,
        createdAt: entry.created_at,
        isActive: entry.is_active,
    };
}
/**
 * Remove an entry from user's custom list
 */
async function removeFromList(userId, entryId) {
    await prisma_1.prisma.customList.update({
        where: {
            id: entryId,
            user_id: userId,
        },
        data: {
            is_active: false,
        },
    });
    // Invalidate cache for this user
    await (0, redis_1.deleteFromCache)(redis_1.CacheKeys.customLists(userId));
}
/**
 * Check if an email/domain/IP matches any custom lists
 */
async function checkCustomLists(userId, value, entryType) {
    // Try cache first (30 minutes TTL)
    const cached = await (0, redis_1.getFromCache)(redis_1.CacheKeys.customListMatch(userId, value, entryType));
    if (cached) {
        return cached;
    }
    const normalizedValue = value.toLowerCase();
    const lists = await getUserCustomLists(userId);
    // Check direct matches first
    for (const list of lists) {
        if (!list.isActive)
            continue;
        if (list.entryType === entryType && list.value === normalizedValue) {
            const result = {
                matched: true,
                entry: list,
                listType: list.listType,
                reason: list.reason,
            };
            // Cache for 30 minutes
            await (0, redis_1.setInCache)(redis_1.CacheKeys.customListMatch(userId, value, entryType), result, 1800);
            return result;
        }
    }
    // Check pattern matches
    for (const list of lists) {
        if (!list.isActive)
            continue;
        if (!list.pattern)
            continue;
        try {
            const regex = new RegExp(list.pattern, 'i');
            if (regex.test(normalizedValue)) {
                const result = {
                    matched: true,
                    entry: list,
                    listType: list.listType,
                    reason: list.reason,
                };
                // Cache for 30 minutes
                await (0, redis_1.setInCache)(redis_1.CacheKeys.customListMatch(userId, value, entryType), result, 1800);
                return result;
            }
        }
        catch (error) {
            console.error(`[CustomLists] Invalid regex pattern: ${list.pattern}`, error);
            continue;
        }
    }
    // No matches found
    const result = { matched: false };
    // Cache for 30 minutes
    await (0, redis_1.setInCache)(redis_1.CacheKeys.customListMatch(userId, value, entryType), result, 1800);
    return result;
}
/**
 * Check if a domain matches user's custom lists
 */
async function checkDomainCustomList(userId, domain) {
    return checkCustomLists(userId, domain, 'domain');
}
/**
 * Check if an email matches user's custom lists
 */
async function checkEmailCustomList(userId, email) {
    return checkCustomLists(userId, email, 'email');
}
/**
 * Check if an IP matches user's custom lists
 */
async function checkIpCustomList(userId, ip) {
    return checkCustomLists(userId, ip, 'ip');
}
/**
 * Get all active custom lists for a user
 */
async function getUserCustomLists(userId) {
    // Try cache first (30 minutes TTL)
    const cached = await (0, redis_1.getFromCache)(redis_1.CacheKeys.customLists(userId));
    if (cached) {
        return cached;
    }
    const entries = await prisma_1.prisma.customList.findMany({
        where: {
            user_id: userId,
            is_active: true,
        },
        orderBy: {
            created_at: 'desc',
        },
    });
    const result = entries.map(entry => ({
        id: entry.id,
        userId: entry.user_id,
        listType: entry.list_type,
        entryType: entry.entry_type,
        value: entry.value,
        pattern: entry.pattern || undefined,
        reason: entry.reason || undefined,
        createdAt: entry.created_at,
        isActive: entry.is_active,
    }));
    // Cache for 30 minutes
    await (0, redis_1.setInCache)(redis_1.CacheKeys.customLists(userId), result, 1800);
    return result;
}
/**
 * Get statistics for user's custom lists
 */
async function getCustomListStats(userId) {
    // Try cache first (15 minutes TTL)
    const cached = await (0, redis_1.getFromCache)(redis_1.CacheKeys.customListStats(userId));
    if (cached) {
        return cached;
    }
    const [blacklistEntries, whitelistEntries] = await Promise.all([
        prisma_1.prisma.customList.findMany({
            where: {
                user_id: userId,
                list_type: 'blacklist',
                is_active: true,
            },
        }),
        prisma_1.prisma.customList.findMany({
            where: {
                user_id: userId,
                list_type: 'whitelist',
                is_active: true,
            },
        }),
    ]);
    const blacklist = {
        total: blacklistEntries.length,
        domains: blacklistEntries.filter(e => e.entry_type === 'domain').length,
        emails: blacklistEntries.filter(e => e.entry_type === 'email').length,
        ips: blacklistEntries.filter(e => e.entry_type === 'ip').length,
        patterns: blacklistEntries.filter(e => e.entry_type === 'pattern').length,
    };
    const whitelist = {
        total: whitelistEntries.length,
        domains: whitelistEntries.filter(e => e.entry_type === 'domain').length,
        emails: whitelistEntries.filter(e => e.entry_type === 'email').length,
        ips: whitelistEntries.filter(e => e.entry_type === 'ip').length,
        patterns: whitelistEntries.filter(e => e.entry_type === 'pattern').length,
    };
    const result = {
        blacklist,
        whitelist,
        lastUpdated: new Date(),
    };
    // Cache for 15 minutes
    await (0, redis_1.setInCache)(redis_1.CacheKeys.customListStats(userId), result, 900);
    return result;
}
/**
 * Bulk import custom list entries
 */
async function bulkImportCustomLists(userId, entries) {
    let imported = 0;
    let failed = 0;
    const errors = [];
    for (const entry of entries) {
        try {
            await prisma_1.prisma.customList.create({
                data: {
                    user_id: userId,
                    list_type: entry.listType,
                    entry_type: entry.entryType,
                    value: entry.value.toLowerCase(),
                    pattern: entry.pattern,
                    reason: entry.reason,
                    is_active: true,
                },
            });
            imported++;
        }
        catch (error) {
            failed++;
            errors.push(`Failed to import '${entry.value}': ${error.message}`);
        }
    }
    // Invalidate cache for this user
    await (0, redis_1.deleteFromCache)(redis_1.CacheKeys.customLists(userId));
    return { imported, failed, errors };
}
/**
 * Export custom lists for user
 */
async function exportCustomLists(userId) {
    return await getUserCustomLists(userId);
}
/**
 * Disable a custom list entry (soft delete)
 */
async function disableCustomListEntry(userId, entryId) {
    await prisma_1.prisma.customList.update({
        where: {
            id: entryId,
            user_id: userId,
        },
        data: {
            is_active: false,
        },
    });
    // Invalidate cache for this user
    await (0, redis_1.deleteFromCache)(redis_1.CacheKeys.customLists(userId));
}
/**
 * Enable a custom list entry
 */
async function enableCustomListEntry(userId, entryId) {
    await prisma_1.prisma.customList.update({
        where: {
            id: entryId,
            user_id: userId,
        },
        data: {
            is_active: true,
        },
    });
    // Invalidate cache for this user
    await (0, redis_1.deleteFromCache)(redis_1.CacheKeys.customLists(userId));
}
/**
 * Search custom list entries
 */
async function searchCustomLists(userId, searchTerm, listType, entryType) {
    const whereClause = {
        user_id: userId,
        is_active: true,
    };
    if (listType) {
        whereClause.list_type = listType;
    }
    if (entryType) {
        whereClause.entry_type = entryType;
    }
    if (searchTerm) {
        whereClause.OR = [
            { value: { contains: searchTerm, mode: 'insensitive' } },
            { reason: { contains: searchTerm, mode: 'insensitive' } },
            { pattern: { contains: searchTerm, mode: 'insensitive' } },
        ];
    }
    const entries = await prisma_1.prisma.customList.findMany({
        where: whereClause,
        orderBy: {
            created_at: 'desc',
        },
    });
    return entries.map(entry => ({
        id: entry.id,
        userId: entry.user_id,
        listType: entry.list_type,
        entryType: entry.entry_type,
        value: entry.value,
        pattern: entry.pattern || undefined,
        reason: entry.reason || undefined,
        createdAt: entry.created_at,
        isActive: entry.is_active,
    }));
}
