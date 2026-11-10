const config = require("../config");
const logger = require("./logger");
const { warnEmbed } = require("./embed");

/**
 * Empty-voice-channel watchdog
 * ---------------------------------------------------------------------------
 * A music player must not keep streaming into an empty channel, and it must not
 * keep the seat forever either. Both decisions lived inside the
 * `voiceStateUpdate` handler, which only runs when somebody *moves* - so an
 * abandoned session restored after a restart (or a boot while alone) never got
 * a pause or a leave timer at all, and autoplay happily refilled the queue.
 *
 * This module owns the rule so every entry point agrees:
 *   - humans present            -> cancel the leave timer (and let the caller resume)
 *   - alone, 24/7 off           -> pause now, disconnect after the grace period
 *   - alone, 24/7 on            -> stay connected but stop streaming (configurable)
 *
 * It is fail-open: an unknown guild/channel counts as "not alone", because a
 * cache miss must never mute a channel that actually has listeners.
 */

// `${guildId}_${botId}` -> { timer, channelId }
const watches = new Map();

/**
 * Humans connected to a voice channel, counted from live voice states.
 *
 * `!vs.member?.user?.bot` is not enough on its own: with a bounded member cache
 * an uncached sibling bot looks human, which kept the bot connected to empty
 * channels and stopped the auto-pause from ever firing.
 */
function countHumanListeners(client, guild, channelId) {
  if (!guild || !channelId || !guild.voiceStates?.cache) return 0;

  const multiBotCoordinator = require("./multiBotCoordinator");
  let humans = 0;

  for (const vs of guild.voiceStates.cache.values()) {
    if (vs.channelId !== channelId || vs.id === client?.user?.id) continue;
    if (multiBotCoordinator.allBotIds?.includes(vs.id)) continue;
    const isBot =
      vs.member?.user?.bot ||
      guild.members?.cache?.get(vs.id)?.user?.bot ||
      client?.users?.cache?.get?.(vs.id)?.bot;
    if (!isBot) humans++;
  }

  return humans;
}

function resolveGuild(client, player) {
  return client?.guilds?.cache?.get(player?.guildId) || player?.guild || null;
}

/**
 * True only when we can positively see an empty channel. A missing cache is
 * reported as "not alone" so the guard can never silence a busy channel.
 */
function isAlone(player, client = player?.lavalink?.client || player?.client) {
  if (!player?.voiceChannelId) return false;
  const guild = resolveGuild(client, player);
  if (!guild?.voiceStates?.cache) return false;
  return countHumanListeners(client, guild, player.voiceChannelId) === 0;
}

function watchKey(client, guildId) {
  return `${guildId}_${client?.user?.id}`;
}

function clearWatch(client, guildId) {
  const key = watchKey(client, guildId);
  const existing = watches.get(key);
  if (!existing) return false;
  clearTimeout(existing.timer);
  watches.delete(key);
  return true;
}

async function notifyEmpty(client, player, channelId) {
  if (!player?.textChannelId) return;
  const textChannel = client?.channels?.cache?.get?.(player.textChannelId);
  if (!textChannel) return;

  const minutes = Math.max(1, Math.round((Number(config.player.emptyChannelTimeoutMs) || 120000) / 60000));
  const stayNote = player.get?.("247")
    ? "24/7 mode is on, so the bot stays connected."
    : `The bot will disconnect in ${minutes} minute(s) if nobody rejoins.`;

  try {
    const message = await textChannel.send({
      embeds: [warnEmbed(`Voice channel is empty! Playback is paused. ${stayNote}`, "Empty Channel")],
    });
    setTimeout(() => message.delete().catch(() => {}), 15000);
  } catch (_) {
    // A missing Send Messages permission must not break the watchdog.
  }
}

/**
 * Apply the listener rule to one player.
 * @returns {Promise<{ humans: number|null, action: string }>}
 */
async function enforce(player, client, { notify = false, graceMs } = {}) {
  if (!player?.voiceChannelId || !player.guildId) return { humans: null, action: "idle" };

  const guild = resolveGuild(client, player);
  if (!guild?.voiceStates?.cache) return { humans: null, action: "unknown" };

  const channelId = player.voiceChannelId;
  const humans = countHumanListeners(client, guild, channelId);
  const key = watchKey(client, player.guildId);

  if (humans > 0) {
    const cancelled = clearWatch(client, player.guildId);
    if (cancelled) {
      logger.info(
        `[ListenerGuard] Human listener(s) present (${humans}) in guild ${player.guildId}. Auto-leave cancelled.`
      );
    }
    // Resume here rather than in the caller: 24/7 never arms a leave timer, so
    // its pause had no "cancelled" signal and stayed paused forever.
    if (player.paused && player.get?.("autoPaused")) {
      await player.resume().catch(() => {});
      player.set("autoPaused", false);
      logger.info(`[ListenerGuard] Resumed playback in guild ${player.guildId}: a listener joined.`);
      return { humans, action: "resumed" };
    }
    return { humans, action: cancelled ? "cancelled" : "listening" };
  }

  // Alone. 24/7 keeps the seat but must not broadcast to an empty room.
  if (player.get?.("247")) {
    clearWatch(client, player.guildId);
    if (config.player.pauseAloneIn247 !== false && player.playing && !player.paused) {
      await player.pause().catch(() => {});
      player.set("autoPaused", true);
      logger.info(
        `[ListenerGuard] Paused 24/7 playback in guild ${player.guildId}: channel is empty (staying connected).`
      );
      return { humans: 0, action: "paused-247" };
    }
    return { humans: 0, action: "stay-247" };
  }

  if (player.playing && !player.paused) {
    await player.pause().catch(() => {});
    player.set("autoPaused", true);
    logger.info(`[ListenerGuard] Auto-paused playback in guild ${player.guildId}: voice channel is empty.`);
  }

  if (watches.has(key)) return { humans: 0, action: "waiting" };

  // `graceMs` exists so the disconnect path is testable without waiting minutes.
  const configuredGrace = Number(config.player.emptyChannelTimeoutMs) || 120000;
  const graceDelay = Number.isFinite(Number(graceMs))
    ? Math.max(0, Number(graceMs))
    : Math.max(30000, configuredGrace);
  const watch = { channelId, timer: null };

  watch.timer = setTimeout(async () => {
    watches.delete(key);
    // Re-count against the channel this timer was armed for: the player may have
    // been moved since, and a stale count would disconnect an occupied channel.
    const stillAlone = countHumanListeners(client, guild, channelId) === 0;
    if (!stillAlone) return;
    logger.info(`[ListenerGuard] Disconnecting from empty channel in guild ${player.guildId}.`);
    await Promise.resolve(player.destroy?.("Voice channel left empty")).catch(() => {});
  }, graceDelay);

  if (typeof watch.timer.unref === "function") watch.timer.unref();
  watches.set(key, watch);

  if (notify) await notifyEmpty(client, player, channelId);
  return { humans: 0, action: "armed" };
}

/**
 * Safety net for states no event covers: restored sessions, a bot that was
 * already alone when it joined, and a missed gateway update.
 */
async function reconcile(client) {
  const players = client?.lavalink?.players?.values
    ? [...client.lavalink.players.values()]
    : [];
  const results = [];
  for (const player of players) {
    results.push(await enforce(player, client, { notify: false }));
  }
  return results;
}

module.exports = {
  countHumanListeners,
  isAlone,
  enforce,
  reconcile,
  clearWatch,
  watches,
};
