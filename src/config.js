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
};
