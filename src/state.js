/**
 * Process-local in-memory state.
 * uploadSessions: adminId -> { batchId, fileOrder, active }
 * pendingRequests: userId -> batchId  (set when a user's /start deep-link
 *                  request is blocked on force-join, so Verify button knows
 *                  what to deliver once they join)
 * thumbnailSessions: adminId -> { batchId, link, fileCount }
 *                  (set right after /done; the next photo that admin sends
 *                  is treated as the promo thumbnail for that batch instead
 *                  of a new upload. Cleared once used or on /skipthumbnail.)
 */

const uploadSessions = new Map();
const pendingRequests = new Map();
const thumbnailSessions = new Map();

module.exports = { uploadSessions, pendingRequests, thumbnailSessions };
