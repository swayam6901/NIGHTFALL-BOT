const config = require('../config');
const db = require('../db/queries');
const { todayIST } = require('../utils/dateIST');
const { isJoined, getForceJoinChannel } = require('../middleware/forceJoin');
const { pendingRequests } = require('../state');
const deliveryQueue = require('../queue/deliveryQueue');

/**
 * Returns a usable join link for the force-join channel.
 * Public channels: https://t.me/<username>
 * Private channels: needs an actual invite link, generated via
 * exportChatInviteLink if the bot doesn't already have one.
 */
async function getChannelInviteLink(telegram, channel) {
  try {
    const chat = await telegram.getChat(channel);
    if (chat.username) return `https://t.me/${chat.username}`;
    if (chat.invite_link) return chat.invite_link;

    const exported = await telegram.exportChatInviteLink(channel);
    return exported || null;
  } catch (err) {
    console.error('[forceJoin] Failed to resolve invite link:', err.message);
    return null;
  }
}

/**
 * Builds the caption for a delivered file: keeps the admin's original
 * caption (if any) and appends the "Join Channel" promo line underneath.
 */
function buildDeliveryCaption(originalCaption) {
  const joinLine = config.JOIN_CHANNEL_USERNAME
    ? `📢 Join Channel: ${config.JOIN_CHANNEL_USERNAME}`
    : '';

  if (!joinLine) return originalCaption || undefined;
  return originalCaption ? `${originalCaption}\n\n${joinLine}` : joinLine;
}

/**
 * Schedules the delivered batch to be deleted after config.AUTO_DELETE_SECONDS,
 * then replaces it with a "Previous Message was Deleted" recovery prompt with
 * a button to re-trigger delivery.
 */
function scheduleAutoDelete(telegram, userId, batchId, messageIds) {
  if (config.AUTO_DELETE_SECONDS <= 0 || messageIds.length === 0) return;

  setTimeout(async () => {
    for (const messageId of messageIds) {
      await telegram.deleteMessage(userId, messageId).catch(() => {});
    }

    await telegram
      .sendMessage(
        userId,
        '<b>Previous Message was Deleted</b>\n' +
          '<blockquote>If you want to get the files again, then click the button below, else close this message.</blockquote>',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '♻️ Click Here', callback_data: `redeliver:${batchId}` },
                { text: '❌ Close', callback_data: 'closeprompt' },
              ],
            ],
          },
        }
      )
      .catch(() => {});
  }, config.AUTO_DELETE_SECONDS * 1000);
}

/**
 * Attempts to deliver a batch to a user. Runs force-join check, then
 * premium/daily-limit check, then queues the actual file copies.
 * Used both from /start deep-link and from the Verify button callback.
 */
async function attemptDelivery(ctx, batchId, userId) {
  const channel = await getForceJoinChannel();

  if (channel) {
    const joined = await isJoined(ctx.telegram, userId);
    if (!joined) {
      pendingRequests.set(userId, batchId);
      const inviteLink = await getChannelInviteLink(ctx.telegram, channel);

      return ctx.reply('You must join our channel to continue.', {
        reply_markup: {
          inline_keyboard: [
            inviteLink
              ? [{ text: 'Join Channel', url: inviteLink }]
              : [{ text: 'Join Channel (contact admin - link unavailable)', callback_data: 'noop' }],
            [{ text: 'Verify', callback_data: `verify:${batchId}` }],
          ],
        },
      });
    }
  }

  const batch = await db.getBatch(batchId);
  if (!batch) {
    return ctx.reply('This batch link is invalid or has been deleted.');
  }

  const user = await db.getOrCreateUser(userId);
  const today = todayIST();

  if (!user.premium) {
    // Lazy reset: if last_reset isn't today (IST), reset the counter first
    let dailyCount = user.daily_count;
    if (user.last_reset !== today) {
      dailyCount = 0;
    }

    if (dailyCount >= config.FREE_DAILY_LIMIT) {
      return ctx.reply(
        `Daily limit reached (${config.FREE_DAILY_LIMIT}/${config.FREE_DAILY_LIMIT}).\n\nUpgrade to Premium to continue. Contact an admin for details.`
      );
    }

    await db.updateUser(userId, { daily_count: dailyCount + 1, last_reset: today });
    await ctx.reply(`Today's Usage: ${dailyCount + 1}/${config.FREE_DAILY_LIMIT}`);
  }

  pendingRequests.delete(userId);

  const messages = await db.getBatchMessages(batchId);
  if (messages.length === 0) {
    return ctx.reply('This batch has no files.');
  }

  await ctx.reply(`Sending ${messages.length} file(s)...`);

  let failCount = 0;
  const sentMessageIds = [];
  for (const msg of messages) {
    try {
      const sent = await deliveryQueue.enqueue(() =>
        ctx.telegram.copyMessage(userId, config.STORAGE_CHANNEL_ID, msg.message_id, {
          caption: buildDeliveryCaption(msg.caption),
          protect_content: true, // blocks saving/forwarding on the recipient's end
        })
      );
      sentMessageIds.push(sent.message_id);
    } catch (err) {
      failCount += 1;
      console.error(`[delivery] failed to deliver message ${msg.message_id} to ${userId}:`, err.message);
      // If the user has blocked the bot, every subsequent send will fail too -
      // stop wasting queue slots on a dead chat.
      if (err && err.response && err.response.error_code === 403) {
        console.warn(`[delivery] user ${userId} appears to have blocked the bot, aborting rest of batch`);
        break;
      }
    }
  }

  if (failCount > 0) {
    await ctx.reply(`Done, but ${failCount} file(s) failed to send. Contact an admin if this persists.`);
  }

  scheduleAutoDelete(ctx.telegram, userId, batchId, sentMessageIds);
}

function registerUserHandlers(bot) {
  // ---------- /start [batch_id] ----------
  bot.start(async (ctx) => {
    const payload = ctx.startPayload; // batch_id if deep-linked
    await db.getOrCreateUser(ctx.from.id);

    if (!payload) {
      return ctx.reply(
        'Welcome! Send a batch link to download content, or use /help for more info.'
      );
    }

    await attemptDelivery(ctx, payload, ctx.from.id);
  });

  // ---------- Verify button callback ----------
  bot.action(/^verify:(.+)$/, async (ctx) => {
    const batchId = ctx.match[1];
    await ctx.answerCbQuery('Checking membership...');

    const joined = await isJoined(ctx.telegram, ctx.from.id);
    if (!joined) {
      return ctx.answerCbQuery('You have not joined the channel yet.', { show_alert: true });
    }

    await ctx.deleteMessage().catch(() => {}); // clean up the join-prompt message
    await attemptDelivery(ctx, batchId, ctx.from.id);
  });

  // ---------- "Click Here" on the recovery prompt (re-deliver a batch) ----------
  bot.action(/^redeliver:(.+)$/, async (ctx) => {
    const batchId = ctx.match[1];
    await ctx.answerCbQuery('Sending your files again...');
    await ctx.deleteMessage().catch(() => {}); // clean up the recovery prompt
    await attemptDelivery(ctx, batchId, ctx.from.id);
  });

  // ---------- "Close" on the recovery prompt ----------
  bot.action('closeprompt', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.deleteMessage().catch(() => {});
  });

  bot.action('noop', async (ctx) => {
    await ctx.answerCbQuery();
  });

  // ---------- /help ----------
  bot.help(async (ctx) => {
    await ctx.reply(
      'How to use this bot:\n\n' +
        '1. Open a batch link shared with you (https://t.me/.../?start=BATCH_ID)\n' +
        '2. Join the required channel if prompted, then tap Verify\n' +
        '3. Files will be sent to you automatically\n\n' +
        `Free users: ${config.FREE_DAILY_LIMIT} batch downloads per day.\n` +
        'Use /premium to learn about unlimited downloads.'
    );
  });

  // ---------- /premium (info display - falls through from adminHandlers) ----------
  bot.command('premium', async (ctx) => {
    const user = await db.getOrCreateUser(ctx.from.id);
    if (user.premium) {
      return ctx.reply('You are a Premium user - unlimited downloads, no daily limit.');
    }
    await ctx.reply(
      `You are on the Free plan (${config.FREE_DAILY_LIMIT} downloads/day).\n\nContact an admin to upgrade to Premium for unlimited downloads.`
    );
  });
}

module.exports = registerUserHandlers;
