const config = require('../config');
const db = require('../db/queries');
const { generateUniqueBatchId } = require('../utils/batchId');
const { uploadSessions } = require('../state');
const { invalidateCache, requireAdmin } = require('../middleware/adminAuth');

function registerAdminHandlers(bot) {
  const adminOnly = requireAdmin();

  // ---------- /newbatch ----------
  bot.command('newbatch', adminOnly, async (ctx) => {
    const adminId = ctx.from.id;

    if (uploadSessions.has(adminId)) {
      return ctx.reply(
        'You already have an active upload session. Send /done to finish it or /cancel to discard it.'
      );
    }

    const batchId = await generateUniqueBatchId();
    await db.createBatch(batchId, adminId);

    uploadSessions.set(adminId, { batchId, fileOrder: 0, active: true });

    await ctx.reply(
      `Upload mode started.\nBatch ID: ${batchId}\n\nSend any files now (videos, docs, images, zips, etc). Send /done when finished, or /cancel to discard.`
    );
  });

  // ---------- File intake during an active session ----------
  // Matches any message with a forwardable media payload
  bot.on(['document', 'video', 'audio', 'photo', 'voice', 'animation', 'video_note'], async (ctx, next) => {
    const adminId = ctx.from.id;
    const session = uploadSessions.get(adminId);
    if (!session || !session.active) return next ? next() : undefined;

    try {
      const copied = await ctx.telegram.copyMessage(
        config.STORAGE_CHANNEL_ID,
        ctx.chat.id,
        ctx.message.message_id
      );
      session.fileOrder += 1;
      // Preserve whatever caption the admin sent with the file (if any) so it
      // can be re-tagged with the join-channel promo line at delivery time.
      const originalCaption = ctx.message.caption || null;
      await db.addBatchMessage(session.batchId, copied.message_id, session.fileOrder, originalCaption);

      // Lightweight ack every file so admin has feedback without spamming
      if (session.fileOrder % 5 === 0) {
        await ctx.reply(`${session.fileOrder} files received so far...`);
      }
    } catch (err) {
      console.error('[newbatch] failed to copy file to storage channel:', err.message);
      await ctx.reply(
        'Failed to store that file (bot may not be admin in the storage channel). Skipped it - continue sending, or /cancel.'
      );
    }
  });

  // ---------- /done ----------
  bot.command('done', adminOnly, async (ctx) => {
    const adminId = ctx.from.id;
    const session = uploadSessions.get(adminId);
    if (!session) {
      return ctx.reply('No active upload session. Start one with /newbatch.');
    }

    if (session.fileOrder === 0) {
      uploadSessions.delete(adminId);
      await db.deleteBatch(session.batchId);
      return ctx.reply('No files were sent, batch discarded.');
    }

    await db.finalizeBatch(session.batchId, session.fileOrder);
    uploadSessions.delete(adminId);

    const botInfo = await ctx.telegram.getMe();
    const link = `https://t.me/${botInfo.username}?start=${session.batchId}`;

    await ctx.reply(
      `Batch Created\n\nFiles: ${session.fileOrder}\nBatch ID: ${session.batchId}\n\nDownload Link:\n${link}`
    );
  });

  // ---------- /cancel ----------
  bot.command('cancel', adminOnly, async (ctx) => {
    const adminId = ctx.from.id;
    const session = uploadSessions.get(adminId);
    if (!session) {
      return ctx.reply('No active upload session to cancel.');
    }

    uploadSessions.delete(adminId);
    await db.deleteBatch(session.batchId); // cascades batch_messages too

    await ctx.reply(
      `Upload session cancelled. Batch ${session.batchId} and its ${session.fileOrder} file record(s) discarded.\n\nNote: the actual copied files remain in the storage channel - delete them there manually if needed.`
    );
  });

  // ---------- /deletebatch <id> ----------
  bot.command('deletebatch', adminOnly, async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    const batchId = parts[1];
    if (!batchId) return ctx.reply('Usage: /deletebatch <batch_id>');

    const deleted = await db.deleteBatch(batchId);
    await ctx.reply(deleted ? `Batch ${batchId} deleted.` : `Batch ${batchId} not found.`);
  });

  // ---------- /listbatch ----------
  bot.command('listbatch', adminOnly, async (ctx) => {
    const batches = await db.listBatches(20);
    if (batches.length === 0) return ctx.reply('No batches yet.');

    const lines = batches.map(
      (b) => `${b.batch_id} - ${b.total_files} files - ${new Date(b.created_at).toISOString().split('T')[0]}`
    );
    await ctx.reply(`Recent batches (max 20):\n\n${lines.join('\n')}`);
  });

  // ---------- /stats ----------
  bot.command('stats', adminOnly, async (ctx) => {
    const stats = await db.getStats();
    await ctx.reply(
      `Admin Statistics\n\n` +
        `Total Users: ${stats.totalUsers}\n` +
        `Premium Users: ${stats.premiumUsers}\n` +
        `Total Batches: ${stats.totalBatches}\n` +
        `Total Stored Files: ${stats.totalFiles}`
    );
  });

  // ---------- /premium <user_id> (admin grant) ----------
  // Note: /premium with NO args is also a user-facing "show premium info"
  // command (see userHandlers.js). We only intercept it here when an admin
  // supplies a target user_id; otherwise we pass through to the next handler.
  bot.command('premium', async (ctx, next) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    const targetId = Number(parts[1]);

    if (!targetId) return next(); // no args - let userHandlers show premium info

    const admin = await db.isAdmin(ctx.from.id);
    if (!admin) return next(); // non-admin typed "/premium 12345" - just show info instead

    await db.setPremium(targetId, true);
    await ctx.reply(`User ${targetId} is now Premium.`);
  });

  // ---------- /unpremium <user_id> ----------
  bot.command('unpremium', adminOnly, async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    const targetId = Number(parts[1]);
    if (!targetId) return ctx.reply('Usage: /unpremium <user_id>');

    await db.setPremium(targetId, false);
    await ctx.reply(`User ${targetId} Premium removed.`);
  });

  // ---------- /forcejoin <channel_id_or_@username> ----------
  bot.command('forcejoin', adminOnly, async (ctx) => {
    const parts = ctx.message.text.trim().split(/\s+/);
    const channel = parts[1];
    if (!channel) {
      const current = await db.getSetting('force_join_channel');
      return ctx.reply(
        current
          ? `Current force-join channel: ${current}\n\nTo change: /forcejoin <channel_id_or_@username>`
          : 'No force-join channel set.\n\nUsage: /forcejoin <channel_id_or_@username>\n\nMake sure the bot is an admin in that channel first.'
      );
    }

    // Sanity-check the bot can actually see this chat before saving it
    try {
      await ctx.telegram.getChat(channel);
    } catch (err) {
      return ctx.reply(
        `Could not access ${channel}. Make sure the bot is added as admin there, and the ID/username is correct.`
      );
    }

    await db.setSetting('force_join_channel', channel);
    await ctx.reply(`Force-join channel set to: ${channel}`);
  });

  // ---------- /addadmin <user_id> (super admin only) ----------
  bot.command('addadmin', async (ctx) => {
    if (ctx.from.id !== config.SUPER_ADMIN_ID) {
      return; // silently ignore - only super admin can manage admins
    }
    const parts = ctx.message.text.trim().split(/\s+/);
    const targetId = Number(parts[1]);
    if (!targetId) return ctx.reply('Usage: /addadmin <user_id>');

    await db.addAdmin(targetId, ctx.from.id);
    await invalidateCache();
    await ctx.reply(`User ${targetId} added as admin.`);
  });

  // ---------- /removeadmin <user_id> (super admin only) ----------
  bot.command('removeadmin', async (ctx) => {
    if (ctx.from.id !== config.SUPER_ADMIN_ID) {
      return;
    }
    const parts = ctx.message.text.trim().split(/\s+/);
    const targetId = Number(parts[1]);
    if (!targetId) return ctx.reply('Usage: /removeadmin <user_id>');

    if (targetId === config.SUPER_ADMIN_ID) {
      return ctx.reply('Cannot remove the super admin.');
    }

    await db.removeAdmin(targetId);
    await invalidateCache();
    await ctx.reply(`User ${targetId} removed from admins.`);
  });

  // ---------- /listadmins (super admin only, handy for auditing) ----------
  bot.command('listadmins', async (ctx) => {
    if (ctx.from.id !== config.SUPER_ADMIN_ID) return;
    const admins = await db.listAdmins();
    const lines = admins.map((a) => `${a.telegram_id} (added by ${a.added_by})`);
    await ctx.reply(`Admins:\n\n${lines.join('\n')}`);
  });
}

module.exports = registerAdminHandlers;
