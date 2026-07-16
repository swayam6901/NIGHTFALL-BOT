const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/**
 * Returns today's date string in IST, e.g. "2026-07-16"
 * Works regardless of server timezone (Render runs UTC).
 */
function todayIST() {
  const nowIST = new Date(Date.now() + IST_OFFSET_MS);
  return nowIST.toISOString().split('T')[0];
}

module.exports = { todayIST };
