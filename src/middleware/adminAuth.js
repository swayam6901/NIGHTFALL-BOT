const { isAdmin } = require('../db/queries');

/**
 * In-memory cache of admin IDs to avoid a DB hit on every single message.
 * Refreshed every 60s, and force-refreshed immediately after add/remove admin.
 */
let adminCache = new Set();
let lastRefresh = 0;
const REFRESH_INTERVAL_MS = 60 * 1000;

async function refreshCache() {
  const { listAdmins } = require('../db/queries');
  const admins = await listAdmins();
  adminCache = new Set(admins.map((a) => a.telegram_id));
  lastRefresh = Date.now();
}

async function ensureFreshCache() {
  if (Date.now() - lastRefresh > REFRESH_INTERVAL_MS) {
    await refreshCache();
  }
}

/** Middleware: only allow admins through. Silently ignores non-admins. */
function requireAdmin() {
  return async (ctx, next) => {
    await ensureFreshCache();
    const userId = ctx.from && ctx.from.id;
    if (!userId) return;

    if (adminCache.has(userId)) {
      return next();
    }

    // Cache might be stale right after a fresh /addadmin - fall back to DB check
    const admin = await isAdmin(userId);
    if (admin) {
      adminCache.add(userId);
      return next();
    }

    // Non-admin - ignore silently (spec: "Ignore uploads from non-admins")
  };
}

/** Force an immediate cache refresh (call after addAdmin/removeAdmin) */
async function invalidateCache() {
  await refreshCache();
}

module.exports = { requireAdmin, invalidateCache };
