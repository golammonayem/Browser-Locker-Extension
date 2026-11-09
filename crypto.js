/* ============================================================
 * Browser-Locker — crypto.js
 * Cryptographic utility functions for Browser-Locker.
 * Plain JS functions on global scope (NO ES6 import/export).
 * Loaded via <script src="crypto.js"> in lock.html and popup.html.
 * ============================================================ */

/**
 * Single deterministic SHA-256 hash function with application salt.
 * @param {string} text - The plaintext to hash.
 * @returns {Promise<string>} Hex-encoded SHA-256 digest string.
 */
async function hashText(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text + "::browser-locker-salt");
  const buffer = await crypto.subtle.digest("SHA-256", data);
  const byteArray = new Uint8Array(buffer);
  return Array.from(byteArray)
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Cryptographically secure recovery key generator.
 * Format: XXXX-XXXX-XXXX-XXXX (16 chars, hyphen-separated).
 * Excludes ambiguous characters (0, O, 1, I).
 * @returns {string} Formatted recovery key.
 */
function generateRecoveryKey() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const segments = [];
  for (let s = 0; s < 4; s++) {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    let segment = "";
    for (let i = 0; i < 4; i++) {
      segment += chars[bytes[i] % chars.length];
    }
    segments.push(segment);
  }
  return segments.join("-");
}
