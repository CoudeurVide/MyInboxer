"use strict";
/**
 * Tagging API Routes (Legacy-style endpoints to match frontend expectations)
 * Handles message tagging operations using different endpoint patterns than /api/tags
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.taggingRoutes = void 0;
const zod_1 = require("zod");
const prisma_1 = require("../../lib/prisma");
// Validation schemas
const assignTagSchema = zod_1.z.object({
    emailId: zod_1.z.string(), // Message ID
    tagId: zod_1.z.string(), // The name of the tag to assign
});
const createTagSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(50),
    color: zod_1.z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, { message: 'Color must be a valid hex color' }).optional(),
});
const taggingRoutes = async (app) => {
    /**
     * GET /taggings - Get user's tags (matches frontend TaggingService.getTags)
     */
    app.get('/taggings', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user.userId;
            // Get all messages with tags for this user
            const messages = await prisma_1.prisma.message.findMany({
                where: {
                    mailbox: {
                        user_id: userId,
                    },
                    tags: { not: null }, // Only messages with tags
                },
                select: {
                    tags: true, // Get the tags field
                },
            });
            // Extract unique tag names from all messages
            const uniqueTagNames = new Set();
            for (const message of messages) {
                if (message.tags) {
                    // message.tags is already a JSON object from Prisma, no need to parse
                    const tagsArray = Array.isArray(message.tags) ? message.tags : message.tags;
                    for (const tag of tagsArray) {
                        if (typeof tag === 'object' && tag.name) {
                            uniqueTagNames.add(tag.name);
                        }
                        else if (typeof tag === 'string') {
                            uniqueTagNames.add(tag);
                        }
                    }
                }
            }
            // Convert to the expected format
            const tags = Array.from(uniqueTagNames).map((name, index) => ({
                id: `tag-${index}`, // This is a temporary ID since we're not using a separate tag table
                name,
                user_id: userId,
                created_at: new Date(),
                updated_at: new Date(),
                messageCount: 0, // We could calculate this if needed
            }));
            return reply.status(200).send({
                success: true,
                data: { tags },
            });
        }
        catch (error) {
            app.log.error('Error fetching tags:', error);
            return reply.status(500).send({
                success: false,
                error: 'Failed to fetch tags',
                details: error.message,
            });
        }
    });
    /**
     * POST /taggings - Assign a tag to a message (matches frontend TaggingService.assignTag)
     */
    app.post('/taggings', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user.userId;
            const { emailId, tagId } = assignTagSchema.parse(request.body);
            // Verify message belongs to user using raw query to bypass potential Prisma schema issues
            const results = await prisma_1.prisma.$queryRaw `
        SELECT m.id, mb.user_id, m.tags
        FROM messages m
        JOIN mailboxes mb ON m.mailbox_id = mb.id
        WHERE m.id = ${emailId} AND mb.user_id = ${userId}
      `;
            const message = results[0] || null;
            if (!message) {
                return reply.status(404).send({
                    success: false,
                    error: 'Message not found or does not belong to user',
                });
            }
            // Get existing tags for the message
            let existingTags = [];
            if (message.tags) {
                // message.tags is already a JSON object from the raw query, no need to parse
                existingTags = Array.isArray(message.tags) ? message.tags : message.tags;
            }
            // Check if tag already exists
            const tagExists = existingTags.some((tag) => (typeof tag === 'string' && tag === tagId) ||
                (typeof tag === 'object' && tag.name === tagId));
            if (tagExists) {
                return reply.status(200).send({
                    success: true,
                    message: 'Tag already assigned to message',
                    data: { tagging: { emailId, tagId } },
                });
            }
            // Add new tag to the existing tags array
            const newTagObj = { name: tagId, createdAt: new Date().toISOString() };
            const updatedTags = [...existingTags, newTagObj];
            // Update message with new tags array
            await prisma_1.prisma.message.update({
                where: { id: message.id },
                data: {
                    tags: updatedTags,
                },
            });
            return reply.status(200).send({
                success: true,
                data: {
                    tagging: {
                        emailId,
                        tagId,
                        assignedAt: new Date().toISOString()
                    }
                },
            });
        }
        catch (error) {
            app.log.error('Error assigning tag to message:', error);
            if (error instanceof zod_1.z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid request data',
                    details: error.errors,
                });
            }
            return reply.status(500).send({
                success: false,
                error: 'Failed to assign tag',
                details: error.message,
            });
        }
    });
    /**
     * DELETE /taggings - Remove a tag from a message (matches frontend TaggingService.removeTag)
     */
    app.delete('/taggings', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user.userId;
            const { emailId, tagId } = assignTagSchema.parse(request.body);
            // Verify message belongs to user using raw query to bypass potential Prisma schema issues
            const results = await prisma_1.prisma.$queryRaw `
        SELECT m.id, m.tags
        FROM messages m
        JOIN mailboxes mb ON m.mailbox_id = mb.id
        WHERE m.id = ${emailId} AND mb.user_id = ${userId}
      `;
            const message = results[0] || null;
            if (!message) {
                return reply.status(404).send({
                    success: false,
                    error: 'Message not found or does not belong to user',
                });
            }
            // Get existing tags for the message
            let existingTags = [];
            if (message.tags) {
                // message.tags is already a JSON object from the raw query, no need to parse
                existingTags = Array.isArray(message.tags) ? message.tags : message.tags;
            }
            // Remove the specified tag
            const originalTagCount = existingTags.length;
            const updatedTags = existingTags.filter((tag) => !(typeof tag === 'string' && tag === tagId) &&
                !(typeof tag === 'object' && tag.name === tagId));
            // If no tags were removed, the tag didn't exist
            if (originalTagCount === updatedTags.length) {
                return reply.status(200).send({
                    success: true,
                    message: 'Tag was not assigned to message',
                });
            }
            // Update message with filtered tags array
            await prisma_1.prisma.message.update({
                where: { id: message.id },
                data: {
                    tags: updatedTags,
                },
            });
            return reply.status(200).send({
                success: true,
                message: 'Tag removed from message',
            });
        }
        catch (error) {
            app.log.error('Error removing tag from message:', error);
            if (error instanceof zod_1.z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid request data',
                    details: error.errors,
                });
            }
            return reply.status(500).send({
                success: false,
                error: 'Failed to remove tag',
                details: error.message,
            });
        }
    });
    /**
     * GET /emails/:emailId/tags - Get tags for a specific email (matches frontend TaggingService.getTagsForEmail)
     */
    app.get('/emails/:emailId/tags', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const { emailId } = request.params;
            const userId = request.user.userId;
            // Verify message belongs to user using raw query to bypass potential Prisma schema issues
            const results = await prisma_1.prisma.$queryRaw `
        SELECT m.id, m.tags
        FROM messages m
        JOIN mailboxes mb ON m.mailbox_id = mb.id
        WHERE m.id = ${emailId} AND mb.user_id = ${userId}
      `;
            const message = results[0] || null;
            if (!message) {
                return reply.status(404).send({
                    success: false,
                    error: 'Message not found or does not belong to user',
                });
            }
            // Get tags from the message JSON field
            let tags = [];
            if (message.tags) {
                // message.tags is already a JSON object from the raw query, no need to parse
                tags = Array.isArray(message.tags) ? message.tags : message.tags;
            }
            // Format tags to match expected response
            const formattedTags = tags.map((tag) => {
                if (typeof tag === 'string') {
                    return {
                        id: `tag-${tag}`, // Temporary ID since we're not using separate table
                        name: tag,
                        color: null,
                        user_id: userId,
                        created_at: new Date(),
                        updated_at: new Date(),
                    };
                }
                else if (typeof tag === 'object' && tag.name) {
                    return {
                        id: `tag-${tag.name}`, // Temporary ID since we're not using separate table
                        name: tag.name,
                        color: tag.color || null,
                        user_id: userId,
                        created_at: new Date(tag.createdAt || Date.now()),
                        updated_at: new Date(),
                    };
                }
                return null;
            }).filter(Boolean);
            return reply.status(200).send({
                success: true,
                data: { tags: formattedTags },
            });
        }
        catch (error) {
            app.log.error('Error fetching tags for email:', error);
            return reply.status(500).send({
                success: true,
                data: { tags: [] }, // Return empty array on error to prevent front-end crashes
            });
        }
    });
    /**
     * DELETE /emails/:emailId/tags - Remove all tags from a specific email (matches frontend TaggingService.removeTagsFromEmail)
     */
    app.delete('/emails/:emailId/tags', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const { emailId } = request.params;
            const userId = request.user.userId;
            // Verify message belongs to user using raw query to bypass potential Prisma schema issues
            const results = await prisma_1.prisma.$queryRaw `
        SELECT m.id
        FROM messages m
        JOIN mailboxes mb ON m.mailbox_id = mb.id
        WHERE m.id = ${emailId} AND mb.user_id = ${userId}
      `;
            const message = results[0] || null;
            if (!message) {
                return reply.status(404).send({
                    success: false,
                    error: 'Message not found or does not belong to user',
                });
            }
            // Remove all tags from the message by setting tags field to empty array using raw SQL
            await prisma_1.prisma.$executeRaw `
        UPDATE messages
        SET tags = '[]'::jsonb
        WHERE id = ${message.id}
      `;
            return reply.status(200).send({
                success: true,
                message: 'All tags removed from email',
            });
        }
        catch (error) {
            app.log.error('Error removing all tags from email:', error);
            return reply.status(500).send({
                success: false,
                error: 'Failed to remove tags from email',
                details: error.message,
            });
        }
    });
    /**
     * POST /taggings/tags - Create a new tag (alternative to /tags POST to match any legacy calls)
     * This implementation doesn't store tags in a separate table, but validates name format
     */
    app.post('/taggings/tags', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const { name, color } = createTagSchema.parse(request.body);
            // For our tags implementation, we don't store tags separately, we just validate the name
            // The tag name will be attached directly to messages, so we just validate it
            if (!name || name.trim().length === 0) {
                return reply.status(400).send({
                    success: false,
                    error: 'Tag name is required',
                });
            }
            // Create a temporary response object with the tag data
            const tagResponse = {
                id: `temp-${Date.now()}`, // Temporary ID since we're not storing separately
                name: name.trim(),
                color: color || null,
                user_id: request.user.userId,
                created_at: new Date(),
                updated_at: new Date(),
            };
            return reply.status(201).send({
                success: true,
                data: { tag: tagResponse },
            });
        }
        catch (error) {
            app.log.error('Error validating tag creation:', error);
            if (error instanceof zod_1.z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid request data',
                    details: error.errors,
                });
            }
            return reply.status(500).send({
                success: false,
                error: 'Failed to create tag',
                details: error.message,
            });
        }
    });
};
exports.taggingRoutes = taggingRoutes;
exports.default = exports.taggingRoutes;
