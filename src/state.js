/**
 * Process-local in-memory state.
 * uploadSessions: adminId -> { batchId, fileOrder, active }
 * pendingRequests: userId -> batchId  (set when a user's /start deep-link
 *                  request is blocked on force-join, so Verify button knows
 *                  what to deliver once they join)
 */

const uploadSessions = new Map();
const pendingRequests = new Map();

module.exports = { uploadSessions, pendingRequests };
