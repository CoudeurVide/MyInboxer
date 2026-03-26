"use strict";
/**
 * Tags API Routes
 * Handles user-defined tags for messages using JSON field in messages table
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.tagRoutes = void 0;
const zod_1 = require("zod");
const prisma_1 = require("../../lib/prisma");
// Validation schemas
const createTagSchema = zod_1.z.object({
    name: zod_1.z.string().min(1).max(50),
    color: zod_1.z.string().regex(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/, { message: 'Color must be a valid hex color' }).optional(),
});
const getTagsSchema = zod_1.z.object({
    limit: zod_1.z.string().regex(/^\d+$/).optional().transform(Number),
    offset: zod_1.z.string().regex(/^\d+$/).optional().transform(Number),
});
const assignTagSchema = zod_1.z.object({
    tagId: zod_1.z.string().uuid(),
});
const tagRoutes = async (app) => {
    /**
     * GET /api/tags - Get user's tags
     */
    app.get('/', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const userId = request.user.userId;
            const query = getTagsSchema.safeParse(request.query);
            const { limit = 100, offset = 0 } = query.success ? query.data : { limit: 100, offset: 0 };
            // Get all messages with tags for this user
            // Using raw query to bypass potential Prisma schema issues with the tags field
            const messages = await prisma_1.prisma.$queryRaw `
        SELECT tags
        FROM messages m
        JOIN mailboxes mb ON m.mailbox_id = mb.id
        WHERE mb.user_id = ${userId}
        AND m.tags IS NOT NULL
        ORDER BY m.created_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;
            // Extract unique tag names from all messages
            const tagMap = new Map();
            for (const message of messages) {
                if (message.tags) {
                    // message.tags is already a JSON object from Prisma, no need to parse
                    const tagsArray = Array.isArray(message.tags) ? message.tags : message.tags;
                    for (const tag of tagsArray) {
                        if (typeof tag === 'object' && tag.name) {
                            const existing = tagMap.get(tag.name);
                            if (existing) {
                                tagMap.set(tag.name, { ...existing, count: existing.count + 1 });
                            }
                            else {
                                tagMap.set(tag.name, {
                                    name: tag.name,
                                    color: tag.color || undefined,
                                    count: 1
                                });
                            }
                        }
                        else if (typeof tag === 'string') {
                            const existing = tagMap.get(tag);
                            if (existing) {
                                tagMap.set(tag, { ...existing, count: existing.count + 1 });
                            }
                            else {
                                tagMap.set(tag, {
                                    name: tag,
                                    count: 1
                                });
                            }
                        }
                    }
                }
            }
            // Convert to the expected format
            const tags = Array.from(tagMap.entries()).map(([name, data], index) => ({
                id: `tag-${index}`, // Temporary ID since we're not using a separate tag table
                name: data.name,
                color: data.color,
                user_id: userId,
                created_at: new Date(),
                updated_at: new Date(),
                messageCount: data.count,
            }));
            return reply.status(200).send({
                success: true,
                data: tags,
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
     * POST /api/tags - Validate tag creation (we don't store tags separately, just validate)
     */
    app.post('/', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const { name, color } = createTagSchema.parse(request.body);
            // For our implementation, we don't store tags in a separate table
            // Instead, tags are stored with messages, so we just validate the tag format
            if (!name || name.trim().length === 0) {
                return reply.status(400).send({
                    success: false,
                    error: 'Tag name is required',
                });
            }
            // Create a temporary response object that mimics what would happen if we stored tags separately
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
                data: tagResponse,
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
                error: 'Failed to validate tag',
                details: error.message,
            });
        }
    });
    /**
     * PATCH /api/tags/:tagId - Update a tag (placeholder implementation)
     * Since we don't store tags individually, this is a no-op that just validates the request
     */
    app.patch('/:tagId', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            // For our implementation, we don't store tags in a separate table
            // So updating a tag is essentially a validation of the request
            const { name, color } = request.body;
            if (name && name.trim().length === 0) {
                return reply.status(400).send({
                    success: false,
                    error: 'Tag name cannot be empty',
                });
            }
            // In the real implementation, this would update tags across all messages where this tag exists
            // For this implementation, we'll just return the tag info as if it was updated
            const updatedTag = {
                id: request.params.tagId,
                name: name || 'existing_tag_name', // Would be the existing tag name if not updating
                color: color || null,
                user_id: request.user.userId,
                created_at: new Date(),
                updated_at: new Date(),
            };
            return reply.status(200).send({
                success: true,
                data: updatedTag,
            });
        }
        catch (error) {
            if (error instanceof zod_1.z.ZodError) {
                return reply.status(400).send({
                    success: false,
                    error: 'Invalid request data',
                    details: error.errors,
                });
            }
            return reply.status(500).send({
                success: false,
                error: 'Failed to update tag',
                details: error.message,
            });
        }
    });
    /**
     * DELETE /api/tags/:tagId - Delete a tag (placeholder implementation)
     * Since we don't store tags individually, this removes the tag from all messages where it exists
     */
    app.delete('/:tagId', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const { tagId } = request.params;
            // BATCH OPTIMIZATION: Remove tag from all messages with a SINGLE bulk UPDATE query
            // For our implementation, tagId is the tag name
            const tagName = tagId;
            // Use PostgreSQL JSON array operations to filter out the tag from all messages at once
            // This handles both string tags and object tags with a 'name' property
            await prisma_1.prisma.$executeRaw `
        UPDATE messages m
        SET tags = (
          SELECT jsonb_agg(tag)
          FROM jsonb_array_elements(m.tags) AS tag
          WHERE
            NOT (
              (jsonb_typeof(tag) = 'string' AND tag::text = ${'"' + tagName + '"'}) OR
              (jsonb_typeof(tag) = 'object' AND tag->>'name' = ${tagName})
            )
        )
        WHERE m.id IN (
          SELECT msg.id FROM messages msg
          INNER JOIN mailboxes mb ON msg.mailbox_id = mb.id
          WHERE mb.user_id = ${request.user.userId}::uuid
            AND msg.tags IS NOT NULL
            AND jsonb_array_length(msg.tags) > 0
        )
      `;
            app.log.info(`Bulk removed tag '${tagName}' from all user messages in a single query`);
            return reply.status(200).send({
                success: true,
                message: 'Tag removed from all messages successfully',
            });
        }
        catch (error) {
            app.log.error('Error removing tag from messages:', error);
            return reply.status(500).send({
                success: false,
                error: 'Failed to remove tag from messages',
                details: error.message,
            });
        }
    });
    /**
     * POST /api/tags/:tagId/assign/:messageId - Assign a tag to a message
     * For our implementation, tagId is the tag name
     */
    app.post('/:tagId/assign/:messageId', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const { tagId, messageId } = request.params;
            // Verify message belongs to user using raw query to bypass potential Prisma schema issues
            const results = await prisma_1.prisma.$queryRaw `
        SELECT m.id, m.tags
        FROM messages m
        JOIN mailboxes mb ON m.mailbox_id = mb.id
        WHERE m.id = ${messageId} AND mb.user_id = ${request.user.userId}
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
                    data: { tagId, messageId },
                });
            }
            // Add new tag to the existing tags array
            const newTagObj = { name: tagId, createdAt: new Date().toISOString() };
            const updatedTags = [...existingTags, newTagObj];
            // Update message with new tags array using raw query
            await prisma_1.prisma.$executeRaw `
        UPDATE messages
        SET tags = ${updatedTags}::jsonb
        WHERE id = ${message.id}
      `;
            // Create a mock response object that mimics what we'd return if using separate tables
            const mockTagAssignment = {
                id: `mock-${messageId}-${tagId}-${Date.now()}`,
                message_id: messageId,
                tag_id: tagId,
                assigned_at: new Date().toISOString(),
            };
            return reply.status(200).send({
                success: true,
                data: mockTagAssignment,
            });
        }
        catch (error) {
            app.log.error('Error assigning tag to message:', error);
            return reply.status(500).send({
                success: false,
                error: 'Failed to assign tag to message',
                details: error.message,
            });
        }
    });
    /**
     * DELETE /api/tags/:tagId/remove/:messageId - Remove a tag from a message
     */
    app.delete('/:tagId/remove/:messageId', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const { tagId, messageId } = request.params;
            // Verify tag and message belong to user
            const [tag, message] = await Promise.all([
                prisma_1.prisma.tag.findFirst({
                    where: {
                        id: tagId,
                        user_id: request.user.userId,
                    },
                }),
                prisma_1.prisma.message.findFirst({
                    where: {
                        id: messageId,
                        mailbox: {
                            user_id: request.user.userId,
                        },
                    },
                }),
            ]);
            if (!tag) {
                return reply.status(404).send({
                    success: false,
                    error: 'Tag not found or does not belong to user',
                });
            }
            if (!message) {
                return reply.status(404).send({
                    success: false,
                    error: 'Message not found or does not belong to user',
                });
            }
            // Get existing tags for the message
            let existingTags = [];
            if (message.tags) {
                try {
                    existingTags = Array.isArray(message.tags) ? message.tags : JSON.parse(message.tags);
                }
                catch (e) {
                    // If parsing fails, treat as empty array
                    existingTags = [];
                }
            }
            // Remove the specified tag
            const updatedTags = existingTags.filter((tag) => !(typeof tag === 'string' && tag === tagId) &&
                !(typeof tag === 'object' && tag.name === tagId));
            // Update message with filtered tags array using raw query
            await prisma_1.prisma.$executeRaw `
        UPDATE messages
        SET tags = ${updatedTags}::jsonb
        WHERE id = ${message.id}
      `;
            return reply.status(200).send({
                success: true,
                message: 'Tag removed from message',
            });
        }
        catch (error) {
            app.log.error('Error removing tag from message:', error);
            return reply.status(500).send({
                success: false,
                error: 'Failed to remove tag from message',
                details: error.message,
            });
        }
    });
    /**
     * GET /api/tags/:tagId/messages - Get messages with a specific tag
     */
    app.get('/:tagId/messages', {
        preHandler: [app.authenticate],
    }, async (request, reply) => {
        try {
            const { tagId } = request.params;
            const query = getTagsSchema.safeParse(request.query);
            const { limit = 50, offset = 0 } = query.success ? query.data : { limit: 50, offset: 0 };
            // Get messages with the specified tag by querying all messages for the user
            // and then filtering them based on tag presence
            const allUserMessages = await prisma_1.prisma.message.findMany({
                where: {
                    mailbox: {
                        user_id: request.user.userId,
                    },
                },
                include: {
                    mailbox: true,
                },
                take: limit * 5, // Get more than needed before filtering
                skip: offset,
                orderBy: {
                    created_at: 'desc',
                },
            });
            // Filter to only messages that have the specific tag
            const messagesWithTag = allUserMessages.filter(message => {
                if (!message.tags)
                    return false;
                try {
                    const tagsArray = Array.isArray(message.tags) ? message.tags : JSON.parse(message.tags);
                    return tagsArray.some((tag) => (typeof tag === 'string' && tag === tagId) ||
                        (typeof tag === 'object' && tag.name === tagId));
                }
                catch (e) {
                    return false;
                }
            });
            // Take only the required amount after filtering
            const resultMessages = messagesWithTag.slice(0, limit);
            return reply.status(200).send({
                success: true,
                data: resultMessages,
            });
        }
        catch (error) {
            app.log.error('Error fetching messages with tag:', error);
            return reply.status(500).send({
                success: false,
                error: 'Failed to fetch messages with tag',
                details: error.message,
            });
        }
    });
};
exports.tagRoutes = tagRoutes;
exports.default = exports.tagRoutes;
