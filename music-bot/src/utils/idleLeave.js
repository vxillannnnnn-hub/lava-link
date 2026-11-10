const config = require("../config");
const logger = require("./logger");

/**
 * 24/7-aware inactivity leave
 * ---------------------------------------------------------------------------
 * lavalink-client's `playerOptions.onEmptyQueue.destroyAfterMs` destroys the
 * player on a plain timer: it cannot see our `247` flag, so a permanent channel
 * was torn down a few minutes after every queue end (and `0` means "destroy
 * now" rather than "never"). The countdown therefore lives here, where the flag
 * is re-checked at fire time and any new track cancels it.
 */

const TIMER_KEY = "idleLeaveTimer";

function cancel(player) {
  const timer = player?.get?.(TIMER_KEY);
  if (timer && typeof timer === "object") clearTimeout(timer);
  player?.set?.(TIMER_KEY, null);
}

/**
 * Arm the inactivity countdown. Returns the timer, or null when 24/7 is on.
 *
 * @param {import("lavalink-client").Player} player
 * @param {import("discord.js").Client} client
 * @param {{ delayMs?: number }} [options] delayMs exists for tests
 */
function schedule(player, client, { delayMs } = {}) {
  cancel(player);
  if (!player?.guildId) return null;
  if (player.get?.("247")) return null;

  const delay = Number.isFinite(Number(delayMs))
    ? Math.max(0, Number(delayMs))
    : Math.max(30000, Number(config.player.inactivityTimeoutMs) || 180000);

  const timer = setTimeout(async () => {
    player.set(TIMER_KEY, null);
    // 24/7 may have been enabled while the countdown was running.
    if (player.get?.("247")) return;
    // Only the player currently registered for the guild may be destroyed.
    if (client?.lavalink?.getPlayer?.(player.guildId) !== player) return;
    if (player.playing || player.queue?.current || (player.queue?.tracks?.length || 0) > 0) return;

    const minutes = Math.max(1, Math.round(delay / 60000));
    logger.info(
      `[Idle] Leaving guild ${player.guildId} after ${minutes} minute(s) with an empty queue (24/7 is off).`
    );
    await Promise.resolve(player.destroy?.("Inactivity timeout with an empty queue")).catch(() => {});
  }, delay);

  if (typeof timer.unref === "function") timer.unref();
  player.set(TIMER_KEY, timer);
  return timer;
}

module.exports = { schedule, cancel, TIMER_KEY };
