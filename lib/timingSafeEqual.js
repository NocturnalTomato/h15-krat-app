// XOR-based constant-time string comparison to avoid timing attacks.
// Ported unchanged from the old worker-spond/worker.js.
function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const aBytes = enc.encode(String(a));
  const bBytes = enc.encode(String(b));
  const len = Math.max(aBytes.length, bBytes.length);
  let result = aBytes.length !== bBytes.length ? 1 : 0;
  for (let i = 0; i < len; i++) {
    result |= (aBytes[i] || 0) ^ (bBytes[i] || 0);
  }
  return result === 0;
}

module.exports = { timingSafeEqual };
