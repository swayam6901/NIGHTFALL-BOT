const config = require('../config');
const db = require('../db/queries');
const { todayIST } = require('../utils/dateIST');
const { isJoined, getForceJoinChannel } = require('../middleware/forceJoin');
const { pendingRequests } = require('../state');
const deliveryQueue = require('../queue/deliveryQueue');

/**
 * Returns a usable join link for the force-join channel.
 * Public channels: https://t.me/<username>
 * Private channels: needs an actual invite link generated via
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
 * then replaces it with a "Previous Message was Deleted" recovery prompt.
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
        '<b>⏰ Files Deleted</b>\n' +
          '<blockquote>Those files have been automatically removed. ' +
          'Click the button below to receive them again.</blockquote>',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '♻️ Get Files Again', callback_data: `redeliver:${batchId}` },
                { text: '❌ Close', callback_data: 'closeprompt' },
              ],
            ],
          },
        }
      )
      .catch(() => {});
  }, config.AUTO_DELETE_SECONDS * 1000);
}

/** Formats a UTC ISO expiry string into a readable IST date label. */
function formatExpiry(isoString) {
  if (!isoString) return 'Never (Lifetime)';
  const d = new Date(new Date(isoString).getTime() + 5.5 * 60 * 60 * 1000);
  return d.toISOString().split('T')[0]; // YYYY-MM-DD in IST
}

/**
 * Attempts to deliver a batch to a user. Runs force-join check, then
 * premium/daily-limit check (with lazy expiry enforcement), then queues
 * the actual file copies.
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
              ? [{ text: '📢 Join Channel', url: inviteLink }]
              : [{ text: 'Join Channel (contact admin - link unavailable)', callback_data: 'noop' }],
            [{ text: '✅ Verify', callback_data: `verify:${batchId}` }],
          ],
        },
      });
    }
  }

  const batch = await db.getBatch(batchId);
  if (!batch) {
    return ctx.reply('This batch link is invalid or has been deleted.');
  }

  // Lazy expiry check - downgrades the user in DB if their plan has lapsed
  let user = await db.getOrCreateUser(userId);
  user = await db.checkAndExpirePremium(user);

  const today = todayIST();

  if (!user.premium) {
    // Lazy daily reset: if last_reset isn't today (IST), reset the counter first
    let dailyCount = user.daily_count;
    if (user.last_reset !== today) {
      dailyCount = 0;
    }

    if (dailyCount >= config.FREE_DAILY_LIMIT) {
      return ctx.reply(
        `⚠️ Daily limit reached (${config.FREE_DAILY_LIMIT}/${config.FREE_DAILY_LIMIT}).\n\n` +
          `Upgrade to Premium for unlimited downloads.\nUse /premium to see plans.`
      );
    }

    await db.updateUser(userId, { daily_count: dailyCount + 1, last_reset: today });
    await ctx.reply(`📊 Today's Usage: ${dailyCount + 1}/${config.FREE_DAILY_LIMIT}`);
  }

  pendingRequests.delete(userId);

  const messages = await db.getBatchMessages(batchId);
  if (messages.length === 0) {
    return ctx.reply('This batch has no files.');
  }

  // Warn the user upfront that files will be auto-deleted
  const deleteMinutes = Math.round(config.AUTO_DELETE_SECONDS / 60);
  await ctx.reply(
    `📨 Sending ${messages.length} file(s)...\n\n` +
      `⚠️ <b>Note:</b> These files will be automatically deleted in <b>${deleteMinutes} minutes</b>. ` +
      `Save them before then, or use the recall button to get them again.`,
    { parse_mode: 'HTML' }
  );

  let failCount = 0;
  const sentMessageIds = [];
  for (const msg of messages) {
    try {
      const sent = await deliveryQueue.enqueue(() =>
        ctx.telegram.copyMessage(userId, config.STORAGE_CHANNEL_ID, msg.message_id, {
          caption: buildDeliveryCaption(msg.caption),
          protect_content: true,
        })
      );
      sentMessageIds.push(sent.message_id);
    } catch (err) {
      failCount += 1;
      console.error(`[delivery] failed to deliver message ${msg.message_id} to ${userId}:`, err.message);
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
    const payload = ctx.startPayload;
    await db.getOrCreateUser(ctx.from.id);

    if (!payload) {
      return ctx.reply(
        `👋 Welcome! Open a batch link to receive files.\n\n` +
          `Use /help for instructions or /premium to see plans.`
      );
    }

    await attemptDelivery(ctx, payload, ctx.from.id);
  });

  // ---------- /info ----------
  bot.command('info', async (ctx) => {
    let user = await db.getOrCreateUser(ctx.from.id);
    user = await db.checkAndExpirePremium(user); // ensure premium status is fresh

    const from = ctx.from;
    const name = [from.first_name, from.last_name].filter(Boolean).join(' ');
    const username = from.username ? `@${from.username}` : 'Not set';

    let planLine;
    if (user.premium) {
      const planLabel = user.premium_plan
        ? config.PREMIUM_PLANS.find((p) => p.id === user.premium_plan)?.label || user.premium_plan
        : 'Premium';
      const expiryLine =
        user.premium_expiry ? `Expires: ${formatExpiry(user.premium_expiry)}` : 'Lifetime (never expires)';
      planLine = `⭐ Premium — ${planLabel}\n📅 ${expiryLine}`;
    } else {
      const today = todayIST();
      const dailyCount = user.last_reset === today ? user.daily_count : 0;
      planLine =
        `🆓 Free Plan\n` +
        `📊 Today's usage: ${dailyCount}/${config.FREE_DAILY_LIMIT} downloads\n` +
        `💡 Use /premium to upgrade`;
    }

    await ctx.reply(
      `<b>👤 Your Info</b>\n\n` +
        `Name: ${name}\n` +
        `Username: ${username}\n` +
        `User ID: <code>${from.id}</code>\n` +
        `Joined: ${new Date(user.joined_at).toISOString().split('T')[0]}\n\n` +
        `<b>📦 Plan</b>\n${planLine}`,
      { parse_mode: 'HTML' }
    );
  });

  // ---------- /premium (plans display - falls through from adminHandlers) ----------
  bot.command('premium', async (ctx) => {
    let user = await db.getOrCreateUser(ctx.from.id);
    user = await db.checkAndExpirePremium(user);

    if (user.premium) {
      const planLabel = user.premium_plan
        ? config.PREMIUM_PLANS.find((p) => p.id === user.premium_plan)?.label || user.premium_plan
        : 'Premium';
      const expiryLine = user.premium_expiry
        ? `Expires on ${formatExpiry(user.premium_expiry)}`
        : 'Lifetime — never expires';
      return ctx.reply(
        `⭐ <b>You are a Premium user!</b>\n\n` +
          `Plan: ${planLabel}\n` +
          `${expiryLine}\n\n` +
          `Enjoy unlimited downloads with no daily limit.`,
        { parse_mode: 'HTML' }
      );
    }

    // Build the plans list from config
    const planLines = config.PREMIUM_PLANS.map(
      (p) => `• <b>${p.label}</b> — ${p.price}`
    ).join('\n');

    await ctx.reply(
      `🆓 <b>You are on the Free plan</b>\n` +
        `(${config.FREE_DAILY_LIMIT} downloads/day)\n\n` +
        `<b>⭐ Premium Plans</b>\n\n` +
        `${planLines}\n\n` +
        `To buy, contact: ${config.PAYMENT_CONTACT}\n` +
        `Once payment is confirmed, an admin will activate your plan instantly.`,
      {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '💬 Contact to Buy', url: `https://t.me/${config.PAYMENT_CONTACT.replace('@', '')}` }],
          ],
        },
      }
    );
  });

  // ---------- /help ----------
  bot.help(async (ctx) => {
    await ctx.reply(
      `<b>How to use this bot</b>\n\n` +
        `1. Open a batch link shared with you\n` +
        `2. Join the required channel if prompted, then tap Verify\n` +
        `3. Files will be sent to you automatically\n\n` +
        `⚠️ Files are auto-deleted after ${Math.round(config.AUTO_DELETE_SECONDS / 60)} minutes — save them in time!\n\n` +
        `<b>Commands</b>\n` +
        `/info — your account info and plan\n` +
        `/premium — view plans and upgrade\n` +
        `/help — show this message\n\n` +
        `Free users: ${config.FREE_DAILY_LIMIT} batch downloads/day.`,
      { parse_mode: 'HTML' }
    );
  });

  // ---------- Verify button callback ----------
  bot.action(/^verify:(.+)$/, async (ctx) => {
    const batchId = ctx.match[1];
    await ctx.answerCbQuery('Checking membership...');

    const joined = await isJoined(ctx.telegram, ctx.from.id);
    if (!joined) {
      return ctx.answerCbQuery('You have not joined the channel yet.', { show_alert: true });
    }

    await ctx.deleteMessage().catch(() => {});
    await attemptDelivery(ctx, batchId, ctx.from.id);
  });

  // ---------- Re-deliver button on the auto-delete recovery prompt ----------
  bot.action(/^redeliver:(.+)$/, async (ctx) => {
    const batchId = ctx.match[1];
    await ctx.answerCbQuery('Sending your files again...');
    await ctx.deleteMessage().catch(() => {});
    await attemptDelivery(ctx, batchId, ctx.from.id);
  });

  // ---------- Close button on the recovery prompt ----------
  bot.action('closeprompt', async (ctx) => {
    await ctx.answerCbQuery();
    await ctx.deleteMessage().catch(() => {});
  });

  bot.action('noop', async (ctx) => {
    await ctx.answerCbQuery();
  });
}

module.exports = registerUserHandlers;
