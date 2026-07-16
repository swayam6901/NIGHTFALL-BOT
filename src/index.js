const express = require('express');
const config = require('./config');
const { bot, bootstrap } = require('./bot');

const app = express();
app.use(express.json());

// Render's free tier spins down after 15 min of no HTTP traffic.
// Point an external cron (cron-job.org, UptimeRobot, GitHub Actions) at
// this route every 5-10 minutes to keep the instance alive.
app.get('/ping', (req, res) => {
  res.status(200).send('pong');
});

app.get('/', (req, res) => {
  res.status(200).send('Bot is running.');
});

const webhookPath = `/telegram/${config.WEBHOOK_SECRET_PATH}`;

async function main() {
  await bootstrap();

  if (config.WEBHOOK_URL) {
    // ---------- Webhook mode (recommended for Render) ----------
    app.use(bot.webhookCallback(webhookPath));

    app.listen(config.PORT, async () => {
      console.log(`[server] Listening on port ${config.PORT}`);
      const fullWebhookUrl = `${config.WEBHOOK_URL}${webhookPath}`;
      await bot.telegram.setWebhook(fullWebhookUrl);
      console.log(`[bot] Webhook set to ${fullWebhookUrl}`);
    });
  } else {
    // ---------- Polling mode (local dev fallback) ----------
    // Still start the express server so /ping works if you test on Render
    // without WEBHOOK_URL set (not recommended for real deployment).
    app.listen(config.PORT, () => {
      console.log(`[server] Listening on port ${config.PORT} (polling mode - ping route only)`);
    });
    await bot.launch();
    console.log('[bot] Started in polling mode.');
  }
}

main().catch((err) => {
  console.error('[fatal] Failed to start bot:', err);
  process.exit(1);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
