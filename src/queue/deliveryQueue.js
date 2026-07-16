/**
 * Simple in-memory rate-limited queue for sending/copying Telegram messages.
 *
 * Telegram allows roughly 30 messages/sec globally and ~20/min per group/channel.
 * We stay well under that with a fixed gap between sends, and we honor
 * `retry_after` from 429 errors by pausing the whole queue for that duration.
 *
 * This is process-local. If you scale to multiple instances, replace with
 * a real queue (BullMQ + Redis) - fine for MVP/single-instance on Render.
 */

const MIN_GAP_MS = 50; // ~20 sends/sec global ceiling, safely under Telegram's 30/sec

class DeliveryQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.pausedUntil = 0;
  }

  /**
   * Enqueue a task. task is an async function that performs one Telegram API call.
   * Returns a promise that resolves/rejects with the task's result.
   */
  enqueue(task) {
    return new Promise((resolve, reject) => {
      this.queue.push({ task, resolve, reject });
      this._process();
    });
  }

  async _process() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const now = Date.now();
      if (now < this.pausedUntil) {
        await sleep(this.pausedUntil - now);
      }

      const { task, resolve, reject } = this.queue.shift();

      try {
        const result = await task();
        resolve(result);
      } catch (err) {
        if (err && err.response && err.response.error_code === 429) {
          const retryAfter = (err.response.parameters && err.response.parameters.retry_after) || 5;
          console.warn(`[queue] Flood control hit, pausing for ${retryAfter}s`);
          this.pausedUntil = Date.now() + retryAfter * 1000;
          // put the task back at the front and retry after pause
          this.queue.unshift({ task, resolve, reject });
          continue;
        }
        // Bot blocked by user, message not found, etc - don't crash the queue
        reject(err);
      }

      await sleep(MIN_GAP_MS);
    }

    this.processing = false;
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = new DeliveryQueue();
