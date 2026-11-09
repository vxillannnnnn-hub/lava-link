/**
 * Playback control helpers
 * ---------------------------------------------------------------------------
 * lavalink-client v2 has no `player.stop()` (it is `stopPlaying()`) and
 * `player.skip()` throws `Can't skip more than the queue size` when there is
 * nothing queued - which is exactly the case when the user skips the *last*
 * track, or when autoplay is about to take over. Every command and event
 * handler must go through these helpers instead of calling the raw methods.
 */

const logger = require("./logger");

/**
 * Skip the current track (or jump `skipTo` tracks ahead) without ever throwing.
 *
 * `skip(0, false)` still nulls the current track on the node, so Lavalink emits
 * trackEnd -> queueEnd and the autoplay hook can add the next recommendation.
 *
 * @param {import("lavalink-client").Player} player
 * @param {number} skipTo 1 = next queued track, 2 = the one after it, ...
 * @returns {Promise<boolean>} whether the player state was advanced
 */
async function skipCurrent(player, skipTo = 0) {
  if (!player || typeof player.skip !== "function") return false;

  const queued = player.queue?.tracks?.length || 0;
  if (Number(skipTo) > queued) {
    logger.debug(`[PlayerActions] Skip target ${skipTo} exceeds queue size ${queued}; ignoring.`);
    return false;
  }

  try {
    // Second argument disables the library's RangeError for an empty queue
    await player.skip(Number(skipTo) || 0, false);
    return true;
  } catch (err) {
    logger.warn(`[PlayerActions] skip(${skipTo}) failed in guild ${player.guildId}: ${err?.message || err}`);
    // Hard fallback: stopping playback still fires trackEnd/queueEnd, which lets
    // autoplay recover instead of leaving the channel in a broken state.
    try {
      await player.stopPlaying(false, false);
      return true;
    } catch (stopErr) {
      logger.error(`[PlayerActions] Fallback stop failed in guild ${player.guildId}: ${stopErr?.message || stopErr}`);
      return false;
    }
  }
}

/**
 * Stop playback without destroying the player. Uses `stopPlaying()` (v2 API)
 * and falls back to the legacy `stop()` only if it exists.
 *
 * @param {import("lavalink-client").Player} player
 * @param {{ clearQueue?: boolean, executeAutoplay?: boolean }} [options]
 */
async function stopPlayback(player, options = {}) {
  if (!player) return false;
  const clearQueue = options.clearQueue !== false;
  const executeAutoplay = options.executeAutoplay === true;

  try {
    if (typeof player.stopPlaying === "function") {
      await player.stopPlaying(clearQueue, executeAutoplay);
      return true;
    }
    if (typeof player.stop === "function") {
      await player.stop();
      return true;
    }
  } catch (err) {
    logger.warn(`[PlayerActions] stopPlayback failed in guild ${player.guildId}: ${err?.message || err}`);
  }

  return false;
}

/**
 * Pause without throwing when the player is already paused / idle.
 */
async function pausePlayback(player) {
  if (!player || player.paused || typeof player.pause !== "function") return false;
  try {
    await player.pause();
    return true;
  } catch (err) {
    logger.debug(`[PlayerActions] pause failed in guild ${player.guildId}: ${err?.message || err}`);
    return false;
  }
}

/**
 * Resume without throwing when nothing is playing.
 */
async function resumePlayback(player) {
  if (!player || !player.paused || typeof player.resume !== "function") return false;
  try {
    await player.resume();
    return true;
  } catch (err) {
    logger.debug(`[PlayerActions] resume failed in guild ${player.guildId}: ${err?.message || err}`);
    return false;
  }
}

module.exports = {
  skipCurrent,
  stopPlayback,
  pausePlayback,
  resumePlayback,
};
