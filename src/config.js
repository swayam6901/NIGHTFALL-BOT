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

  // Channel where the thumbnail + caption + link promo post goes after
  // /done (separate from STORAGE_CHANNEL_ID). Optional - if unset, the
  // thumbnail step is skipped entirely.
  POSTING_CHANNEL_ID: process.env.POSTING_CHANNEL_ID
    ? Number(process.env.POSTING_CHANNEL_ID)
    : null,

  // One is picked at random for each promo post. {link} and {count} are
  // substituted in. Edit freely - keep {link} in every one of them.
  POST_CAPTIONS: [
    '🎬 New upload is here!\n\n {count} file(s) inside\n👉 {link}',
    '✨ Fresh drop just landed\n\n {count} file(s)\n🔗 {link}',
    '🔥 Just posted!\n\n{count} file(s) waiting for you\n🔗 {link}',
    ' New content uploaded\n\n📁 {count} file(s)\n👉 Tap to get: {link}',
    ' Check this out - just uploaded\n\n {count} file(s)\n🔗 {link}',
  ],

  // Premium plan catalog shown by /premium. `days: null` = lifetime (no expiry).
  // Prices are informational only - there's no payment gateway wired in;
  // the admin grants the plan manually after confirming payment.
  PREMIUM_PLANS: [
    { id: '1week', label: '1 Week', price: 'Rs 30', days: 7 },
    { id: '1month', label: '1 Month', price: 'Rs 70', days: 30 },
    { id: '6months', label: '6 Months', price: 'Rs 200', days: 180 },
    { id: 'lifetime', label: 'Lifetime', price: 'Rs 369', days: null },
  ],

  // Where "Buy" button presses go - shown to the user as who to pay/contact.
  // Set this to your own @username.
  PAYMENT_CONTACT: process.env.PAYMENT_CONTACT || '@regnis',
};
