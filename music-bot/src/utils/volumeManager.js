/**
 * Clipping-safe gain path
 * ---------------------------------------------------------------------------
 * Lavalink's volume operator is a straight multiply on decoded PCM. Above 100%
 * that gain pushes already-mastered material past full scale, and the Opus
 * encoder clamps it - which is audible as hard distortion, not as "louder".
 * Unity gain (100%) is also the only setting that keeps bit-exact Opus
 * passthrough. So every volume write in the bot goes through this module:
 *
 *   0-100%  -> applied as-is (attenuation never clips)
 *   100%    -> applied as unity: lossless passthrough
 *   >100%   -> capped at unity, and the caller is told why
 *
 * To actually go louder, the listener should raise their own Discord client
 * volume (or the node needs a limiter/compressor plugin). Adding digital gain
 * here always re-introduces clipping.
 */

const logger = require("./logger");

const UNITY_VOLUME = 100;

/**
 * Normalise any requested level into a clipping-free value.
 * @param {number} level requested percentage
 * @returns {{ requested: number, applied: number, capped: boolean }}
 */
function clampVolume(level) {
  const numeric = Number(level);
  const requested = Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : UNITY_VOLUME;
  const applied = Math.min(requested, UNITY_VOLUME);
  return { requested, applied, capped: requested > UNITY_VOLUME };
}

/**
 * Apply a volume request through the clipping-safe gain path.
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

  // Keep the user's intent visible for the UI/diagnostics without ever sending
  // a clipping gain to Lavalink.
  player.set("requestedVolume", result.requested);

  if (result.capped) {
    logger.debug(
      `[Volume] Guild ${player.guildId}: requested ${result.requested}%, applied ${result.applied}% (unity) to avoid Opus clipping.`
    );
  }

  if (result.applied !== UNITY_VOLUME) {
    logger.debug(
      `[Volume] Guild ${player.guildId}: ${result.applied}% is attenuation, so the node decodes and re-encodes; bit-exact Opus passthrough returns at 100%.`
    );
  }

  return result;
}

/**
 * Short explanation of the cap, for user-facing replies.
 */
function capNotice(result) {
  if (!result?.capped) return "";
  return `Requested **${result.requested}%**, applied **${UNITY_VOLUME}% (unity gain)** — digital gain above 100% saturates the Opus encoder and distorts. Use your Discord client volume for louder output.`;
}

/**
 * Full one-line description of an applied change.
 */
function describe(result) {
  if (result.capped) return capNotice(result);
  if (result.applied === UNITY_VOLUME) {
    return `Volume set to **${UNITY_VOLUME}% (unity gain)** — bit-exact Opus passthrough, zero distortion.`;
  }
  if (result.applied === 0) return "Volume muted (**0%**).";
  return `Volume set to **${result.applied}%** (attenuated, no clipping).`;
}



module.exports = {
  UNITY_VOLUME,
  clampVolume,
  applyVolume,
  capNotice,
  describe,
};
