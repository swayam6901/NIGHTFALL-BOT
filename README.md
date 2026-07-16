# Telegram Batch Forwarder Bot

Multi-admin, force-join, daily-limit batch delivery bot. Node.js + Telegraf + Supabase.

## Setup

1. **Supabase**: Create a project, then run `schema.sql` in the SQL editor.

2. **Storage channel**: Create a private Telegram channel, add your bot as **admin** there. Get its numeric ID (forward any message from it to `@userinfobot` or `@RawDataBot`, or use `@getidsbot`) — should look like `-1001234567890`.

3. **Force-join channel** (optional, configure later via `/forcejoin` once bot is running): same requirement — bot must be admin there.

4. **Env vars**: copy `.env.example` to `.env` and fill in:
   - `BOT_TOKEN` — from @BotFather
   - `SUPER_ADMIN_ID` — your Telegram numeric user ID (get from @userinfobot)
   - `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` — from Supabase project settings > API (use the **service_role** key, not anon)
   - `STORAGE_CHANNEL_ID` — from step 2
   - `WEBHOOK_URL` — your Render service's public URL, e.g. `https://your-app.onrender.com` (leave blank for local polling-mode testing)

5. **Install & run**:
   ```
   npm install
   npm start
   ```

## Deploying on Render

- Deploy as a **Web Service** (not a background worker) — the bot needs an HTTP port listening for both the Telegram webhook and the `/ping` route.
- Set all env vars from `.env.example` in Render's dashboard, including `WEBHOOK_URL` set to your actual Render URL.
- Build command: `npm install`. Start command: `npm start`.
- **Keep-alive**: point an external cron (cron-job.org, UptimeRobot, or a GitHub Actions scheduled workflow) at `https://your-app.onrender.com/ping` every **5-10 minutes** (must be under Render free tier's 15-minute spin-down window).
- Watch your Render free-tier monthly hour cap (750 hrs/instance-month typically) if you're running this alongside other always-on free services (e.g. your price tracker bot).

## Admin workflow

```
/newbatch          -> starts an upload session, replies with a Batch ID
<send files>        -> each file is copied to the storage channel
/done               -> finalizes the batch, gives you the shareable link
/cancel              -> discards the current session (does NOT delete already-copied
                        files from the storage channel - clean those up manually if needed)

/deletebatch <id>
/listbatch
/stats
/premium <user_id>    -> grant premium
/unpremium <user_id>
/forcejoin <channel>   -> set or view the mandatory join channel

/addadmin <user_id>    -> SUPER_ADMIN only
/removeadmin <user_id> -> SUPER_ADMIN only
/listadmins            -> SUPER_ADMIN only
```

## User workflow

User opens `https://t.me/YourBot?start=<batch_id>` -> force-join check (if configured) -> daily-limit check (free users) -> files delivered via a rate-limited internal queue.

## Notes on design decisions (from our spec discussion)

- **Daily reset is lazy, not cron-based**: each request compares the user's `last_reset` date (computed in IST regardless of server timezone) against today; resets inline if different. No scheduled job needed.
- **Multi-admin via DB table**, not a hardcoded ID. `SUPER_ADMIN_ID` in `.env` is auto-seeded into the `admins` table on boot and is the only account that can add/remove other admins.
- **Delivery queue** (`src/queue/deliveryQueue.js`) paces all outgoing `copyMessage` calls (~20/sec) and pauses on Telegram 429 `retry_after` responses, so large batches or many simultaneous users won't trip flood control. It's in-memory/single-instance — fine for MVP; swap for BullMQ+Redis if you ever scale to multiple instances.
- **Webhook mode** is used (not polling) since Render's free-tier keep-alive trick requires an HTTP server anyway.
- Bot-blocked-by-user (403) errors during delivery abort the rest of that user's batch send instead of retrying forever.
- Batch IDs are regenerated on collision (checked against DB) before being assigned.
