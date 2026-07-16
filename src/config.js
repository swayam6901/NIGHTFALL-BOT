require('dotenv').config();

const required = [
  'BOT_TOKEN',
  'SUPER_ADMIN_ID',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'STORAGE_CHANNEL_ID',
];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`[config] Missing required env var: ${key}`);
    process.exit(1);
  }
}

module.exports = {
  BOT_TOKEN: process.env.BOT_TOKEN,
  SUPER_ADMIN_ID: Number(process.env.SUPER_ADMIN_ID),
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY,
  STORAGE_CHANNEL_ID: Number(process.env.STORAGE_CHANNEL_ID),
  WEBHOOK_URL: process.env.WEBHOOK_URL || '',
  PORT: process.env.PORT || 3000,
  WEBHOOK_SECRET_PATH: process.env.WEBHOOK_SECRET_PATH || 'webhook-secret',
  FREE_DAILY_LIMIT: 3,

  // Shown on every delivered file's caption, e.g. "@YourChannel"
  JOIN_CHANNEL_USERNAME: process.env.JOIN_CHANNEL_USERNAME || '',

  // How long (seconds) a delivered batch stays before being auto-deleted and
  // replaced with the "click here to get files again" prompt. 0 disables it.
  AUTO_DELETE_SECONDS: Number(process.env.AUTO_DELETE_SECONDS) || 600,
};
