/**
 * String and Data Formatters
 */

const emojis = require("./emojis");

/**
 * Format milliseconds into human readable time format (MM:SS or HH:MM:SS)
 * @param {number} ms 
 * @returns {string}
 */
function formatDuration(ms) {
  if (ms === 0) return "00:00";
  if (!ms || isNaN(ms) || ms < 0 || ms === Infinity) return "LIVE";
  
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n) => (n < 10 ? `0${n}` : `${n}`);

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Parse string duration like "1:30", "90s", "2m", "1h" to milliseconds
 * @param {string} str 
 * @returns {number|null}
 */
function parseDuration(str) {
  if (str === null || str === undefined) return null;
  const raw = String(str).trim().toLowerCase();
  if (!raw) return null;

  // Pure digits = seconds.
  if (/^\d+$/.test(raw)) return parseInt(raw, 10) * 1000;

  // mm:ss or hh:mm:ss. Every part must be a plain number: parseInt would turn
  // "1:2x" into 1:2 and silently accept garbage.
  if (raw.includes(":")) {
    const parts = raw.split(":");
    if (parts.length < 2 || parts.length > 3) return null;
    if (parts.some((part) => !/^\d+$/.test(part))) return null;
    const [a, b, c] = parts.map((part) => parseInt(part, 10));
    return parts.length === 2 ? (a * 60 + b) * 1000 : (a * 3600 + b * 60 + c) * 1000;
  }

  // Units: 1h, 2m30s, 1.5m, 90s. The whole string must be consumed so decimals
  // are not misread ("1.5m" used to match "5m") and junk like "abc1m" is
  // rejected instead of becoming a minute.
  const match = raw.match(
    /^(?:(\d+(?:\.\d+)?)\s*h)?\s*(?:(\d+(?:\.\d+)?)\s*m)?\s*(?:(\d+(?:\.\d+)?)\s*s)?$/
  );
  if (!match || (!match[1] && !match[2] && !match[3])) return null;

  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  return Math.round((hours * 3600 + minutes * 60 + seconds) * 1000);
}

/**
 * Create a sleek text progress bar (Eara Style)
 * Uses high-visibility contrasting blocks for desktop & mobile
 * @param {number} current 
 * @param {number} total 
 * @param {number} size 
 * @returns {string}
 */
function createProgressBar(current, total, size = 12) {
  return emojis.createProgressBar(current, total, size);
}

/**
 * Format bytes to readable string (MB/GB)
 * @param {number} bytes 
 * @returns {string}
 */
function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 MB";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Get recognizable badge or emoji for streaming platform
 * @param {string} sourceName 
 * @returns {string}
 */
function getSourceBadge(sourceName) {
  return emojis.getPlatformBadge(sourceName);
}

/**
 * Truncate string to max characters
 * @param {string} text 
 * @param {number} length 
 * @returns {string}
 */
function truncate(text, length = 60) {
  if (!text) return "";
  return text.length > length ? text.substring(0, length - 3) + "..." : text;
}

/**
 * Format requester as clean display text WITHOUT any Discord mention token
 * (no `<@id>`, no `@handle`) so nothing can ping or trigger mention pills.
 * @param {object} requester 
 * @returns {string}
 */
function formatRequester(requester) {
  if (!requester) return "Listener";
  const name = requester.globalName || requester.displayName || requester.username || requester.tag;
  return name || "Listener";
}

module.exports = {
  formatDuration,
  parseDuration,
  createProgressBar,
  formatBytes,
  getSourceBadge,
  truncate,
  formatRequester,
};
