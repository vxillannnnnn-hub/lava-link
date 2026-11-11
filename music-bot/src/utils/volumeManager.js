/**
 * Gain path
 * ---------------------------------------------------------------------------
 * Lavalink's volume operator is a multiply on decoded PCM, and 100% is unity.
 *
 *   - 100% is the only value that keeps bit-exact Opus passthrough: the node
 *     forwards the source's packets and never decodes them.
 *   - Below 100% the node decodes and re-encodes at the channel bitrate.
 *   - Above 100% it does the same, and the multiplied samples can exceed full
 *     scale, which the Opus encoder clamps: audible as hard clipping, not as
 *     "louder".
 *
 * The bot used to refuse anything above unity. That is safe but wrong as a
 * product decision - every other music bot lets you push a quiet master - so
 * the ceiling is now configurable (`MAX_VOLUME`, default 200% = +6 dB) and the
 * trade-off is stated outright instead of being silently applied:
 *
 *   0-99%   -> attenuation, re-encode, no clipping
 *   100%    -> unity gain, bit-exact Opus passthrough
 *   101%+   -> digital boost, explicit clipping warning, re-encode
 *   > MAX   -> capped at the ceiling, and the reply says so
 *
 * Going louder than this without distortion needs a limiter/compressor on the
 * node (e.g. a `loudnorm`/`dynaudnorm` filter plugin); digital gain in the bot
 * cannot do it cleanly.
 */

const config = require("../config");
const logger = require("./logger");

const UNITY_VOLUME = 100;

// Lavalink itself accepts up to 1000 (100 = unity). Past ~200% (+6 dB) almost
// every mastered track clips hard, so 200 is the default ceiling.
const MAX_VOLUME = (() => {
  const raw = Number(config.player?.maxVolume);
  const value = Number.isFinite(raw) ? Math.round(raw) : 200;
  return Math.min(1000, Math.max(UNITY_VOLUME, value));
})();

/**
 * dB relative to unity, e.g. 200% -> +6 dB.
 * @param {number} level percentage
 * @returns {number}
 */
function gainDb(level) {
  const ratio = Number(level) / UNITY_VOLUME;
  if (!(ratio > 0)) return 0;
  return Math.round(20 * Math.log10(ratio) * 10) / 10;
}

/**
 * Normalise any requested level into what will actually be applied.
 * @param {number} level requested percentage
 * @returns {{ requested: number, applied: number, boosted: boolean, capped: boolean }}
 */
function clampVolume(level) {
  const numeric = Number(level);
  const requested = Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : UNITY_VOLUME;
  const applied = Math.min(requested, MAX_VOLUME);
  return { requested, applied, boosted: applied > UNITY_VOLUME, capped: requested > MAX_VOLUME };
}

/**
 * Apply a volume request through the gain path.
 * @param {import("lavalink-client").Player} player
 * @param {number} level requested percentage
 */
async function applyVolume(player, level) {
  const result = clampVolume(level);

  if (!player || typeof player.setVolume !== "function") {
    throw new TypeError("A live player is required to change the volume.");
  }

  // Only write when the value actually changes: each request is one PATCH to
  // the node, and re-sending the same value re-arms the decode path for nothing.
  if (Number(player.volume) !== result.applied) {
    await player.setVolume(result.applied);
  }

  // Keep the user's intent visible for the UI/diagnostics even when it was capped.
  player.set("requestedVolume", result.requested);

  if (result.capped) {
    logger.debug(
      `[Volume] Guild ${player.guildId}: requested ${result.requested}%, capped at the configured ceiling (${MAX_VOLUME}%).`
    );
  }

  if (result.boosted) {
    logger.info(
      `[Volume] Guild ${player.guildId}: ${result.applied}% is ${gainDb(result.applied)} dB above unity - ` +
        "digital gain clamps at full scale on loud masters and always forces re-encoding (no Opus passthrough)."
    );
  } else if (result.applied !== UNITY_VOLUME) {
    logger.debug(
      `[Volume] Guild ${player.guildId}: ${result.applied}% is attenuation, so the node decodes and re-encodes; bit-exact Opus passthrough returns at 100%.`
    );
  }

  return result;
}

/**
 * Honest, user-facing description of what a volume change actually costs.
 * @param {{ requested?: number, applied: number, boosted?: boolean, capped?: boolean }} result
 * @returns {string}
 */
function gainNotice(result) {
  const applied = Number(result?.applied) || 0;
  const requested = Number(result?.requested);
  const capNote = result?.capped
    ? ` Requested **${requested}%**, capped at the configured **${MAX_VOLUME}%** maximum (\`MAX_VOLUME\`).`
    : "";

  if (applied === 0) return `Volume muted (**0%**).${capNote}`;

  if (applied === UNITY_VOLUME) {
    return `Volume set to **100% (unity gain)** — bit-exact Opus passthrough, zero distortion.${capNote}`;
  }

  if (applied > UNITY_VOLUME) {
    const db = gainDb(applied);
    return (
      `Volume set to **${applied}% (${db >= 0 ? "+" : ""}${db} dB)**. ` +
      "**Clipping warning:** this is digital gain on already-mastered PCM, so loud tracks will clip and the node has to " +
      "re-encode (no Opus passthrough). Use your Discord client volume if you want loudness without distortion." +
      capNote
    );
  }

  return `Volume set to **${applied}%** (attenuated, no clipping).${capNote}`;
}

/**
 * Backwards-compatible alias: the old name only ever described the unity cap.
 */
const capNotice = gainNotice;

/**
 * Full one-line description of an applied change.
 */
function describe(result) {
  return gainNotice(result);
}

module.exports = {
  UNITY_VOLUME,
  MAX_VOLUME,
  gainDb,
  clampVolume,
  applyVolume,
  gainNotice,
  capNotice,
  describe,
};
