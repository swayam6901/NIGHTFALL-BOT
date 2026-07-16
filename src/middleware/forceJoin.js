const { getSetting } = require('../db/queries');

/**
 * Checks whether a user is a member of the configured force-join channel.
 * Returns true if no force-join channel is configured (nothing to enforce yet).
 *
 * IMPORTANT: the bot must be an admin in the force-join channel, or
 * getChatMember will fail/throw for private channels.
 */
async function isJoined(telegram, userId) {
  const channelId = await getSetting('force_join_channel');
  if (!channelId) return true; // not configured - don't block anyone

  try {
    const member = await telegram.getChatMember(channelId, userId);
    return ['creator', 'administrator', 'member'].includes(member.status);
  } catch (err) {
    console.error('[forceJoin] getChatMember failed:', err.message);
    // If the bot itself can't check (e.g. not admin in channel, or channel
    // deleted), fail closed - block the user and log loudly so the admin notices.
    return false;
  }
}

async function getForceJoinChannel() {
  return getSetting('force_join_channel');
}

module.exports = { isJoined, getForceJoinChannel };
