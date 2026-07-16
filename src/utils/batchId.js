const { batchIdExists } = require('../db/queries');

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function randomId(length = 6) {
  let id = '';
  for (let i = 0; i < length; i++) {
    id += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return id;
}

/**
 * Generates a random batch ID, regenerating on collision.
 * Gives up after maxAttempts to avoid an infinite loop in a pathological case.
 */
async function generateUniqueBatchId(maxAttempts = 10) {
  for (let i = 0; i < maxAttempts; i++) {
    const id = randomId(6);
    const exists = await batchIdExists(id);
    if (!exists) return id;
  }
  throw new Error('Could not generate a unique batch ID after multiple attempts');
}

module.exports = { generateUniqueBatchId };
