const config = require('../config');
const db = require('../db/queries');
const { todayIST } = require('../utils/dateIST');
const { isJoined, getForceJoinChannel } = require('../middleware/forceJoin');
const { pendingRequests } = require('../state');
const deliveryQueue = require('../queue/deliveryQueue');

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
      const chat = await ctx.telegram.getChat(channel).catch(() => null);
      const inviteLink = chat && chat.username ? `https://t.me/${chat.username}` : null;

      return ctx.reply('You must join our channel to continue.', {
        reply_markup: {
          inline_keyboard: [
            inviteLink
              ? [{ text: 'Join Channel', url: inviteLink }]
              : [{ text: 'Join Channel', callback_data: 'noop' }],
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
  for (const msg of messages) {
    try {
      await deliveryQueue.enqueue(() =>
        ctx.telegram.copyMessage(userId, config.STORAGE_CHANNEL_ID, msg.message_id)
      );
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
