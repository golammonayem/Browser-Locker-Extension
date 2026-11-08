/**
 * Browser-Locker - Cryptographic Operations Module
 * Native Web Crypto API implementation for Chrome MV3.
 * Handles SHA-256 salted hashing, constant-time verification,
 * and unambiguous offline recovery key generation.
 *
 * @module crypto
 */

/**
 * Generates a cryptographically secure random hexadecimal salt.
 * @param {number} byteLength - Number of random bytes (default 16 bytes = 32 hex chars).
 * @returns {string} Hexadecimal salt string.
 */
export function generateSalt(byteLength = 16) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Hashes plaintext combined with a salt using SHA-256 via native Web Crypto API.
 * Format digested: "{salt}:{input}"
 * 
 * @param {string} input - Plaintext credential or recovery key.
 * @param {string} saltHex - Hexadecimal salt.
 * @returns {Promise<string>} Hexadecimal SHA-256 hash digest.
 */
export async function hashWithSalt(input, saltHex) {
  if (typeof input !== 'string' || typeof saltHex !== 'string') {
    throw new TypeError('hashWithSalt requires string input and salt');
  }
  const encoder = new TextEncoder();
  const payload = encoder.encode(`${saltHex}:${input}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', payload);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Constant-time string comparison to mitigate timing attacks.
 * @param {string} a - Expected string.
 * @param {string} b - Actual string.
 * @returns {boolean} True if strings match exactly.
 */
export function constantTimeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

/**
 * Verifies a candidate master password against stored hash and salt.
 * @param {string} inputPassword - User supplied password.
 * @param {string} storedHash - Stored SHA-256 hash.
 * @param {string} storedSalt - Stored salt.
 * @returns {Promise<boolean>} True if password matches.
 */
export async function verifyPassword(inputPassword, storedHash, storedSalt) {
  if (!inputPassword || !storedHash || !storedSalt) return false;
  try {
    const computedHash = await hashWithSalt(inputPassword, storedSalt);
    return constantTimeCompare(computedHash, storedHash);
  } catch (err) {
    console.error('[Browser-Locker] Verification error:', err);
    return false;
  }
}

/**
 * Generates an unambiguous, cryptographically random 16-character offline recovery key.
 * Uses a base32-like alphabet excluding confusing glyphs (0, O, 1, I).
 * Formatted as XXXX-XXXX-XXXX-XXXX.
 *
 * @returns {string} 16-character formatted recovery key.
 */
export function generateRecoveryKey() {
  const charset = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  const randomBytes = new Uint8Array(16);
  crypto.getRandomValues(randomBytes);
  
  let keyChars = '';
  for (let i = 0; i < 16; i++) {
    keyChars += charset[randomBytes[i] % charset.length];
  }

  return `${keyChars.slice(0, 4)}-${keyChars.slice(4, 8)}-${keyChars.slice(8, 12)}-${keyChars.slice(12, 16)}`;
}

/**
 * Normalizes user input for recovery keys (strips dashes/spaces, converts to uppercase).
 * @param {string} input - User input string.
 * @returns {string} 16-char normalized string.
 */
export function normalizeRecoveryKey(input) {
  if (typeof input !== 'string') return '';
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Formats a raw 16-character alphanumeric string into XXXX-XXXX-XXXX-XXXX pattern.
 * @param {string} raw - Raw string.
 * @returns {string} Formatted recovery key.
 */
export function formatRecoveryKey(raw) {
  const clean = normalizeRecoveryKey(raw);
  const parts = [];
  for (let i = 0; i < clean.length && i < 16; i += 4) {
    parts.push(clean.slice(i, i + 4));
  }
  return parts.join('-');
}

/**
 * Verifies a candidate recovery key against stored hash and salt.
 * @param {string} inputKey - User provided recovery key.
 * @param {string} storedRecoveryHash - Stored hash.
 * @param {string} storedRecoverySalt - Stored salt.
 * @returns {Promise<boolean>} True if key matches.
 */
export async function verifyRecoveryKey(inputKey, storedRecoveryHash, storedRecoverySalt) {
  if (!inputKey || !storedRecoveryHash || !storedRecoverySalt) return false;
  const clean = normalizeRecoveryKey(inputKey);
  if (clean.length !== 16) return false;
  const formatted = `${clean.slice(0, 4)}-${clean.slice(4, 8)}-${clean.slice(8, 12)}-${clean.slice(12, 16)}`;
  try {
    const computedHash = await hashWithSalt(formatted, storedRecoverySalt);
    return constantTimeCompare(computedHash, storedRecoveryHash);
  } catch (err) {
    console.error('[Browser-Locker] Recovery key verification error:', err);
    return false;
  }
}

/**
 * Evaluates password strength and returns rating, score (0-4), and recommendations.
 * @param {string} password - Candidate password.
 * @returns {{ score: number, label: string, color: string, percent: number }}
 */
export function evaluatePasswordStrength(password) {
  if (!password) {
    return { score: 0, label: 'Empty', color: '#71717a', percent: 0 };
  }

  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score++;

  switch (score) {
    case 0:
    case 1:
      return { score: 1, label: 'Weak', color: '#ef4444', percent: 25 };
    case 2:
      return { score: 2, label: 'Fair', color: '#f59e0b', percent: 50 };
    case 3:
      return { score: 3, label: 'Good', color: '#3b82f6', percent: 75 };
    case 4:
    default:
      return { score: 4, label: 'Strong', color: '#22c55e', percent: 100 };
  }
}
