/**
 * xchat-utils.ts — X Chat conversation ID utilities
 *
 * Conversation ID formats:
 *   - Canonical (webhooks, signatures, storage): "userId1:userId2" or "gGroupId"
 *   - API path (URL segments): "userId1-userId2" or "gGroupId"
 *   - Migration guide calls dash the "official" format, but webhooks use colons
 *
 * We normalize to COLON format for storage and signatures,
 * and convert to DASH format only for API URL paths.
 */

/** Convert any conversation ID to colon-separated canonical format (for storage/signatures) */
export function toCanonicalConvId(id: string): string {
  return id.replace(/-/g, ':');
}

/** Convert any conversation ID to dash-separated API path format (for URL segments) */
export function toApiConvId(id: string): string {
  return id.replace(/:/g, '-');
}

/** Extract the recipient user ID from a 1:1 conversation ID, given the current user ID */
export function extractRecipientId(conversationId: string, ownUserId: string): string {
  const normalized = conversationId.replace(/:/g, '-');
  if (!normalized.includes('-')) return normalized; // already a single user ID
  const parts = normalized.split('-');
  return parts.find(p => p !== ownUserId) || parts[1];
}

/** Check if a conversation ID is a group chat */
export function isGroupConversation(conversationId: string): boolean {
  return conversationId.startsWith('g');
}
