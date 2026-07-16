const { Telegraf } = require('telegraf');
const config = require('./config');
const db = require('./db/queries');
const registerAdminHandlers = require('./handlers/adminHandlers');
const registerUserHandlers = require('./handlers/userHandlers');

const bot = new Telegraf(config.BOT_TOKEN);

// Order matters: admin handlers first so /premium and similar shared
// commands can call next() and fall through to the user-facing handler.
registerAdminHandlers(bot);
registerUserHandlers(bot);

bot.catch((err, ctx) => {
  console.error(`[bot] Unhandled error for update ${ctx.updateType}:`, err);
});

async function bootstrap() {
  // Ensure the super admin from .env always exists in the admins table,
  // even on a completely fresh database.
  try {
    await db.addAdmin(config.SUPER_ADMIN_ID, config.SUPER_ADMIN_ID);
    console.log(`[bot] Super admin ${config.SUPER_ADMIN_ID} ensured in DB.`);
  } catch (err) {
    console.error('[bot] Failed to bootstrap super admin:', err.message);
  }
}

module.exports = { bot, bootstrap };
